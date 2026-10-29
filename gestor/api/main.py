"""API del gestor de Orion: login del administrador, entidades, suscripciones, historico, limpieza,
alertas y entrada de lecturas de los dispositivos (que ya no escriben directo en Orion).

Todas las rutas viven bajo /api. La documentacion interactiva queda en /docs.
Si existe la carpeta static/ (el front de React ya compilado), se sirve en /.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, config, dispositivos, historico, orion
from .modelos import Atributo, Credenciales, EntidadNueva, NombreAtributo, SuscripcionNueva

LIMITE = 1000  # maximo que Orion devuelve por pagina


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    yield
    await orion.cliente.aclose()
    await historico.cliente.aclose()


app = FastAPI(title="Gestor Orion - Agricultura IoT", version="0.1.0", lifespan=ciclo_de_vida)



@app.exception_handler(RequestValidationError)
async def error_de_validacion(request, exc: RequestValidationError):
    """Errores 422 sin repetir el valor recibido: si venia un NaN, no se puede devolver
    como JSON y la respuesta terminaba en error 500."""
    detalle = [{k: v for k, v in e.items() if k not in ("input", "ctx")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(detalle)})


publica = APIRouter(prefix="/api")
protegida = APIRouter(prefix="/api", dependencies=[Depends(auth.usuario_actual)])


# --- Sesion -------------------------------------------------------------------

@publica.post("/auth/login", tags=["sesion"])
def login(cred: Credenciales):
    if not auth.credenciales_validas(cred.usuario, cred.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario o contraseña incorrectos")
    return {"token": auth.crear_token(cred.usuario), "usuario": cred.usuario}


@protegida.get("/auth/yo", tags=["sesion"])
def yo(usuario: str = Depends(auth.usuario_actual)):
    return {"usuario": usuario}


@protegida.get("/estado", tags=["sesion"])
async def estado():
    """Version de Orion: sirve para saber si el broker responde."""
    return (await orion.pedir("GET", "/version")).json()


# --- Entidades ----------------------------------------------------------------

@protegida.get("/entidades", tags=["entidades"])
async def listar_entidades(tipo: str | None = None):
    params = {"limit": LIMITE}
    if tipo:
        params["type"] = tipo
    return (await orion.pedir("GET", "/v2/entities", params=params)).json()


@protegida.get("/entidades/{entidad_id}", tags=["entidades"])
async def ver_entidad(entidad_id: str):
    return (await orion.pedir("GET", f"/v2/entities/{quote(entidad_id, safe='')}")).json()


URL_QUANTUMLEAP = SuscripcionNueva.model_fields["url_notificacion"].default


async def asegurar_suscripcion_historico(tipo: str) -> dict:
    """Crea la suscripcion Orion -> QuantumLeap para `tipo`, salvo que ya haya una que lo cubra.

    Cubre si notifica a QuantumLeap, aplica a ese tipo (o a cualquiera) y a todos los ids (.*).
    Asi crear varios sensores del mismo tipo no llena Orion de suscripciones repetidas.
    """
    existentes = (await orion.pedir("GET", "/v2/subscriptions", params={"limit": LIMITE})).json()
    for s in existentes:
        if s.get("notification", {}).get("http", {}).get("url") != URL_QUANTUMLEAP:
            continue
        if s.get("status", "active") not in ("active", "failed"):
            continue
        for e in s.get("subject", {}).get("entities", []):
            if e.get("type") in (tipo, None) and e.get("idPattern") == ".*":
                return {"estado": "existente", "id": s["id"]}

    nueva = SuscripcionNueva(descripcion=f"Historico de {tipo} en CrateDB - creada automaticamente", tipo_entidad=tipo)
    respuesta = await orion.pedir("POST", "/v2/subscriptions", json=nueva.a_ngsi())
    return {"estado": "creada", "id": respuesta.headers.get("Location", "").rsplit("/", 1)[-1]}


@protegida.post("/entidades", status_code=status.HTTP_201_CREATED, tags=["entidades"])
async def crear_entidad(entidad: EntidadNueva):
    await orion.pedir("POST", "/v2/entities", json=entidad.a_ngsi())
    if not entidad.guardar_historico:
        return {"id": entidad.id, "suscripcion": None}
    # La entidad ya quedo creada: si falla la suscripcion se informa sin deshacer lo anterior
    try:
        suscripcion = await asegurar_suscripcion_historico(entidad.type)
    except HTTPException as e:
        suscripcion = {"estado": "error", "detalle": e.detail}
    return {"id": entidad.id, "suscripcion": suscripcion}


@protegida.put("/entidades/{entidad_id}/atributos", status_code=status.HTTP_204_NO_CONTENT, tags=["entidades"])
async def guardar_atributos(entidad_id: str, atributos: dict[NombreAtributo, Atributo]):
    """Actualiza los atributos enviados y agrega los que no existian (los demas no se tocan)."""
    cuerpo = {n: a.a_ngsi() for n, a in atributos.items()}
    await orion.pedir("POST", f"/v2/entities/{quote(entidad_id, safe='')}/attrs", json=cuerpo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@protegida.delete("/entidades/{entidad_id}/atributos/{nombre}", status_code=status.HTTP_204_NO_CONTENT, tags=["entidades"])
async def borrar_atributo(entidad_id: str, nombre: str):
    await orion.pedir("DELETE", f"/v2/entities/{quote(entidad_id, safe='')}/attrs/{quote(nombre, safe='')}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@protegida.delete("/entidades/{entidad_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["entidades"])
async def borrar_entidad(entidad_id: str):
    await orion.pedir("DELETE", f"/v2/entities/{quote(entidad_id, safe='')}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@protegida.get("/entidades/{entidad_id}/historico", tags=["entidades"])
async def historico_entidad(entidad_id: str, tipo: str | None = None, horas: int = Query(24, ge=1, le=168)):
    """Serie de tiempo de cada atributo numerico (QuantumLeap -> CrateDB), promediada por intervalos.

    Solo hay datos si existe una suscripcion de Orion hacia QuantumLeap para esa entidad.
    """
    return await historico.consultar(entidad_id, tipo, horas)


@protegida.get("/entidades/{entidad_id}/limpios", tags=["entidades"])
async def limpios_entidad(entidad_id: str, horas: int = Query(24, ge=1, le=168)):
    """Serie ya limpia de cada variable (Postgres, la escribe el servicio de limpieza cada 15 min)."""
    return await _servicio("limpieza", "GET", f"/mediciones/{quote(entidad_id, safe='')}", params={"horas": horas})


@protegida.get("/entidades/{entidad_id}/exportar", tags=["entidades"])
async def exportar_entidad(
    entidad_id: str,
    desde: datetime,
    hasta: datetime,
    tipo: str | None = None,
    atributos: str = Query("", description="Separados por coma. Vacio = todos los numericos"),
    intervalo_min: int = Query(0, ge=0, le=1440, description="0 = cada lectura; si no, promedio por intervalo"),
    formato: Literal["csv", "json"] = "csv",
    separador: Literal[",", ";"] = ",",
):
    """Descarga el historico de una entidad (QuantumLeap -> CrateDB) como CSV o JSON."""
    desde = desde if desde.tzinfo else desde.replace(tzinfo=timezone.utc)
    hasta = hasta if hasta.tzinfo else hasta.replace(tzinfo=timezone.utc)
    if hasta <= desde:
        raise HTTPException(422, "La fecha final debe ser posterior a la inicial")

    lista = [a.strip() for a in atributos.split(",") if a.strip()]
    contenido, tipo_mime = await historico.exportar(entidad_id, tipo, desde, hasta, lista, intervalo_min, formato, separador)
    nombre = f"{entidad_id}_{desde:%Y%m%d-%H%M}_{hasta:%Y%m%d-%H%M}.{formato}"
    return Response(contenido, media_type=tipo_mime, headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


# --- Suscripciones ------------------------------------------------------------

@protegida.get("/suscripciones", tags=["suscripciones"])
async def listar_suscripciones():
    return (await orion.pedir("GET", "/v2/subscriptions", params={"limit": LIMITE})).json()


@protegida.post("/suscripciones", status_code=status.HTTP_201_CREATED, tags=["suscripciones"])
async def crear_suscripcion(suscripcion: SuscripcionNueva):
    respuesta = await orion.pedir("POST", "/v2/subscriptions", json=suscripcion.a_ngsi())
    # Orion devuelve el id en la cabecera Location: /v2/subscriptions/<id>
    return {"id": respuesta.headers.get("Location", "").rsplit("/", 1)[-1]}


@protegida.delete("/suscripciones/{suscripcion_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["suscripciones"])
async def borrar_suscripcion(suscripcion_id: str):
    await orion.pedir("DELETE", f"/v2/subscriptions/{quote(suscripcion_id, safe='')}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Servicios internos: limpieza (CrateDB -> Postgres) y alertas ---------------

SERVICIOS = {"limpieza": config.LIMPIEZA_URL, "alertas": config.ALERTAS_URL}


async def _servicio(nombre: str, metodo: str, ruta: str, timeout: float = 15, **kwargs) -> Any:
    url = SERVICIOS[nombre]
    try:
        async with httpx.AsyncClient(base_url=url, timeout=timeout) as cliente:
            r = await cliente.request(metodo, ruta, **kwargs)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"No se pudo conectar con el servicio de {nombre} ({url}): {e}")
    if r.status_code >= 400:
        try:
            detalle = r.json().get("detail", r.text)
        except ValueError:
            detalle = r.text
        raise HTTPException(r.status_code, detalle if isinstance(detalle, list) else f"{nombre.capitalize()}: {detalle}")
    return None if r.status_code == 204 else r.json()


@protegida.get("/limpieza", tags=["limpieza"])
async def estado_limpieza():
    """Ultimas ejecuciones, resumen de los datos limpios en Postgres y reglas aplicadas."""
    return await _servicio("limpieza", "GET", "/estado")


@protegida.post("/limpieza/ejecutar", tags=["limpieza"])
async def ejecutar_limpieza():
    """Limpia ahora lo nuevo de CrateDB y lo guarda en Postgres (ademas de la limpieza automatica)."""
    return await _servicio("limpieza", "POST", "/limpiar", 300)


@protegida.get("/alertas", tags=["alertas"])
async def listar_alertas(activas: bool = False, limite: int = Query(50, ge=1, le=500)):
    """Historial de alertas (las abiertas no tienen `fin`)."""
    return await _servicio("alertas", "GET", "/alertas", params={"activas": activas, "limite": limite})


@protegida.get("/alertas/estado", tags=["alertas"])
async def estado_alertas():
    """Si el correo esta configurado, la suscripcion de Orion que alimenta las alertas y cuantas hay abiertas."""
    return await _servicio("alertas", "GET", "/estado")


@protegida.post("/alertas/probar", tags=["alertas"])
async def probar_alertas():
    """Manda un correo de prueba a los destinatarios de las alertas."""
    return await _servicio("alertas", "POST", "/probar")


@protegida.get("/alertas/umbrales", tags=["alertas"])
async def listar_umbrales():
    return await _servicio("alertas", "GET", "/umbrales")


# El servicio de alertas valida el cuerpo; aqui solo se reenvia
@protegida.post("/alertas/umbrales", status_code=status.HTTP_201_CREATED, tags=["alertas"])
async def crear_umbral(umbral: dict = Body(...)):
    return await _servicio("alertas", "POST", "/umbrales", json=umbral)


@protegida.put("/alertas/umbrales/{umbral_id}", tags=["alertas"])
async def editar_umbral(umbral_id: int, umbral: dict = Body(...)):
    return await _servicio("alertas", "PUT", f"/umbrales/{umbral_id}", json=umbral)


@protegida.delete("/alertas/umbrales/{umbral_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["alertas"])
async def borrar_umbral(umbral_id: int):
    await _servicio("alertas", "DELETE", f"/umbrales/{umbral_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


app.include_router(publica)
app.include_router(dispositivos.router)
app.include_router(protegida)


class Front(StaticFiles):
    """Archivos del front. El index.html se revalida siempre: si el navegador lo guarda, sigue
    pidiendo el JS viejo despues de un despliegue. Los de assets/ llevan un hash en el nombre
    (cambia en cada build), asi que esos si se pueden guardar."""

    async def get_response(self, path, scope):
        respuesta = await super().get_response(path, scope)
        if not path.replace("\\", "/").startswith("assets/"):  # en Windows llega con \
            respuesta.headers["Cache-Control"] = "no-cache"
        return respuesta


# El front compilado se monta al final para que no tape las rutas de la API ni /docs
CARPETA_FRONT = Path(__file__).resolve().parent.parent / "static"
if CARPETA_FRONT.is_dir():
    app.mount("/", Front(directory=CARPETA_FRONT, html=True), name="front")
