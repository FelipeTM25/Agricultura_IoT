"""Configuracion del servicio de limpieza, leida de variables de entorno."""
import os
import sys


def _obligatoria(nombre: str) -> str:
    valor = os.getenv(nombre, "").strip()
    if not valor:
        sys.exit(f"Falta la variable de entorno {nombre} (ver .env.example en la raiz del repo)")
    return valor


CRATE_URL = os.getenv("CRATE_URL", "http://localhost:4200").rstrip("/")

POSTGRES_DSN = (
    f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
    f"port={os.getenv('POSTGRES_PORT', '5432')} "
    f"dbname={os.getenv('POSTGRES_DB', 'agricultura')} "
    f"user={os.getenv('POSTGRES_USER', 'agricultura')} "
    f"password={_obligatoria('POSTGRES_PASSWORD')}"
)

# Cada cuanto se limpia sola (minutos). 0 = solo a mano (boton del gestor).
INTERVALO_MIN = int(os.getenv("LIMPIEZA_INTERVALO_MIN", "15"))

# Tamano de los intervalos en los que se promedian los datos limpios (minutos)
INTERVALO_DATOS_MIN = int(os.getenv("LIMPIEZA_INTERVALO_DATOS_MIN", "5"))
