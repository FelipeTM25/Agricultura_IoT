"""API publica de la landing: solo lectura, sin login.

- /api/estado     si Orion y QuantumLeap responden
- /api/sensores   lectura actual de cada sensor (Orion)
- /api/historico  serie de tiempo de un sensor (QuantumLeap -> CrateDB)

No hay ninguna ruta que cree, cambie o borre datos: eso es del gestor.
Si existe la carpeta static/ (el front de React ya compilado), se sirve en /.
"""
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import config

orion = httpx.AsyncClient(base_url=config.ORION_URL, timeout=8)
# QuantumLeap solo devuelve las lecturas si la consulta lleva el mismo service path con
# el que Orion las notifico ("/"); sin la cabecera responde 404 aunque haya datos.
quantumleap = httpx.AsyncClient(base_url=config.QUANTUMLEAP_URL, timeout=15, headers={"Fiware-ServicePath": "/"})

ID_VALIDO = re.compile(r"^[^\s<>\"'=;()&?/#]+$")


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    yield
    await orion.aclose()
    await quantumleap.aclose()


app = FastAPI(title="Landing - Agricultura IoT", version="0.1.0", lifespan=ciclo_de_vida)
api = APIRouter(prefix="/api")


async def _responde(cliente: httpx.AsyncClient, ruta: str) -> bool:
    try:
        return (await cliente.get(ruta)).status_code == 200
    except httpx.HTTPError:
        return False


@api.get("/estado")
async def estado():
    return {"orion": await _responde(orion, "/version"), "quantumleap": await _responde(quantumleap, "/version")}


def _ubicacion(atributo: dict | None) -> dict | None:
    valor = (atributo or {}).get("value") or {}
    if valor.get("type") == "Point" and len(valor.get("coordinates", [])) == 2:
        lon, lat = valor["coordinates"]
        return {"lat": lat, "lon": lon}
    return None


@api.get("/sensores")
async def sensores():
    """Lectura actual de cada sensor, simplificada para la landing."""
    try:
        r = await orion.get(
            "/v2/entities",
            params={"type": config.TIPO_SENSOR, "attrs": "dateModified,*", "limit": 100},
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Orion no responde")
    if r.status_code != 200:
        raise HTTPException(502, f"Orion respondio {r.status_code}")

    resultado = []
    for entidad in r.json():
        variables = {
            nombre: entidad[nombre].get("value")
            for nombre in config.VARIABLES
            if isinstance(entidad.get(nombre, {}).get("value"), (int, float))
        }
        resultado.append({
            "id": entidad["id"],
            "actualizado": entidad.get("dateModified", {}).get("value"),
            "variables": variables,
            "ubicacion": _ubicacion(entidad.get("ubicacion")),
        })
    return resultado


# Tamano del intervalo segun el rango pedido, para no mandar miles de puntos al navegador
def _intervalo(horas: int) -> timedelta:
    if horas <= 1:
        return timedelta(minutes=1)
    if horas <= 6:
        return timedelta(minutes=5)
    if horas <= 24:
        return timedelta(minutes=15)
    return timedelta(hours=1)


@api.get("/historico/{sensor_id}")
async def historico(sensor_id: str, horas: int = Query(24, ge=1, le=168)):
    """Promedio por intervalo de cada variable en las ultimas `horas`.

    Se piden todos los atributos y se filtran aqui: si se le pide a QuantumLeap un
    atributo que todavia no existe como columna en CrateDB, falla la consulta entera.
    """
    if not ID_VALIDO.match(sensor_id):
        raise HTTPException(422, "Id de sensor invalido")

    desde = datetime.now(timezone.utc) - timedelta(hours=horas)
    try:
        r = await quantumleap.get(
            f"/v2/entities/{quote(sensor_id, safe='')}",
            params={"type": config.TIPO_SENSOR, "fromDate": desde.isoformat(), "limit": 10000},
        )
    except httpx.HTTPError:
        raise HTTPException(502, "QuantumLeap no responde")

    paso = _intervalo(horas)
    vacio = {"desde": desde.isoformat(), "intervalo_min": int(paso.total_seconds() // 60), "puntos": 0, "series": {}}
    if r.status_code == 404:  # todavia no hay historico para ese sensor
        return vacio
    if r.status_code != 200:
        raise HTTPException(502, f"QuantumLeap respondio {r.status_code}")

    datos = r.json()
    tiempos = [datetime.fromisoformat(t) for t in datos.get("index", [])]
    series = {}
    for atributo in datos.get("attributes", []):
        nombre = atributo["attrName"]
        if nombre not in config.VARIABLES:
            continue
        # Agrupa las lecturas por intervalo y promedia
        grupos: dict[datetime, list[float]] = {}
        for t, v in zip(tiempos, atributo["values"]):
            if isinstance(v, (int, float)):
                inicio = datetime.fromtimestamp(t.timestamp() // paso.total_seconds() * paso.total_seconds(), timezone.utc)
                grupos.setdefault(inicio, []).append(v)
        if grupos:
            series[nombre] = [
                {"t": inicio.isoformat(), "v": round(sum(vs) / len(vs), 2)} for inicio, vs in sorted(grupos.items())
            ]

    return {**vacio, "puntos": len(tiempos), "series": series}


app.include_router(api)

# El front compilado se monta al final para que no tape las rutas de la API
CARPETA_FRONT = Path(__file__).resolve().parent.parent / "static"
if CARPETA_FRONT.is_dir():
    app.mount("/", StaticFiles(directory=CARPETA_FRONT, html=True), name="front")
