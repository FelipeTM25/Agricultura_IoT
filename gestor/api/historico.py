"""Historico de una entidad desde QuantumLeap (CrateDB): consulta para graficas y exportacion."""
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from . import config

# QuantumLeap solo devuelve las lecturas si la consulta lleva el mismo service path con
# el que Orion las notifico ("/"); sin la cabecera responde 404 aunque haya datos.
cliente = httpx.AsyncClient(base_url=config.QUANTUMLEAP_URL, timeout=30, headers={"Fiware-ServicePath": "/"})

POR_PAGINA = 10000        # maximo que QuantumLeap devuelve por peticion
MAXIMO_EXPORTAR = 200000  # tope de lecturas por exportacion, para no tumbar el contenedor


async def _leer(entidad_id: str, tipo: str | None, desde: datetime, hasta: datetime | None = None, maximo: int = POR_PAGINA):
    """Lecturas crudas: (lista de horas, {atributo: [valores]}). Pagina si hace falta.

    Se piden todos los atributos y se filtran despues: si se le pide a QuantumLeap un
    atributo que todavia no existe como columna en CrateDB, falla la consulta entera.
    """
    tiempos: list[datetime] = []
    valores: dict[str, list] = {}
    while len(tiempos) < maximo:
        params = {"fromDate": desde.isoformat(), "limit": min(POR_PAGINA, maximo - len(tiempos)), "offset": len(tiempos)}
        if hasta:
            params["toDate"] = hasta.isoformat()
        if tipo:
            params["type"] = tipo
        try:
            r = await cliente.get(f"/v2/entities/{quote(entidad_id, safe='')}", params=params)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"No se pudo conectar con QuantumLeap ({config.QUANTUMLEAP_URL}): {e}")
        if r.status_code == 404:  # no hay (mas) lecturas: sin suscripcion o fuera del rango
            break
        if r.status_code != 200:
            raise HTTPException(502, f"QuantumLeap respondio {r.status_code}")

        datos = r.json()
        pagina = [datetime.fromisoformat(t) for t in datos.get("index", [])]
        if not pagina:
            break
        anteriores = len(tiempos)
        tiempos.extend(pagina)
        for atributo in datos.get("attributes", []):
            serie = valores.setdefault(atributo["attrName"], [None] * anteriores)
            serie.extend(atributo["values"])
        for serie in valores.values():  # atributos que no vinieron en esta pagina
            serie.extend([None] * (len(tiempos) - len(serie)))
        if len(pagina) < params["limit"]:
            break
    return tiempos, valores


def _numerico(v) -> bool:
    # bool es subclase de int en Python: no tiene sentido promediar true/false
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _agrupar(tiempos: list[datetime], valores: list, paso: timedelta) -> list[tuple[datetime, float]]:
    """Promedio de los valores numericos por intervalo de `paso`."""
    segundos = paso.total_seconds()
    grupos: dict[datetime, list[float]] = {}
    for t, v in zip(tiempos, valores):
        if _numerico(v):
            inicio = datetime.fromtimestamp(t.timestamp() // segundos * segundos, timezone.utc)
            grupos.setdefault(inicio, []).append(v)
    return [(inicio, round(sum(vs) / len(vs), 2)) for inicio, vs in sorted(grupos.items())]


# Tamano del intervalo segun el rango pedido, para no mandar miles de puntos al navegador
def _intervalo(horas: int) -> timedelta:
    if horas <= 1:
        return timedelta(minutes=1)
    if horas <= 6:
        return timedelta(minutes=5)
    if horas <= 24:
        return timedelta(minutes=15)
    return timedelta(hours=1)


async def consultar(entidad_id: str, tipo: str | None, horas: int) -> dict:
    """Promedio por intervalo de cada atributo numerico en las ultimas `horas` (para graficar)."""
    desde = datetime.now(timezone.utc) - timedelta(hours=horas)
    paso = _intervalo(horas)
    tiempos, valores = await _leer(entidad_id, tipo, desde)

    series = {}
    for nombre, serie in valores.items():
        puntos = _agrupar(tiempos, serie, paso)
        if puntos:
            series[nombre] = [{"t": inicio.isoformat(), "v": v} for inicio, v in puntos]

    return {"desde": desde.isoformat(), "intervalo_min": int(paso.total_seconds() // 60), "puntos": len(tiempos), "series": series}


async def exportar(
    entidad_id: str,
    tipo: str | None,
    desde: datetime,
    hasta: datetime,
    atributos: list[str],
    intervalo_min: int,
    formato: str,
    separador: str,
) -> tuple[str, str]:
    """Arma el archivo de exportacion. Devuelve (contenido, tipo MIME).

    intervalo_min = 0 exporta cada lectura tal como esta en CrateDB; si no, el promedio
    de cada intervalo. Solo salen los atributos numericos pedidos.
    """
    tiempos, valores = await _leer(entidad_id, tipo, desde, hasta, maximo=MAXIMO_EXPORTAR)
    nombres = [a for a in atributos if a in valores] if atributos else sorted(valores)
    nombres = [n for n in nombres if any(_numerico(v) for v in valores[n])]

    filas: list[dict] = []
    if intervalo_min:
        paso = timedelta(minutes=intervalo_min)
        por_hora: dict[datetime, dict] = {}
        for n in nombres:
            for inicio, v in _agrupar(tiempos, valores[n], paso):
                por_hora.setdefault(inicio, {})[n] = v
        filas = [{"hora": t.isoformat(), **vs} for t, vs in sorted(por_hora.items())]
    else:
        for i, t in enumerate(tiempos):
            fila = {n: valores[n][i] for n in nombres if _numerico(valores[n][i])}
            if fila:
                filas.append({"hora": t.isoformat(), **fila})

    if formato == "json":
        cuerpo = {
            "entidad": entidad_id,
            "tipo": tipo,
            "desde": desde.isoformat(),
            "hasta": hasta.isoformat(),
            "intervalo_min": intervalo_min,
            "atributos": nombres,
            "lecturas": filas,
        }
        return json.dumps(cuerpo, ensure_ascii=False, indent=2), "application/json"

    salida = io.StringIO()
    # Con punto y coma Excel en espanol separa bien las columnas, y ademas espera la coma
    # como separador decimal; la coma como separador de columnas es el estandar CSV.
    if separador == ";":
        filas = [{k: (str(v).replace(".", ",") if _numerico(v) else v) for k, v in f.items()} for f in filas]
    escritor = csv.DictWriter(salida, fieldnames=["hora", *nombres], delimiter=separador, lineterminator="\n")
    escritor.writeheader()
    escritor.writerows(filas)
    # El BOM hace que Excel abra el archivo como UTF-8 (tildes correctas)
    return "﻿" + salida.getvalue(), "text/csv; charset=utf-8"
