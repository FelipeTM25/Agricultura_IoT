"""Login del administrador y validacion del token (JWT) en cada peticion."""
import hmac
import time

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config

_bearer = HTTPBearer(auto_error=False)


def credenciales_validas(usuario: str, password: str) -> bool:
    # compare_digest evita que el tiempo de respuesta revele cuantos caracteres coinciden
    usuario_ok = hmac.compare_digest(usuario.encode(), config.ADMIN_USER.encode())
    password_ok = hmac.compare_digest(password.encode(), config.ADMIN_PASSWORD.encode())
    return usuario_ok and password_ok


def crear_token(usuario: str) -> str:
    ahora = int(time.time())
    datos = {"sub": usuario, "iat": ahora, "exp": ahora + config.TOKEN_HORAS * 3600}
    return jwt.encode(datos, config.JWT_SECRET, algorithm="HS256")


def usuario_actual(cred: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    """Dependencia de FastAPI: rechaza la peticion si no trae un token valido."""
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Debes iniciar sesión")
    try:
        datos = jwt.decode(cred.credentials, config.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "La sesión expiró, vuelve a entrar")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido")
    return datos["sub"]
