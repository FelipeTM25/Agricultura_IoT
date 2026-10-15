"""Entrada de lecturas de los nodos sensores.

Los dispositivos ya no escriben directo en Orion (que no tiene autenticacion y no se publica
a internet): mandan sus lecturas aqui con su clave, el gestor las valida y las reenvia a
Orion por la red interna de Docker.

    POST /api/dispositivos/<id>/lecturas   cabecera X-Api-Key: <clave del dispositivo>
    {"temperatura": 23.4, "humedad": 61.2, "ubicacion": {"lat": 6.2425, "lon": -75.5895}}
"""
import hmac
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

from . import config, orion
from .modelos import NombreAtributo

MAXIMO_VARIABLES = 30
# NaN e infinito no son JSON valido para Orion
Valor = Annotated[float, Field(allow_inf_nan=False)]


class Ubicacion(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


def dispositivo_autorizado(dispositivo_id: str, clave: str | None = Header(None, alias="X-Api-Key")) -> str:
    """Dependencia: la clave tiene que ser la de ESE dispositivo (no sirve la de otro)."""
    esperada = config.DISPOSITIVOS.get(dispositivo_id)
    # compare_digest evita que el tiempo de respuesta revele cuantos caracteres coinciden
    if not esperada or not clave or not hmac.compare_digest(clave.encode(), esperada.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Dispositivo desconocido o clave incorrecta")
    return dispositivo_id


router = APIRouter(prefix="/api/dispositivos", tags=["dispositivos"])


@router.get("/{dispositivo_id}/ping")
async def ping(dispositivo_id: str = Depends(dispositivo_autorizado)):
    """Lo usa el nodo al arrancar para comprobar su clave y que el gestor llega a Orion."""
    try:
        await orion.pedir("GET", "/version")
        orion_ok = True
    except HTTPException:
        orion_ok = False
    return {"dispositivo": dispositivo_id, "orion": orion_ok}


@router.post("/{dispositivo_id}/lecturas", status_code=status.HTTP_204_NO_CONTENT)
async def recibir_lecturas(
    lecturas: dict[NombreAtributo, Valor | Ubicacion] = Body(
        ..., examples=[{"temperatura": 23.4, "humedad": 61.2, "ubicacion": {"lat": 6.2425, "lon": -75.5895}}]
    ),
    dispositivo_id: str = Depends(dispositivo_autorizado),
):
    """Valida las lecturas y las guarda en Orion (crea la entidad si no existe)."""
    if not lecturas:
        raise HTTPException(422, "No llego ninguna lectura")
    if len(lecturas) > MAXIMO_VARIABLES:
        raise HTTPException(422, f"Maximo {MAXIMO_VARIABLES} variables por envio")
    if {"id", "type"} & lecturas.keys():
        raise HTTPException(422, "'id' y 'type' no son nombres de variable validos")

    entidad = {"id": dispositivo_id, "type": config.TIPO_DISPOSITIVO}
    for nombre, valor in lecturas.items():
        if isinstance(valor, Ubicacion):
            # GeoJSON pone primero la longitud
            entidad[nombre] = {"type": "geo:json", "value": {"type": "Point", "coordinates": [valor.lon, valor.lat]}}
        else:
            entidad[nombre] = {"type": "Number", "value": valor}

    # append: crea la entidad si no existe y si existe actualiza solo estas variables
    await orion.pedir("POST", "/v2/op/update", json={"actionType": "append", "entities": [entidad]})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
