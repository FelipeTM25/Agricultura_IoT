# Agricultura IoT - contexto del proyecto

Proyecto final de la materia IoT (UPB). Plataforma FIWARE para monitoreo agricola,
desplegada con Docker Compose en una instancia EC2 Ubuntu.

## Arquitectura
Sensor --HTTP--> Orion-LD :1026 (estado actual, MongoDB) --suscripcion--> QuantumLeap :8668
--> CrateDB :4200/:5432 (historico, tablas doc.et<tipo>) --> Grafana :3000

## Archivos
- `docker-compose.yml`: todos los servicios. Debe mantenerse identico al de la EC2.
- `ejemplos-api.sh`: peticiones de ejemplo (crear sensor01, suscribir QuantumLeap, PATCH, GET). Recibe el host como parametro.
- `README.md`: pasos de despliegue en EC2 para quien clone el repo.
- `gestor/`: gestor de Orion en un solo contenedor (puerto 8000). Dockerfile multi-etapa:
  compila `front/` (React + Vite) y lo sirve como estatico desde `api/` (FastAPI, rutas bajo `/api`,
  docs en `/docs`). Login de un unico admin con JWT; credenciales en `gestor/.env` (no se sube,
  plantilla en `gestor/.env.example`). La API habla con Orion por NGSI-v2 (`ORION_URL`).

- `sensor-lilygo/`: firmware PlatformIO del nodo (antes `TXlora`, que transmitia por LoRa para un
  examen). Credenciales en `include/secretos.h` (no se sube, plantilla `secretos.example.h`).
  `src/LoRaBoards.*` y `utilities.h` son del ejemplo de LilyGO; solo se desactivo su softAP WiFi.

## Modelo del sensor
LilyGO T-Beam (ESP32, AXP192, GPS en Serial1 34/12, OLED). Cada `PERIODO_TX_MS` (30 s) promedia 20
muestras y hace `POST /v2/op/update` con `actionType: append` a Orion :1026 (crea la entidad si no
existe; las variables sin lectura valida no se mandan). Entidad `sensor01`, tipo `SensorAgricola`:
- `temperatura` (°C) y `humedad` (% aire): HDC1080, I2C 0x40.
- `luz` (lux) y `radiacion` (cuentas IR 0..1023, indicador relativo, no W/m2): CJMCU-3216 = AP3216C,
  I2C 0x1E, driver propio en `src/Ap3216.h`. Satura en ~20661 lux (sol directo).
- `humedadSuelo` (%): sensor capacitivo analogico en GPIO36 (VP). Debe ser ADC1: ADC2 no funciona con
  WiFi. Calibrar `SUELO_SECO_RAW` / `SUELO_MOJADO_RAW` en main.cpp.
- `ubicacion` (geo:json Point [lon, lat]): GPS, solo se manda con fix.
Ambos sensores I2C van al bus de la placa (SDA 21 / SCL 22, 3V3, GND), compartido con PMU 0x34 y OLED 0x3C.
Un tipo por dispositivo => QuantumLeap guarda todo en `doc.etsensoragricola`.
- Si PlatformIO falla con `No module named 'intelhex'`: `~/.platformio/penv/Scripts/python -m pip install intelhex`.

## Decisiones y gotchas ya resueltos
- MongoDB debe ser >= 4.2 (se usa `mongo:4.4`). Con `mongo:3.6` Orion-LD se cae:
  `reports wire version 6, but this version of libmongoc requires at least 8`.
  Si un volumen fue creado con Mongo viejo, Mongo nuevo no lo abre: hay que usar un volumen limpio.
- Orion-LD acepta la API NGSI-v2 (`/v2/...`), no hace falta cambiar a `fiware/orion`.
- CrateDB necesita `vm.max_map_count >= 262144` en el host. No bajarlo si ya es mayor.
- En la EC2 el usuario `ubuntu` no esta en el grupo docker: usar `sudo docker ...`.
- Las demas imagenes no tienen version fija (latest). Probado y funcionando en oct-2026 con
  CrateDB 6.4.5 y QuantumLeap 0.8.3.
- Nunca subir llaves (`*.pem`) ni credenciales; el `.gitignore` las excluye.

## Datos de la instancia
- Conexion (la llave esta en la carpeta padre, IoT/, nunca dentro del repo):
  `ssh -i "../llavesIoT.pem" ubuntu@ec2-98-82-164-231.compute-1.amazonaws.com`
- Carpeta del proyecto en la EC2: `~/agricultura` (volumenes `agricultura_mongo-db`, `agricultura_crate-db`, `agricultura_grafana`).
- Ubuntu x86_64, 7.6 GB RAM, Docker 29.1.3, Compose 2.40.3 (instalado con `apt install docker-compose`).
- `vm.max_map_count` ya viene en 1048576.
- Estado al 2026-10-08: 6 contenedores arriba (los 5 de FIWARE + `gestor` en :8000, puerto ya abierto
  en el Security Group). Orion sin entidades ni suscripciones (base vacia).
- El compose y `gestor/` de la EC2 son los del repo (subidos con tar por ssh, sin node_modules).
  Respaldo del compose anterior: `~/agricultura/docker-compose.yml.bak-2026-10-08`.
- `gestor/.env` de la EC2 se genero alli con password aleatoria (permisos 600); verla con
  `grep ADMIN_PASSWORD ~/agricultura/gestor/.env`.

### Instancia vieja (ya no se usa)
- `ec2-98-85-255-160.compute-1.amazonaws.com`, carpeta `~/proyecto1`, usa volumen `mongo-db4`.
  Tiene `sensor01` de prueba. Apagarla desde la consola de AWS si no se necesita.

## GitHub
- Repo privado: https://github.com/FelipeTM25/Agricultura_IoT (rama main).
- Todos los commits siguen Conventional Commits: `tipo(scope opcional): descripcion` en espanol,
  con tipos `feat`, `fix`, `docs`, `chore`, `refactor`, `ci`, etc. Ej: `docs: agregar CLAUDE.md`.
