"""API del gestor de Orion: login del administrador, entidades, suscripciones e historico.

Todas las rutas viven bajo /api. La documentacion interactiva queda en /docs.
Si existe la carpeta static/ (el front de React ya compilado), se sirve en /.
"""
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.staticfiles import StaticFiles

from . import auth, historico, orion
from .modelos import Atributo, Credenciales, EntidadNueva, NombreAtributo, SuscripcionNueva

LIMITE = 1000  # maximo que Orion devuelve por pagina


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    yield
    await orion.cliente.aclose()
    await historico.cliente.aclose()


app = FastAPI(title="Gestor Orion - Agricultura IoT", version="0.1.0", lifespan=ciclo_de_vida)

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


@protegida.post("/entidades", status_code=status.HTTP_201_CREATED, tags=["entidades"])
async def crear_entidad(entidad: EntidadNueva):
    await orion.pedir("POST", "/v2/entities", json=entidad.a_ngsi())
    return {"id": entidad.id}


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


app.include_router(publica)
app.include_router(protegida)

# El front compilado se monta al final para que no tape las rutas de la API ni /docs
CARPETA_FRONT = Path(__file__).resolve().parent.parent / "static"
if CARPETA_FRONT.is_dir():
    app.mount("/", StaticFiles(directory=CARPETA_FRONT, html=True), name="front")
