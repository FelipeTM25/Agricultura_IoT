"""Configuracion del servicio de alertas, leida de variables de entorno."""
import os
import sys
from zoneinfo import ZoneInfo


def _obligatoria(nombre: str) -> str:
    valor = os.getenv(nombre, "").strip()
    if not valor:
        sys.exit(f"Falta la variable de entorno {nombre} (ver .env.example en la raiz del repo)")
    return valor


ORION_URL = os.getenv("ORION_URL", "http://localhost:1026").rstrip("/")
# Direccion con la que Orion llega a este servicio por la red de Docker
URL_NOTIFICACION = os.getenv("ALERTAS_URL_NOTIFICACION", "http://alertas:8000/notify")
TIPO_SENSOR = os.getenv("TIPO_SENSOR", "SensorAgricola")

POSTGRES_DSN = (
    f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
    f"port={os.getenv('POSTGRES_PORT', '5432')} "
    f"dbname={os.getenv('POSTGRES_DB', 'agricultura')} "
    f"user={os.getenv('POSTGRES_USER', 'agricultura')} "
    f"password={_obligatoria('POSTGRES_PASSWORD')}"
)

# Lecturas seguidas que deben cumplir (o dejar de cumplir) un umbral para abrir (o cerrar)
# una alerta. Con 2 y el nodo enviando cada 30 s, una alerta tarda ~1 min en confirmarse y
# un pico suelto no avisa a nadie.
CONFIRMAR_LECTURAS = max(1, int(os.getenv("ALERTAS_CONFIRMAR_LECTURAS", "2")))

# Correo de las alertas (opcional: sin usuario y contrasena las alertas solo se registran y se
# ven en el gestor y la landing). Con Gmail, SMTP_PASSWORD es una contrasena de aplicacion.
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USUARIO = os.getenv("SMTP_USUARIO", "").strip()
# Google muestra la contrasena de aplicacion en grupos con espacios: se aceptan tal cual
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").replace(" ", "")
# A quien le llegan, separados por coma. Vacio = al mismo SMTP_USUARIO
CORREO_DESTINO = [c.strip() for c in (os.getenv("ALERTAS_CORREO_DESTINO", "").strip() or SMTP_USUARIO).split(",") if c.strip()]

# Las horas de los correos se escriben en la hora de Colombia (Postgres guarda UTC)
ZONA_HORARIA = ZoneInfo(os.getenv("ZONA_HORARIA", "America/Bogota"))
