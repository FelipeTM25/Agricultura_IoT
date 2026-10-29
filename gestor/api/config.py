"""Configuracion del gestor, leida de variables de entorno (archivo gestor/.env)."""
import os
import sys


def _obligatoria(nombre: str) -> str:
    valor = os.getenv(nombre, "").strip()
    if not valor:
        sys.exit(f"Falta la variable de entorno {nombre} (ver gestor/.env.example)")
    return valor


ORION_URL = os.getenv("ORION_URL", "http://localhost:1026").rstrip("/")
QUANTUMLEAP_URL = os.getenv("QUANTUMLEAP_URL", "http://localhost:8668").rstrip("/")
# Servicio que limpia CrateDB -> Postgres (solo accesible dentro de la red de Docker)
LIMPIEZA_URL = os.getenv("LIMPIEZA_URL", "http://localhost:8002").rstrip("/")
# Servicio de alertas: umbrales y alertas abiertas (tambien solo dentro de la red de Docker)
ALERTAS_URL = os.getenv("ALERTAS_URL", "http://localhost:8003").rstrip("/")

# Unico usuario del sistema por ahora: el administrador.
ADMIN_USER = _obligatoria("ADMIN_USER")
ADMIN_PASSWORD = _obligatoria("ADMIN_PASSWORD")

# Clave para firmar los tokens de sesion. Si cambia, todas las sesiones se cierran.
JWT_SECRET = _obligatoria("JWT_SECRET")
TOKEN_HORAS = int(os.getenv("TOKEN_HORAS", "8"))


def _dispositivos(texto: str) -> dict[str, str]:
    """'sensor01:clave1,sensor02:clave2' -> {'sensor01': 'clave1', 'sensor02': 'clave2'}"""
    claves = {}
    for par in texto.split(","):
        dispositivo, _, clave = par.strip().partition(":")
        if dispositivo and clave:
            claves[dispositivo.strip()] = clave.strip()
    return claves


# Dispositivos (nodos sensores) autorizados a enviar lecturas, cada uno con su propia clave.
# Es distinta del login del admin: con ella solo se pueden escribir lecturas de ese dispositivo.
DISPOSITIVOS = _dispositivos(os.getenv("DISPOSITIVOS", ""))
TIPO_DISPOSITIVO = os.getenv("TIPO_DISPOSITIVO", "SensorAgricola")
