"""Historico de una entidad desde QuantumLeap (CrateDB), agrupado por intervalos."""
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from . import config

# QuantumLeap solo devuelve las lecturas si la consulta lleva el mismo service path con
# el que Orion las notifico ("/"); sin la cabecera responde 404 aunque haya datos.
cliente = httpx.AsyncClient(base_url=config.QUANTUMLEAP_URL, timeout=15, headers={"Fiware-ServicePath": "/"})


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
    """Promedio por intervalo de cada atributo numerico en las ultimas `horas`.

    Se piden todos los atributos y se filtran aqui: si se le pide a QuantumLeap un
    atributo que todavia no existe como columna en CrateDB, falla la consulta entera.
    """
    desde = datetime.now(timezone.utc) - timedelta(hours=horas)
    params = {"fromDate": desde.isoformat(), "limit": 10000}
    if tipo:
        params["type"] = tipo
    try:
        r = await cliente.get(f"/v2/entities/{quote(entidad_id, safe='')}", params=params)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"No se pudo conectar con QuantumLeap ({config.QUANTUMLEAP_URL}): {e}")

    paso = _intervalo(horas)
    vacio = {"desde": desde.isoformat(), "intervalo_min": int(paso.total_seconds() // 60), "puntos": 0, "series": {}}
    if r.status_code == 404:  # todavia no hay historico (o no existe la suscripcion)
        return vacio
    if r.status_code != 200:
        raise HTTPException(502, f"QuantumLeap respondio {r.status_code}")

    datos = r.json()
    tiempos = [datetime.fromisoformat(t) for t in datos.get("index", [])]
    segundos = paso.total_seconds()
    series = {}
    for atributo in datos.get("attributes", []):
        grupos: dict[datetime, list[float]] = {}
        for t, v in zip(tiempos, atributo["values"]):
            # bool es subclase de int en Python: no tiene sentido promediar true/false
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                inicio = datetime.fromtimestamp(t.timestamp() // segundos * segundos, timezone.utc)
                grupos.setdefault(inicio, []).append(v)
        if grupos:
            series[atributo["attrName"]] = [
                {"t": inicio.isoformat(), "v": round(sum(vs) / len(vs), 2)} for inicio, vs in sorted(grupos.items())
            ]

    return {**vacio, "puntos": len(tiempos), "series": series}
