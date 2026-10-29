"""Toma de decisiones: compara cada lectura que notifica Orion con los umbrales y abre o
cierra alertas en Postgres, avisando por correo en cada cambio.

Una alerta se abre cuando CONFIRMAR_LECTURAS lecturas seguidas cumplen el umbral y se
cierra cuando otras tantas dejan de cumplirlo. Asi se avisa una vez al empezar y una vez
al normalizarse, no cada 30 s, y un pico suelto no dispara nada.
"""
import asyncio
from collections import defaultdict
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from . import config, correo

ESQUEMA = """
CREATE TABLE IF NOT EXISTS umbrales (
    id        serial PRIMARY KEY,
    variable  text NOT NULL,
    operador  text NOT NULL CHECK (operador IN ('>', '<')),
    valor     double precision NOT NULL,
    titulo    text NOT NULL,
    accion    text NOT NULL DEFAULT '',
    activo    boolean NOT NULL DEFAULT true
);

-- Cada alerta copia los datos del umbral: el historial no cambia si el umbral se edita
CREATE TABLE IF NOT EXISTS alertas (
    id          serial PRIMARY KEY,
    sensor_id   text NOT NULL,
    umbral_id   integer REFERENCES umbrales (id) ON DELETE SET NULL,
    variable    text NOT NULL,
    operador    text NOT NULL,
    limite      double precision NOT NULL,
    titulo      text NOT NULL,
    accion      text NOT NULL,
    valor       double precision NOT NULL,
    inicio      timestamptz NOT NULL,
    fin         timestamptz,
    valor_fin   double precision,
    notificada  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS alertas_abiertas ON alertas (sensor_id) WHERE fin IS NULL;
"""

# Umbrales con los que arranca la base la primera vez; despues se editan desde el gestor
UMBRALES_INICIALES = [
    ("temperatura", ">", 35, "Temperatura alta", "Dar sombra o ventilar el cultivo y revisar el riego"),
    ("temperatura", "<", 5, "Riesgo de helada", "Cubrir el cultivo durante la noche"),
    ("humedadSuelo", "<", 30, "Suelo seco", "Regar"),
    ("humedadSuelo", ">", 90, "Suelo saturado", "Suspender el riego y revisar el drenaje"),
    ("humedad", ">", 90, "Humedad del aire muy alta", "Ventilar: riesgo de hongos"),
]

# Rango fisicamente posible (el mismo de limpieza/app/reglas.py). Una lectura fuera de el
# es una falla del sensor: no cuenta ni para abrir ni para cerrar alertas.
RANGOS = {
    "temperatura": (-10.0, 60.0),
    "humedad": (0.0, 100.0),
    "humedadSuelo": (0.0, 100.0),
    "luz": (0.0, 20661.0),
    "radiacion": (0.0, 1023.0),
}
VARIABLES = list(RANGOS)
UNIDADES = {"temperatura": "°C", "humedad": "%", "humedadSuelo": "%", "luz": "lux", "radiacion": "IR"}
PIE = "\n--\nAgricultura IoT · los umbrales se cambian en el gestor, pagina Alertas."

candado = asyncio.Lock()
# Lecturas seguidas en contra del estado actual de cada (sensor, umbral). Vive en memoria:
# si el servicio se reinicia, solo vuelve a contar desde cero.
rachas: dict[tuple[str, int], int] = defaultdict(int)


async def conectar() -> psycopg.AsyncConnection:
    return await psycopg.AsyncConnection.connect(config.POSTGRES_DSN, autocommit=True, row_factory=dict_row)


async def preparar_base() -> None:
    # Al encender la instancia Postgres puede tardar unos segundos en aceptar conexiones
    for intento in range(30):
        try:
            pg = await conectar()
            break
        except psycopg.OperationalError:
            if intento == 29:
                raise
            await asyncio.sleep(2)
    async with pg:
        await pg.execute(ESQUEMA)
        if (await (await pg.execute("SELECT count(*) AS n FROM umbrales")).fetchone())["n"] == 0:
            async with pg.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO umbrales (variable, operador, valor, titulo, accion) VALUES (%s, %s, %s, %s, %s)",
                    UMBRALES_INICIALES,
                )


def _cumple(operador: str, valor: float, limite: float) -> bool:
    return valor > limite if operador == ">" else valor < limite


def _numero(valor: float, variable: str) -> str:
    return f"{valor:.1f}".rstrip("0").rstrip(".") + f" {UNIDADES.get(variable, '')}".rstrip()


def _hora(momento: datetime) -> str:
    return momento.astimezone(config.ZONA_HORARIA).strftime("%d/%m/%Y %H:%M")


def _mensaje_apertura(sensor_id: str, u: dict, valor: float, ahora: datetime) -> tuple[str, str]:
    """(asunto, texto) del correo que avisa que se abrio una alerta."""
    texto = (
        f"{u['titulo']} en {sensor_id}\n\n"
        f"{u['variable']} = {_numero(valor, u['variable'])} "
        f"(límite: {'mayor que' if u['operador'] == '>' else 'menor que'} {_numero(u['valor'], u['variable'])})\n"
        f"Desde: {_hora(ahora)}\n"
    )
    if u["accion"]:
        texto += f"\nAcción recomendada: {u['accion']}\n"
    texto += f"\nTe avisaremos de nuevo cuando la lectura vuelva a la normalidad.\n{PIE}"
    return f"⚠️ Alerta: {u['titulo']} en {sensor_id}", texto


def _mensaje_cierre(alerta: dict, valor: float, ahora: datetime) -> tuple[str, str]:
    texto = (
        f"La alerta \"{alerta['titulo']}\" de {alerta['sensor_id']} se normalizó.\n\n"
        f"{alerta['variable']} = {_numero(valor, alerta['variable'])}\n"
        f"Duró de {_hora(alerta['inicio'])} a {_hora(ahora)}.\n{PIE}"
    )
    return f"✅ Normalizado: {alerta['titulo']} en {alerta['sensor_id']}", texto


def _lecturas(entidad: dict) -> dict[str, float]:
    """Variables numericas y fisicamente posibles de una entidad notificada por Orion."""
    lecturas = {}
    for variable, (minimo, maximo) in RANGOS.items():
        valor = (entidad.get(variable) or {}).get("value")
        if isinstance(valor, (int, float)) and not isinstance(valor, bool) and minimo <= valor <= maximo:
            lecturas[variable] = float(valor)
    return lecturas


async def evaluar(entidades: list[dict]) -> list[dict]:
    """Procesa una notificacion de Orion. Devuelve los cambios (alertas abiertas o cerradas)."""
    cambios = []
    async with candado, await conectar() as pg:
        umbrales = await (await pg.execute("SELECT * FROM umbrales WHERE activo")).fetchall()
        for entidad in entidades:
            sensor_id = entidad.get("id")
            lecturas = _lecturas(entidad)
            if not sensor_id or not lecturas:
                continue
            abiertas = {
                a["umbral_id"]: a
                for a in await (
                    await pg.execute("SELECT * FROM alertas WHERE sensor_id = %s AND fin IS NULL", (sensor_id,))
                ).fetchall()
            }
            ahora = datetime.now(timezone.utc)

            for u in umbrales:
                valor = lecturas.get(u["variable"])
                if valor is None:
                    continue
                clave = (sensor_id, u["id"])
                abierta = abiertas.get(u["id"])
                if _cumple(u["operador"], valor, u["valor"]) == (abierta is not None):
                    rachas[clave] = 0  # la lectura confirma el estado actual
                    continue
                rachas[clave] += 1
                if rachas[clave] < config.CONFIRMAR_LECTURAS:
                    continue
                rachas[clave] = 0

                if abierta is None:
                    notificada = await correo.enviar(*_mensaje_apertura(sensor_id, u, valor, ahora))
                    await pg.execute(
                        "INSERT INTO alertas (sensor_id, umbral_id, variable, operador, limite, titulo, accion, valor, inicio, notificada) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (sensor_id, u["id"], u["variable"], u["operador"], u["valor"], u["titulo"], u["accion"], valor, ahora, notificada),
                    )
                    cambios.append({"sensor_id": sensor_id, "umbral_id": u["id"], "cambio": "abierta", "valor": valor})
                else:
                    await correo.enviar(*_mensaje_cierre(abierta, valor, ahora))
                    await pg.execute(
                        "UPDATE alertas SET fin = %s, valor_fin = %s WHERE id = %s", (ahora, valor, abierta["id"])
                    )
                    cambios.append({"sensor_id": sensor_id, "umbral_id": u["id"], "cambio": "cerrada", "valor": valor})
    return cambios


async def cerrar_de_umbral(pg: psycopg.AsyncConnection, umbral_id: int) -> None:
    """Al borrar o desactivar un umbral, sus alertas abiertas dejan de tener sentido."""
    await pg.execute(
        "UPDATE alertas SET fin = now() WHERE umbral_id = %s AND fin IS NULL", (umbral_id,)
    )
    for clave in [c for c in rachas if c[1] == umbral_id]:
        del rachas[clave]
