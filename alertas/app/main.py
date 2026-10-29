"""Servicio de alertas (manejador de mensajes): Orion le notifica cada lectura de los
sensores por una suscripcion, y aqui se decide si hay que avisar.

No se publica fuera de la red de Docker: Orion lo llama en http://alertas:8000/notify y el
gestor y la landing leen las alertas por la misma red.
- POST   /notify            notificaciones de Orion (NGSI-v2)
- GET    /estado            correo, suscripcion en Orion y alertas activas
- GET    /alertas           historial (?activas=true solo las abiertas)
- GET    /umbrales          reglas de decision; POST, PUT /{id} y DELETE /{id} para editarlas
- POST   /probar            manda un correo de prueba

La suscripcion Orion -> alertas la crea este mismo servicio al arrancar (y la revisa cada
5 min, por si alguien la borra desde el gestor).
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import Body, FastAPI, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from . import config, correo, motor

log = logging.getLogger("uvicorn.error")
REVISAR_SUSCRIPCION_S = 5 * 60
suscripcion: dict = {"id": None, "revisada": None, "error": None}


async def _asegurar_suscripcion() -> None:
    """Crea la suscripcion de Orion hacia este servicio si no existe."""
    async with httpx.AsyncClient(base_url=config.ORION_URL, timeout=10) as orion:
        r = await orion.get("/v2/subscriptions", params={"limit": 1000})
        r.raise_for_status()
        for s in r.json():
            if s.get("notification", {}).get("http", {}).get("url") == config.URL_NOTIFICACION:
                suscripcion["id"] = s["id"]
                return
        r = await orion.post(
            "/v2/subscriptions",
            json={
                # Orion rechaza < > " ' = ; ( ) en la descripcion
                "description": f"Alertas de {config.TIPO_SENSOR} - creada por el servicio de alertas",
                "subject": {
                    "entities": [{"idPattern": ".*", "type": config.TIPO_SENSOR}],
                    "condition": {"attrs": motor.VARIABLES},
                },
                "notification": {"http": {"url": config.URL_NOTIFICACION}, "attrs": motor.VARIABLES},
            },
        )
        r.raise_for_status()
        suscripcion["id"] = r.headers.get("Location", "").rsplit("/", 1)[-1]
        log.info("Suscripcion de alertas creada en Orion: %s", suscripcion["id"])


async def _vigilar_suscripcion():
    # Orion puede tardar en arrancar: al principio se reintenta cada 15 s
    espera = 15
    while True:
        try:
            await _asegurar_suscripcion()
            suscripcion["error"] = None
            espera = REVISAR_SUSCRIPCION_S
        except httpx.HTTPError as e:
            suscripcion["error"] = f"Orion: {e}"
            log.warning("No se pudo revisar la suscripcion de alertas: %s", e)
        suscripcion["revisada"] = datetime.now(timezone.utc)
        await asyncio.sleep(espera)


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    await motor.preparar_base()
    tarea = asyncio.create_task(_vigilar_suscripcion())
    yield
    tarea.cancel()


app = FastAPI(title="Alertas - Agricultura IoT", version="0.1.0", lifespan=ciclo_de_vida)


@app.post("/notify", status_code=status.HTTP_204_NO_CONTENT)
async def notificacion(cuerpo: dict = Body(...)):
    """Formato de Orion: {"subscriptionId": "...", "data": [{"id", "type", "<attr>": {"value"}}]}"""
    cambios = await motor.evaluar(cuerpo.get("data") or [])
    for c in cambios:
        log.info("Alerta %s: %s", c["cambio"], c)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/estado")
async def estado():
    async with await motor.conectar() as pg:
        activas = (await (await pg.execute("SELECT count(*) AS n FROM alertas WHERE fin IS NULL")).fetchone())["n"]
    return {
        "correo": correo.configurado(),
        "destino": config.CORREO_DESTINO if correo.configurado() else [],
        "confirmar_lecturas": config.CONFIRMAR_LECTURAS,
        "suscripcion": suscripcion,
        "activas": activas,
    }


@app.get("/alertas")
async def alertas(activas: bool = False, sensor: str | None = None, limite: int = Query(50, ge=1, le=500)):
    condiciones, args = [], []
    if activas:
        condiciones.append("fin IS NULL")
    if sensor:
        condiciones.append("sensor_id = %s")
        args.append(sensor)
    donde = f"WHERE {' AND '.join(condiciones)}" if condiciones else ""
    async with await motor.conectar() as pg:
        return await (
            await pg.execute(f"SELECT * FROM alertas {donde} ORDER BY inicio DESC LIMIT %s", (*args, limite))
        ).fetchall()


# --- Umbrales -----------------------------------------------------------------

class Umbral(BaseModel):
    variable: Literal["temperatura", "humedad", "humedadSuelo", "luz", "radiacion"]
    operador: Literal[">", "<"]
    valor: float = Field(allow_inf_nan=False)
    titulo: str = Field(min_length=1, max_length=80)
    accion: str = Field("", max_length=200)
    activo: bool = True


@app.get("/umbrales")
async def umbrales():
    async with await motor.conectar() as pg:
        return await (await pg.execute("SELECT * FROM umbrales ORDER BY variable, operador, valor")).fetchall()


@app.post("/umbrales", status_code=status.HTTP_201_CREATED)
async def crear_umbral(u: Umbral):
    async with await motor.conectar() as pg:
        return await (
            await pg.execute(
                "INSERT INTO umbrales (variable, operador, valor, titulo, accion, activo) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
                (u.variable, u.operador, u.valor, u.titulo, u.accion, u.activo),
            )
        ).fetchone()


@app.put("/umbrales/{umbral_id}")
async def editar_umbral(umbral_id: int, u: Umbral):
    async with motor.candado, await motor.conectar() as pg:
        fila = await (
            await pg.execute(
                "UPDATE umbrales SET variable = %s, operador = %s, valor = %s, titulo = %s, accion = %s, activo = %s "
                "WHERE id = %s RETURNING *",
                (u.variable, u.operador, u.valor, u.titulo, u.accion, u.activo, umbral_id),
            )
        ).fetchone()
        if not fila:
            raise HTTPException(404, "No existe ese umbral")
        if not u.activo:
            await motor.cerrar_de_umbral(pg, umbral_id)
        return fila


@app.delete("/umbrales/{umbral_id}", status_code=status.HTTP_204_NO_CONTENT)
async def borrar_umbral(umbral_id: int):
    async with motor.candado, await motor.conectar() as pg:
        await motor.cerrar_de_umbral(pg, umbral_id)
        if (await pg.execute("DELETE FROM umbrales WHERE id = %s", (umbral_id,))).rowcount == 0:
            raise HTTPException(404, "No existe ese umbral")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/probar")
async def probar():
    if not correo.configurado():
        raise HTTPException(409, "El correo no esta configurado: faltan SMTP_USUARIO y SMTP_PASSWORD en el .env")
    if not await correo.enviar(
        "🌱 Prueba de Agricultura IoT",
        "Si lees esto, las alertas del cultivo llegaran a este correo.\n" + motor.PIE,
    ):
        raise HTTPException(502, "No se pudo enviar: revisa SMTP_USUARIO y la contrasena de aplicacion (ver logs del servicio)")
    return {"enviado": True, "destino": config.CORREO_DESTINO}
