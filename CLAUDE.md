# Agricultura IoT - contexto del proyecto

Proyecto final de la materia IoT (UPB). Plataforma FIWARE para monitoreo agricola,
desplegada con Docker Compose en una instancia EC2 Ubuntu.

## Arquitectura
Sensor --HTTP + X-Api-Key--> Gestor :80 (/api/dispositivos) --red interna--> Orion-LD :1026 (estado actual, MongoDB) --suscripcion--> QuantumLeap :8668
--> CrateDB :4200/:5432 (historico crudo, tablas doc.et<tipo>) --> limpieza (cada 15 min)
--> Postgres (datos limpios, sin puerto publico) --> Grafana :3000

## Archivos
- `docker-compose.yml`: todos los servicios. Debe mantenerse identico al de la EC2.
- `ejemplos-api.sh`: peticiones de ejemplo (crear sensor01, suscribir QuantumLeap, PATCH, GET). Recibe el host como parametro.
- `README.md`: pasos de despliegue en EC2 para quien clone el repo.
- `landing/`: pagina publica sin login, mismo stack y Dockerfile que el gestor, publicada en el
  host :443 (HTTP plano, sin TLS: se abre con `http://host:443`). API de solo lectura:
  `/api/estado`, `/api/sensores` (Orion), `/api/historico/{id}?horas=` (QuantumLeap, agrupado en
  Python por intervalos). Graficas SVG propias (`GraficaLinea.jsx`), mapa con Leaflet + OSM.
- `gestor/`: gestor de Orion en un solo contenedor (host :80 -> contenedor 8000). Dockerfile multi-etapa:
  compila `front/` (React + Vite) y lo sirve como estatico desde `api/` (FastAPI, rutas bajo `/api`,
  docs en `/docs`). Login de un unico admin con JWT; credenciales en `gestor/.env` (no se sube,
  plantilla en `gestor/.env.example`). La API habla con Orion por NGSI-v2 (`ORION_URL`) y lee el
  historico de QuantumLeap (`QUANTUMLEAP_URL`, `/api/entidades/{id}/historico`, todos los atributos
  numericos). `GraficaLinea.jsx` es copia de la de la landing (solo cambia el import de `formatear`).
  Entrada de los sensores en `api/dispositivos.py`: `POST /api/dispositivos/{id}/lecturas` y
  `GET .../ping`, clave por dispositivo en `DISPOSITIVOS=id:clave,...` de gestor/.env (no es el login
  del admin; solo escribe su propia entidad). JSON simple {"var": num, "ubicacion": {lat, lon}} que el
  gestor convierte a NGSI y manda con append a Orion (tipo `TIPO_DISPOSITIVO`, SensorAgricola).

- `limpieza/`: servicio FastAPI sin puerto publico (el gestor lo llama en http://limpieza:8000).
  Lee CrateDB por `/_sql` (columnas en minusculas: humedadsuelo -> humedadSuelo), aplica
  `app/reglas.py` y escribe en Postgres `mediciones` (promedio cada 5 min), `descartes`,
  `ejecuciones` y `avance` (incremental, reprocesa el ultimo intervalo; idempotente).
- `grafana/`: provisioning de la fuente Postgres (uid `postgres-limpios`) y del tablero
  `agricultura-limpios` (JSON generado; colores validados con el skill dataviz para tema oscuro).
- `.env` en la raiz (no se sube; plantilla `.env.example`): POSTGRES_* para postgres, limpieza y grafana.
- `sensor-lilygo/`: firmware PlatformIO del nodo (antes `TXlora`, que transmitia por LoRa para un
  examen). Credenciales en `include/secretos.h` (no se sube, plantilla `secretos.example.h`).
  `src/LoRaBoards.*` y `utilities.h` son del ejemplo de LilyGO; solo se desactivo su softAP WiFi.

## Modelo del sensor
LilyGO T-Beam v1.2 (ESP32, PMU AXP2101 detectada sola, GPS en Serial1 34/12, sin OLED). Cada `PERIODO_TX_MS` (30 s) promedia 20
muestras y las envia; el gestor hace `POST /v2/op/update` con `actionType: append` en Orion (crea la entidad si no
existe; las variables sin lectura valida no se mandan). Desde 2026-10-15 ya no va directo a Orion:
manda el JSON simple al gestor (`GESTOR_HOST`:80, `DISPOSITIVO_CLAVE` en secretos.h). Entidad `sensor01`, tipo `SensorAgricola`:
- `temperatura` (°C) y `humedad` (% aire): HDC1080, I2C 0x40.
- `luz` (lux) y `radiacion` (cuentas IR 0..1023, indicador relativo, no W/m2): CJMCU-3216 = AP3216C,
  I2C 0x1E, driver propio en `src/Ap3216.h`. Satura en ~20661 lux (sol directo).
- `humedadSuelo` (%): sensor capacitivo analogico en GPIO36 (VP). Debe ser ADC1: ADC2 no funciona con
  WiFi. Calibrar `SUELO_SECO_RAW` / `SUELO_MOJADO_RAW` en main.cpp.
- `ubicacion` (geo:json Point [lon, lat]): GPS, solo se manda con fix.
Ambos sensores I2C van al bus de la placa (SDA 21 / SCL 22, 3V3, GND), compartido con PMU 0x34 y OLED 0x3C.
Un tipo por dispositivo => QuantumLeap guarda todo en `doc.etsensoragricola`.
- WiFi: UPBWiFi (abierta, 2.4 GHz canal 1, sin portal cautivo) funciona; en `secretos.h` va
  `WIFI_PASSWORD ""`. Al arrancar el firmware lista las redes y prueba `/api/dispositivos/sensor01/ping` del gestor.
- `waiting for download` / `boot:0x2` al arrancar = un cable deja en bajo un pin de arranque (0, 2, 12,
  15). Paso el 2026-10-13 con el adaptador del sensor de suelo conectado; sin el, arranca bien.
- Si PlatformIO falla con `No module named 'intelhex'`: `~/.platformio/penv/Scripts/python -m pip install intelhex`.

## Decisiones y gotchas ya resueltos
- Seguridad: Orion, QuantumLeap, MongoDB y CrateDB se publican solo en 127.0.0.1 (no tienen
  autenticacion; QuantumLeap acepta escrituras en /v2/notify). Desde fuera: tunel SSH. Lo publico es
  gestor :80, landing :443 y grafana :3000. La clave del dispositivo viaja en HTTP plano (no hay TLS).
- MongoDB debe ser >= 4.2 (se usa `mongo:4.4`). Con `mongo:3.6` Orion-LD se cae:
  `reports wire version 6, but this version of libmongoc requires at least 8`.
  Si un volumen fue creado con Mongo viejo, Mongo nuevo no lo abre: hay que usar un volumen limpio.
- Orion-LD acepta la API NGSI-v2 (`/v2/...`), no hace falta cambiar a `fiware/orion`.
- MongoDB es la base de Orion: BD `orion`, colecciones `entities` (estado actual, una por entidad) y
  `csubs` (suscripciones). Nadie mas la usa; el historico vive en CrateDB.
- Consultas a QuantumLeap: llevar la cabecera `Fiware-ServicePath: /` (sin ella responde 404 aunque
  haya datos) y no pedir con `attrs=` un atributo que aun no existe como columna en CrateDB (falla
  la consulta entera); la landing pide todo y filtra.
- CrateDB necesita `vm.max_map_count >= 262144` en el host. No bajarlo si ya es mayor.
- En la EC2 el usuario `ubuntu` no esta en el grupo docker: usar `sudo docker ...`.
- Las demas imagenes no tienen version fija (latest). Probado y funcionando en oct-2026 con
  CrateDB 6.4.5 y QuantumLeap 0.8.3.
- Nunca subir llaves (`*.pem`) ni credenciales; el `.gitignore` las excluye.

## Datos de la instancia
- Conexion (la llave esta en la carpeta padre, IoT/, nunca dentro del repo):
  `ssh -i "../llavesIoT.pem" ubuntu@ec2-3-234-196-13.compute-1.amazonaws.com`
- IP elastica 3.234.196.13 (desde 2026-10-13; antes la IP cambiaba en cada encendido). Liberarla
  (Actions > Release) al terminar el semestre: se cobra aunque la instancia este apagada.
- La instancia se apaga sola entre sesiones; con `restart: unless-stopped` los 9 servicios vuelven solos.
- Grafana de la EC2 seguia con admin/admin el 2026-10-13 (expuesto en :3000): cambiarlo.
- Carpeta del proyecto en la EC2: `~/agricultura` (volumenes `agricultura_mongo-db`, `agricultura_crate-db`, `agricultura_grafana`).
- Ubuntu x86_64, 7.6 GB RAM, Docker 29.1.3, Compose 2.40.3 (instalado con `apt install docker-compose`).
- `vm.max_map_count` ya viene en 1048576.
- Estado al 2026-10-13: 9 contenedores arriba (5 de FIWARE + `gestor` :80 + `landing` :443 + `db-postgres` + `limpieza`,
  puertos abiertos en el Security Group; el 8000 ya no se usa).
- El nodo escribe `sensor01` en Orion por UPBWiFi. Suscripcion Orion -> QuantumLeap creada el
  2026-10-13 (`6ace58aa4abd323b28ea3081`, tipo SensorAgricola, idPattern .*): CrateDB ya guarda historico.
- El compose, `gestor/` y `landing/` de la EC2 son los del repo (subidos con tar por ssh, sin
  node_modules ni .env). Respaldos del compose: `~/agricultura/docker-compose.yml.bak-2026-10-08`, `.bak-2026-10-13`, `.bak-2026-10-15`.
- `gestor/.env` de la EC2 tiene `DISPOSITIVOS=sensor01:<clave>` con la misma clave que el `secretos.h` local.
- El `.env` de la raiz (Postgres) y `gestor/.env` de la EC2 se generaron alli con password aleatoria (permisos 600); verla con
  `grep ADMIN_PASSWORD ~/agricultura/gestor/.env`.

### Instancia vieja (ya no se usa)
- `ec2-98-85-255-160.compute-1.amazonaws.com`, carpeta `~/proyecto1`, usa volumen `mongo-db4`.
  Tiene `sensor01` de prueba. Apagarla desde la consola de AWS si no se necesita.

## GitHub
- Repo privado: https://github.com/FelipeTM25/Agricultura_IoT (rama main).
- Todos los commits siguen Conventional Commits: `tipo(scope opcional): descripcion` en espanol,
  con tipos `feat`, `fix`, `docs`, `chore`, `refactor`, `ci`, etc. Ej: `docs: agregar CLAUDE.md`.
