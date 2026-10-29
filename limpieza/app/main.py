"""Servicio de limpieza: corre solo cada LIMPIEZA_INTERVALO_MIN y tambien a pedido.

No se publica fuera de la red de Docker: el gestor lo llama por http://limpieza:8000.
- GET  /estado                     ultimas ejecuciones, resumen de Postgres y reglas aplicadas
- GET  /mediciones/{id}?horas=     serie limpia de un sensor (historico del gestor y la landing)
- POST /limpiar                    ejecuta una limpieza ahora (boton "Limpiar ahora" del gestor)
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Query

from . import config, proceso, reglas

log = logging.getLogger("uvicorn.error")
proxima: datetime | None = None


async def _programador():
    """Limpia cada INTERVALO_MIN. La primera vuelta es al minuto de arrancar."""
    global proxima
    espera = 60
    while True:
        proxima = datetime.now(timezone.utc) + timedelta(seconds=espera)
        await asyncio.sleep(espera)
        try:
            resultado = await proceso.limpiar("automatico")
            log.info("Limpieza automatica: %s", resultado)
        except Exception as e:  # el programador no se puede caer por una vuelta fallida
            log.error("Limpieza automatica fallo: %s", e)
        espera = config.INTERVALO_MIN * 60


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    tarea = asyncio.create_task(_programador()) if config.INTERVALO_MIN > 0 else None
    yield
    if tarea:
        tarea.cancel()


app = FastAPI(title="Limpieza - Agricultura IoT", version="0.1.0", lifespan=ciclo_de_vida)


@app.get("/estado")
async def estado():
    return {
        "intervalo_min": config.INTERVALO_MIN,
        "intervalo_datos_min": config.INTERVALO_DATOS_MIN,
        "proxima": proxima.isoformat() if proxima and config.INTERVALO_MIN > 0 else None,
        "en_curso": proceso.candado.locked(),
        "reglas": {
            "rangos": reglas.RANGOS,
            "salto_maximo": reglas.SALTO_MAXIMO,
            "descripcion": reglas.DESCRIPCION,
        },
        **await proceso.estado(),
    }


def _intervalo(horas: int) -> timedelta:
    """Tamano del intervalo segun el rango, igual que el historico crudo del gestor y la landing."""
    if horas <= 6:
        return timedelta(minutes=5)
    if horas <= 24:
        return timedelta(minutes=15)
    return timedelta(hours=1)


@app.get("/mediciones/{sensor_id}")
async def mediciones(sensor_id: str, horas: int = Query(24, ge=1, le=168)):
    desde = datetime.now(timezone.utc) - timedelta(hours=horas)
    return await proceso.mediciones(sensor_id, desde, _intervalo(horas))


@app.post("/limpiar")
async def limpiar():
    try:
        return await proceso.limpiar("manual")
    except RuntimeError as e:  # ya habia una limpieza corriendo
        raise HTTPException(409, str(e))
