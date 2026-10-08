"""Cliente HTTP hacia Orion (API NGSI-v2). Traduce los errores de Orion a errores de la API."""
import httpx
from fastapi import HTTPException

from . import config

cliente = httpx.AsyncClient(base_url=config.ORION_URL, timeout=10)


async def pedir(metodo: str, ruta: str, **kwargs) -> httpx.Response:
    try:
        respuesta = await cliente.request(metodo, ruta, **kwargs)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"No se pudo conectar con Orion ({config.ORION_URL}): {e}")

    if respuesta.status_code >= 400:
        # Orion responde {"error": "...", "description": "..."}
        try:
            cuerpo = respuesta.json()
            detalle = cuerpo.get("description") or cuerpo.get("error") or cuerpo
        except ValueError:
            detalle = respuesta.text or f"Orion respondio {respuesta.status_code}"
        raise HTTPException(respuesta.status_code, f"Orion: {detalle}")

    return respuesta
