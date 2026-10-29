"""Configuracion de la landing, leida de variables de entorno."""
import os

ORION_URL = os.getenv("ORION_URL", "http://localhost:1026").rstrip("/")
# Servicios internos: historico limpio (Postgres) y alertas
LIMPIEZA_URL = os.getenv("LIMPIEZA_URL", "http://localhost:8002").rstrip("/")
ALERTAS_URL = os.getenv("ALERTAS_URL", "http://localhost:8003").rstrip("/")

# Tipo de entidad que se muestra en la landing (el que publica el nodo LilyGO)
TIPO_SENSOR = os.getenv("TIPO_SENSOR", "SensorAgricola")

# Variables numericas que se grafican. Deben coincidir con los atributos del nodo.
VARIABLES = ["temperatura", "humedad", "humedadSuelo", "luz", "radiacion"]
