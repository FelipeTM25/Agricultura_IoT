#!/bin/bash
# Peticiones de ejemplo contra Orion para probar el flujo completo:
# crear un sensor, suscribir QuantumLeap, actualizar valores y consultar.
#
# Uso:  ./ejemplos-api.sh [host]
#   host por defecto: localhost (ejecutando dentro de la EC2).
#   Orion solo escucha en 127.0.0.1 de la instancia: desde otro equipo hay que abrir
#   antes un tunel  ssh -i llave.pem -L 1026:localhost:1026 ubuntu@<host>  y usar localhost.

HOST="${1:-localhost}"
ORION="http://$HOST:1026"

echo "== 1. Crear la entidad sensor01 (tipo temperatura)"
curl -iX POST "$ORION/v2/entities" \
  -H 'Content-Type: application/json' \
  -d '{"id":"sensor01","type":"temperatura","temperatura":{"value":21,"type":"Float"}}'
echo

echo "== 2. Suscribir QuantumLeap a los cambios de temperatura"
curl -iX POST "$ORION/v2/subscriptions" \
  -H 'Content-Type: application/json' \
  -d '{
  "description": "Notificar sensor de temperatura",
  "subject": {
    "entities": [{ "idPattern": ".*", "type": "temperatura" }],
    "condition": { "attrs": ["temperatura"] }
  },
  "notification": {
    "http": { "url": "http://quantumleap:8668/v2/notify" },
    "attrs": ["id", "temperatura"],
    "metadata": ["dateCreated", "dateModified"]
  }
}'
echo

echo "== 3. Actualizar el valor de temperatura"
curl -iX PATCH "$ORION/v2/entities/sensor01/attrs" \
  -H 'Content-Type: application/json' \
  -d '{"temperatura":{"value":22,"type":"Float"}}'
echo

echo "== 4. Consultar el estado actual en Orion"
curl -s "$ORION/v2/entities"
echo
