"""Proceso de limpieza: CrateDB (historico crudo de QuantumLeap) -> reglas -> Postgres.

Es incremental: recuerda hasta donde limpio cada tabla y en la siguiente vuelta solo
procesa lo nuevo. El ultimo intervalo se vuelve a calcular siempre, porque pudo haber
quedado a medias, y se leen unos minutos antes como contexto para detectar picos.
Todo lo que escribe es idempotente: correrlo dos veces deja el mismo resultado.
"""
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
import psycopg

from . import config, reglas

CONTEXTO = timedelta(minutes=30)  # lecturas previas que se leen para juzgar picos
POR_PAGINA = 10000

ESQUEMA = """
CREATE TABLE IF NOT EXISTS mediciones (
    sensor_id    text NOT NULL,
    tipo         text NOT NULL,
    variable     text NOT NULL,
    inicio       timestamptz NOT NULL,
    promedio     double precision NOT NULL,
    minimo       double precision NOT NULL,
    maximo       double precision NOT NULL,
    muestras     integer NOT NULL,
    descartadas  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (sensor_id, variable, inicio)
);
CREATE INDEX IF NOT EXISTS mediciones_inicio ON mediciones (inicio);

CREATE TABLE IF NOT EXISTS descartes (
    sensor_id  text NOT NULL,
    variable   text NOT NULL,
    hora       timestamptz NOT NULL,
    valor      double precision,
    regla      text NOT NULL,
    PRIMARY KEY (sensor_id, variable, hora, regla)
);

CREATE TABLE IF NOT EXISTS ejecuciones (
    id           serial PRIMARY KEY,
    inicio       timestamptz NOT NULL,
    fin          timestamptz,
    origen       text NOT NULL,
    leidas       integer NOT NULL DEFAULT 0,
    validas      integer NOT NULL DEFAULT 0,
    descartadas  integer NOT NULL DEFAULT 0,
    intervalos   integer NOT NULL DEFAULT 0,
    error        text
);

CREATE TABLE IF NOT EXISTS avance (
    tabla  text PRIMARY KEY,
    hasta  timestamptz NOT NULL
);
"""

# CrateDB guarda las columnas en minusculas (humedadSuelo -> humedadsuelo): se recupera el nombre
NOMBRE_ORIGINAL = {nombre.lower(): nombre for nombre in reglas.RANGOS}
TIPOS_NUMERICOS = ("real", "double precision", "bigint", "integer", "smallint")

candado = asyncio.Lock()


async def _sql(cliente: httpx.AsyncClient, stmt: str, args: list | None = None) -> list[list]:
    r = await cliente.post("/_sql", json={"stmt": stmt, "args": args or []})
    if r.status_code != 200:
        raise RuntimeError(f"CrateDB: {r.json().get('error', {}).get('message', r.text)}")
    return r.json()["rows"]


def _inicio_intervalo(hora: datetime, paso: timedelta) -> datetime:
    segundos = paso.total_seconds()
    return datetime.fromtimestamp(hora.timestamp() // segundos * segundos, timezone.utc)


async def _limpiar_tabla(crate: httpx.AsyncClient, pg: psycopg.AsyncConnection, tabla: str, totales: dict) -> None:
    paso = timedelta(minutes=config.INTERVALO_DATOS_MIN)

    columnas = [
        fila[0]
        for fila in await _sql(
            crate,
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'doc' AND table_name = ? AND data_type IN (?, ?, ?, ?, ?)",
            [tabla, *TIPOS_NUMERICOS],
        )
    ]
    if not columnas:
        return

    async with pg.cursor() as cur:
        await cur.execute("SELECT hasta FROM avance WHERE tabla = %s", (tabla,))
        fila = await cur.fetchone()
    # Desde donde se reescribe: el intervalo en el que quedo la vuelta anterior (o todo, la primera vez)
    escribir_desde = _inicio_intervalo(fila[0], paso) if fila else datetime(1970, 1, 1, tzinfo=timezone.utc)
    leer_desde = escribir_desde - CONTEXTO

    lista_columnas = ", ".join(f'"{c}"' for c in columnas)
    filas, offset = [], 0
    while True:
        pagina = await _sql(
            crate,
            f'SELECT entity_id, entity_type, time_index, {lista_columnas} FROM doc."{tabla}" '
            "WHERE time_index >= ? ORDER BY time_index, entity_id LIMIT ? OFFSET ?",
            [int(leer_desde.timestamp() * 1000), POR_PAGINA, offset],
        )
        filas.extend(pagina)
        offset += len(pagina)
        if len(pagina) < POR_PAGINA:
            break
    if not filas:
        return

    # Series por sensor y variable
    series: dict[tuple[str, str], list[reglas.Lectura]] = defaultdict(list)
    tipos: dict[str, str] = {}
    for entidad, tipo, ms, *valores in filas:
        hora = datetime.fromtimestamp(ms / 1000, timezone.utc)
        tipos[entidad] = tipo
        for columna, valor in zip(columnas, valores):
            if valor is not None:
                series[(entidad, NOMBRE_ORIGINAL.get(columna, columna))].append(reglas.Lectura(hora, float(valor)))

    mediciones, descartes = [], []
    for entidad in tipos:
        variables = {v: ls for (e, v), ls in series.items() if e == entidad}
        fallas = {v: reglas.fallas_por_hora(v, ls) for v, ls in variables.items()}
        for variable, lecturas in variables.items():
            pareja = reglas.MISMO_SENSOR.get(variable)
            validas, descartadas = reglas.limpiar_serie(variable, lecturas, fallas.get(pareja, set()))

            # Solo se escribe desde `escribir_desde`; lo anterior se leyo solo como contexto
            validas = [l for l in validas if l.hora >= escribir_desde]
            descartadas = [d for d in descartadas if d.hora >= escribir_desde]
            totales["leidas"] += len(validas) + len(descartadas)
            totales["validas"] += len(validas)
            totales["descartadas"] += len(descartadas)

            por_intervalo: dict[datetime, list[float]] = defaultdict(list)
            for l in validas:
                por_intervalo[_inicio_intervalo(l.hora, paso)].append(l.valor)
            descartes_por_intervalo: dict[datetime, int] = defaultdict(int)
            for d in descartadas:
                descartes_por_intervalo[_inicio_intervalo(d.hora, paso)] += 1
                descartes.append((entidad, variable, d.hora, d.valor, d.regla))

            for inicio, vs in por_intervalo.items():
                mediciones.append((
                    entidad, tipos[entidad], variable, inicio,
                    round(sum(vs) / len(vs), 3), min(vs), max(vs), len(vs), descartes_por_intervalo.get(inicio, 0),
                ))
            totales["intervalos"] += len(por_intervalo)

    hasta = datetime.fromtimestamp(max(f[2] for f in filas) / 1000, timezone.utc)
    async with pg.transaction():
        async with pg.cursor() as cur:
            # Se borra y se reescribe el tramo reprocesado: asi un pico que con mas contexto
            # resulto ser real deja de figurar como descarte
            await cur.execute("DELETE FROM mediciones WHERE sensor_id = ANY(%s) AND inicio >= %s", (list(tipos), escribir_desde))
            await cur.execute(
                "DELETE FROM descartes WHERE sensor_id = ANY(%s) AND hora >= %s", (list(tipos), escribir_desde)
            )
            await cur.executemany(
                "INSERT INTO mediciones (sensor_id, tipo, variable, inicio, promedio, minimo, maximo, muestras, descartadas) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                mediciones,
            )
            await cur.executemany(
                "INSERT INTO descartes (sensor_id, variable, hora, valor, regla) VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT DO NOTHING",
                descartes,
            )
            await cur.execute(
                "INSERT INTO avance (tabla, hasta) VALUES (%s, %s) ON CONFLICT (tabla) DO UPDATE SET hasta = EXCLUDED.hasta",
                (tabla, hasta),
            )


async def limpiar(origen: str) -> dict:
    """Una vuelta completa sobre todas las tablas de QuantumLeap. `origen`: automatico o manual."""
    if candado.locked():
        raise RuntimeError("Ya hay una limpieza en curso")
    async with candado:
        inicio = datetime.now(timezone.utc)
        totales = {"leidas": 0, "validas": 0, "descartadas": 0, "intervalos": 0}
        error = None
        async with await psycopg.AsyncConnection.connect(config.POSTGRES_DSN, autocommit=True) as pg:
            await pg.execute(ESQUEMA)
            try:
                async with httpx.AsyncClient(base_url=config.CRATE_URL, timeout=60) as crate:
                    # QuantumLeap crea una tabla doc.et<tipo> por cada tipo de entidad
                    tablas = [
                        f[0]
                        for f in await _sql(
                            crate,
                            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'doc' AND table_name LIKE 'et%'",
                        )
                    ]
                    for tabla in tablas:
                        await _limpiar_tabla(crate, pg, tabla, totales)
            except (httpx.HTTPError, RuntimeError, psycopg.Error) as e:
                error = str(e)

            fin = datetime.now(timezone.utc)
            await pg.execute(
                "INSERT INTO ejecuciones (inicio, fin, origen, leidas, validas, descartadas, intervalos, error) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (inicio, fin, origen, totales["leidas"], totales["validas"], totales["descartadas"], totales["intervalos"], error),
            )
        return {"inicio": inicio.isoformat(), "fin": fin.isoformat(), "origen": origen, **totales, "error": error}


async def estado() -> dict:
    """Ultimas ejecuciones y resumen de lo que hay en Postgres."""
    async with await psycopg.AsyncConnection.connect(config.POSTGRES_DSN, autocommit=True) as pg:
        await pg.execute(ESQUEMA)
        async with pg.cursor() as cur:
            await cur.execute(
                "SELECT inicio, fin, origen, leidas, validas, descartadas, intervalos, error "
                "FROM ejecuciones ORDER BY id DESC LIMIT 10"
            )
            columnas = [c.name for c in cur.description]
            ejecuciones = [dict(zip(columnas, f)) for f in await cur.fetchall()]
            await cur.execute("SELECT count(DISTINCT sensor_id), count(*), min(inicio), max(inicio) FROM mediciones")
            sensores, intervalos, primero, ultimo = await cur.fetchone()
            await cur.execute("SELECT regla, count(*) FROM descartes GROUP BY regla ORDER BY 2 DESC")
            por_regla = dict(await cur.fetchall())
    return {
        "ejecuciones": ejecuciones,
        "datos": {"sensores": sensores, "intervalos": intervalos, "desde": primero, "hasta": ultimo},
        "descartes_por_regla": por_regla,
    }
