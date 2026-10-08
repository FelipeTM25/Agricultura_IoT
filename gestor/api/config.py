"""Configuracion del gestor, leida de variables de entorno (archivo gestor/.env)."""
import os
import sys


def _obligatoria(nombre: str) -> str:
    valor = os.getenv(nombre, "").strip()
    if not valor:
        sys.exit(f"Falta la variable de entorno {nombre} (ver gestor/.env.example)")
    return valor


ORION_URL = os.getenv("ORION_URL", "http://localhost:1026").rstrip("/")

# Unico usuario del sistema por ahora: el administrador.
ADMIN_USER = _obligatoria("ADMIN_USER")
ADMIN_PASSWORD = _obligatoria("ADMIN_PASSWORD")

# Clave para firmar los tokens de sesion. Si cambia, todas las sesiones se cierran.
JWT_SECRET = _obligatoria("JWT_SECRET")
TOKEN_HORAS = int(os.getenv("TOKEN_HORAS", "8"))
