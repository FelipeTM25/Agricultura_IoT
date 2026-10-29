"""API publica de la landing: solo lectura, sin login.

- /api/estado     si Orion, la limpieza y las alertas responden
- /api/sensores   lectura actual de cada sensor (Orion)
- /api/historico  serie de tiempo ya limpia de un sensor (Postgres, via el servicio de limpieza)
- /api/alertas    alertas abiertas (servicio de alertas)

No hay ninguna ruta que cree, cambie o borre datos: eso es del gestor.
Si existe la carpeta static/ (el front de React ya compilado), se sirve en /.
"""
import re
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import config

orion = httpx.AsyncClient(base_url=config.ORION_URL, timeout=8)
limpieza = httpx.AsyncClient(base_url=config.LIMPIEZA_URL, timeout=15)
alertas = httpx.AsyncClient(base_url=config.ALERTAS_URL, timeout=8)

ID_VALIDO = re.compile(r"^[^\s<>\"'=;()&?/#]+$")


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    yield
    for cliente in (orion, limpieza, alertas):
        await cliente.aclose()


app = FastAPI(title="Landing - Agricultura IoT", version="0.1.0", lifespan=ciclo_de_vida)
api = APIRouter(prefix="/api")


async def _responde(cliente: httpx.AsyncClient, ruta: str) -> bool:
    try:
        return (await cliente.get(ruta)).status_code == 200
    except httpx.HTTPError:
        return False


@api.get("/estado")
async def estado():
    return {
        "orion": await _responde(orion, "/version"),
        "limpieza": await _responde(limpieza, "/estado"),
        "alertas": await _responde(alertas, "/estado"),
    }


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


async def _pedir(cliente: httpx.AsyncClient, nombre: str, ruta: str, params: dict | None = None):
    try:
        r = await cliente.get(ruta, params=params)
    except httpx.HTTPError:
        raise HTTPException(502, f"El servicio de {nombre} no responde")
    if r.status_code != 200:
        raise HTTPException(502, f"El servicio de {nombre} respondio {r.status_code}")
    return r.json()


@api.get("/historico/{sensor_id}")
async def historico(sensor_id: str, horas: int = Query(24, ge=1, le=168)):
    """Promedio por intervalo de cada variable en las ultimas `horas`, con los datos ya limpios
    (sin lecturas imposibles, picos ni duplicados). Llegan con hasta 15 min de retraso."""
    if not ID_VALIDO.match(sensor_id):
        raise HTTPException(422, "Id de sensor invalido")
    datos = await _pedir(limpieza, "limpieza", f"/mediciones/{quote(sensor_id, safe='')}", {"horas": horas})
    datos["series"] = {n: s for n, s in datos["series"].items() if n in config.VARIABLES}
    return datos


@api.get("/alertas")
async def alertas_activas():
    """Alertas abiertas: que esta pasando en el cultivo y que se recomienda hacer."""
    lista = await _pedir(alertas, "alertas", "/alertas", {"activas": "true"})
    campos = ("sensor_id", "variable", "operador", "limite", "titulo", "accion", "valor", "inicio")
    return [{c: a[c] for c in campos} for a in lista]


app.include_router(api)

# El front compilado se monta al final para que no tape las rutas de la API
CARPETA_FRONT = Path(__file__).resolve().parent.parent / "static"
if CARPETA_FRONT.is_dir():
    app.mount("/", StaticFiles(directory=CARPETA_FRONT, html=True), name="front")
