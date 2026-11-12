# Agricultura IoT

Proyecto final de IoT (UPB). Plataforma basada en FIWARE para recibir, almacenar,
limpiar y visualizar las lecturas de los sensores de un cultivo, con alertas por
correo cuando una variable sale de su rango. Se despliega con Docker Compose en
una instancia EC2 de AWS con Ubuntu.

**Desarrollado por Felipe Torres Montoya y Camilo Marin Muriel.**

## Contenido

- [Arquitectura](#arquitectura)
- [Contenido del repositorio](#contenido-del-repositorio)
- [Despliegue en EC2](#despliegue-en-ec2)
- [Probar el flujo de datos](#probar-el-flujo-de-datos)
- [Gestor de Orion](#gestor-de-orion)
- [Landing publica](#landing-publica)
- [Nodo sensor (LilyGO T-Beam)](#nodo-sensor-lilygo-t-beam)
- [Limpieza de datos y Grafana](#limpieza-de-datos-y-grafana)
- [Alertas (toma de decisiones)](#alertas-toma-de-decisiones)
- [Conectar Grafana a CrateDB](#conectar-grafana-a-cratedb)
- [Comandos utiles](#comandos-utiles)
- [Autores](#autores)

## Arquitectura

```
Sensor --HTTP+clave--> Gestor --> Orion-LD (estado actual) --suscripcion--> QuantumLeap
                                   |      |                                    |
                                MongoDB   +--suscripcion--> alertas         CrateDB (historico crudo)
                                             (umbrales -> correo)              |
                                                    |                      limpieza (cada 15 min o con boton)
                                                    |                          |
                                                    +--------------------> Postgres (datos limpios y alertas)
                                                                               |
                                                                  Grafana, gestor y landing
```

| Servicio    | Imagen                        | Puerto | Funcion                                         |
|-------------|-------------------------------|--------|-------------------------------------------------|
| Orion-LD    | `fiware/orion-ld`             | 1026*  | Context Broker: estado actual de cada sensor    |
| MongoDB     | `mongo:4.4`                   | 27017  | Base de datos de Orion                          |
| QuantumLeap | `orchestracities/quantumleap` | 8668*  | Convierte las notificaciones en series de tiempo |
| CrateDB     | `crate`                       | 4200, 5432 | Almacena el historico                       |
| Grafana     | `grafana/grafana`             | 3000   | Tableros (desde Postgres, ya provisionados)     |
| Postgres    | `postgres:16-alpine`          | -      | Datos limpios (promedios cada 5 min)            |
| Limpieza    | se construye desde `limpieza/`| -      | CrateDB -> reglas de limpieza -> Postgres       |
| Alertas     | se construye desde `alertas/` | -      | Umbrales sobre cada lectura de Orion, avisos por correo |
| Gestor      | se construye desde `gestor/`  | 80     | Administracion con login y entrada de lecturas de los sensores |
| Landing     | se construye desde `landing/` | 443    | Pagina publica con lecturas, historico limpio y alertas |

## Contenido del repositorio

| Archivo              | Descripcion                                             |
|----------------------|---------------------------------------------------------|
| `docker-compose.yml` | Definicion de todos los servicios                       |
| `ejemplos-api.sh`    | Peticiones de ejemplo para probar el flujo completo     |
| `gestor/`            | Gestor de Orion: API en FastAPI (`api/`) y front en React (`front/`) |
| `landing/`           | Landing publica: API de solo lectura en FastAPI y front en React |
| `limpieza/`          | Servicio que limpia el historico de CrateDB y lo guarda en Postgres |
| `alertas/`           | Servicio de alertas (toma de decisiones) que Orion alimenta por suscripcion |
| `grafana/`           | Fuente de datos y tablero de Grafana que se cargan solos (provisioning) |
| `.env.example`       | Plantilla del `.env` de la raiz (credenciales de Postgres y correo de las alertas) |
| `sensor-lilygo/`     | Firmware (PlatformIO) del nodo LilyGO T-Beam que envia las lecturas a Orion por WiFi |

## Despliegue en EC2

### 1. Crear la instancia

- AMI: Ubuntu, arquitectura **x86_64** (las imagenes de FIWARE no tienen version ARM, no usar instancias Graviton como `t4g`).
- Tamano: minimo **`t3.large` (8 GB de RAM)**. CrateDB reserva 4 GB de heap (`CRATE_HEAP_SIZE=4g`).
- Disco: 20 GB o mas.
- Security Group, reglas de entrada:

  | Puerto | Uso                                   |
  |--------|---------------------------------------|
  | 22     | SSH (idealmente solo desde tu IP)     |
  | 3000   | Grafana                               |
  | 80     | Gestor de Orion                       |
  | 443    | Landing publica                       |

  No abrir `1026`, `8668`, `27017`, `4200` ni `5432`: Orion, QuantumLeap, MongoDB y CrateDB no
  tienen autenticacion. Ademas el compose los publica solo en `127.0.0.1` (marcados con * en la
  tabla de servicios), asi que aunque el puerto quede abierto no se alcanzan desde afuera. Los
  sensores escriben por el gestor (puerto 80) con su clave. Para usarlos desde tu equipo, un tunel:
  `ssh -i <llave>.pem -L 4200:localhost:4200 ubuntu@<DNS-publico-EC2>` y abrir `http://localhost:4200`.

### 2. Conectarse por SSH

```bash
ssh -i "<tu-llave>.pem" ubuntu@<DNS-publico-EC2>
```

### 3. Instalar Docker y Docker Compose

```bash
sudo apt update
sudo apt install docker-compose
```

### 4. Copiar el proyecto a la instancia

El gestor, la landing, la limpieza y las alertas se construyen desde sus carpetas, asi que no basta con el
`docker-compose.yml`: hay que copiar el repositorio completo. Desde tu equipo:

```bash
scp -i "<tu-llave>.pem" -r docker-compose.yml gestor landing limpieza alertas grafana ubuntu@<DNS-publico-EC2>:agricultura/
```

(antes crear la carpeta en la EC2 con `mkdir ~/agricultura`), o clonar el repo directamente en la EC2.

Luego crear las credenciales del gestor en la EC2:

```bash
cd ~/agricultura
cp gestor/.env.example gestor/.env
python3 -c "import secrets; print(secrets.token_hex(32))"   # pegar el resultado en JWT_SECRET
nano gestor/.env                                             # cambiar ADMIN_PASSWORD y JWT_SECRET
```

Y las de Postgres (las usan Postgres, la limpieza, las alertas y Grafana; nadie tiene que escribirlas a mano):

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(24))"  # pegar el resultado en POSTGRES_PASSWORD
nano .env
```

En el mismo `.env` van `SMTP_USUARIO` y `SMTP_PASSWORD` para recibir las alertas
por correo (ver *Alertas* mas abajo).

### 5. Ajustar `vm.max_map_count` (requerido por CrateDB)

```bash
cat /proc/sys/vm/max_map_count          # ver el valor actual
sudo sysctl -w vm.max_map_count=262144  # solo si es menor a 262144
```

Para que no se pierda al reiniciar la instancia:

```bash
echo "vm.max_map_count=262144" | sudo tee /etc/sysctl.d/99-cratedb.conf
```

### 6. Levantar los servicios

```bash
sudo docker compose up -d --build
```

### 7. Verificar

```bash
sudo docker ps -a                       # los 10 contenedores deben estar "Up"
curl localhost:1026/version             # Orion
curl localhost:8668/version             # QuantumLeap
curl localhost:4200                     # CrateDB
curl localhost/docs                     # Gestor (documentacion de la API)
curl localhost:443/api/estado           # Landing
```

Grafana queda en `http://<DNS-publico-EC2>:3000` (usuario y contrasena inicial: `admin` / `admin`).

## Probar el flujo de datos

```bash
chmod +x ejemplos-api.sh
./ejemplos-api.sh                       # dentro de la EC2 (Orion solo escucha en 127.0.0.1)
```

El script crea la entidad `sensor01`, suscribe QuantumLeap, actualiza la
temperatura y consulta el estado en Orion. Para ver el historico guardado en
CrateDB:

```bash
curl -X POST localhost:4200/_sql -H 'Content-Type: application/json' \
  -d '{"stmt":"SELECT entity_id, time_index, temperatura FROM doc.ettemperatura ORDER BY time_index"}'
```

## Gestor de Orion

Interfaz web en `http://<DNS-publico-EC2>` (puerto 80) para administrar Orion sin usar
`curl`. Se entra con el usuario y la contrasena de `gestor/.env` y permite:

- Ver un resumen: estado de Orion, numero de sensores y suscripciones, lecturas actuales.
- Crear, editar y borrar sensores (entidades). Al crear un `SensorAgricola` se
  precargan temperatura, humedad, luz, radiacion y ubicacion GPS.
- Crear y borrar suscripciones (por defecto hacia QuantumLeap).
- Al crear un sensor, casilla *Guardar su historico*: crea la suscripcion a QuantumLeap de su tipo si
  todavia no existe (si ya hay una, la reutiliza). Sirve para tipos nuevos de sensor.
- Exportar el historico de un sensor (rango de fechas, atributos, agrupacion, CSV o JSON).
- Ver y lanzar la limpieza de datos (*Limpieza de datos* -> *Limpiar ahora*).
- Ver el historico de cada sensor (graficas por atributo de 1 h a 7 dias, o tabla). Con el selector
  *Limpios / Crudos* se elige entre los datos limpios de Postgres (por defecto) y las lecturas tal
  como las guardo QuantumLeap en CrateDB. Se llega desde *Historico* o desde el icono de grafica de
  cada sensor. La exportacion siempre sale de los datos crudos.
- Configurar las alertas: umbrales, alertas activas e historial, y enviar un correo de prueba (*Alertas*).

La API esta documentada en `http://<DNS-publico-EC2>/docs`. Todas las rutas
estan bajo `/api` y, salvo `/api/auth/login`, piden el token en la cabecera
`Authorization: Bearer <token>`.

Despues de cambiar el codigo del gestor, reconstruirlo con:

```bash
sudo docker compose up -d --build gestor
```

### Desarrollo local

```bash
# API (desde gestor/)
pip install -r api/requirements.txt
ADMIN_USER=admin ADMIN_PASSWORD=admin JWT_SECRET=dev ORION_URL=http://<host-orion>:1026   uvicorn api.main:app --reload

# Front (desde gestor/front/, en otra terminal). Las llamadas a /api van al puerto 8000.
npm install
npm run dev
```

## Landing publica

Pagina sin login en `http://<DNS-publico-EC2>:443` para mostrar el proyecto:
lecturas actuales (Orion), alertas activas con su recomendacion, graficas del historico
ya limpio de 1 h a 7 dias (Postgres, por el servicio de limpieza), mapa con la ubicacion GPS
y una explicacion de la arquitectura. Su API (`/api/estado`, `/api/sensores`,
`/api/historico/<id>?horas=24`, `/api/alertas`) es de solo lectura.

Se publica en el 443 pero sirve **HTTP**, sin certificado: hay que abrirla como
`http://...:443`; con `https://` el navegador da error de conexion segura.

Las graficas solo muestran datos si existe la suscripcion de Orion a QuantumLeap
(se crea desde el gestor, en *Suscripciones*) y despues de la primera limpieza (cada 15 min).

Desarrollo local: igual que el gestor, desde `landing/` con
`ORION_URL=... LIMPIEZA_URL=... ALERTAS_URL=... uvicorn api.main:app --port 8001 --reload` y
`npm run dev` en `landing/front/`.

## Nodo sensor (LilyGO T-Beam)

Firmware en `sensor-lilygo/`. Cada 30 s promedia 20 muestras y actualiza en Orion la
entidad `sensor01` (tipo `SensorAgricola`) por WiFi.

| Sensor | Conexion | Atributo en Orion |
|--------|----------|-------------------|
| HDC1080 | I2C de la placa: SDA 21, SCL 22, 3V3, GND | `temperatura` (°C), `humedad` (% aire) |
| CJMCU-3216 (AP3216C) | I2C de la placa: SDA 21, SCL 22, 3V3, GND | `luz` (lux), `radiacion` (cuentas IR 0-1023) |
| Humedad de suelo capacitivo | salida analogica a GPIO36 (VP), 3V3, GND | `humedadSuelo` (%) |
| GPS de la placa | interno (Serial1) | `ubicacion` (geo:json) |

Pasos:

1. Copiar `sensor-lilygo/include/secretos.example.h` como `secretos.h` y poner la red
   WiFi (2.4 GHz), el host del gestor y la clave del dispositivo (`DISPOSITIVO_CLAVE`). La
   misma clave va en `gestor/.env` de la EC2: `DISPOSITIVOS=sensor01:<clave>`.
2. Abrir `sensor-lilygo/` en VS Code con PlatformIO y usar *Upload and Monitor*.
3. Calibrar la humedad de suelo: anotar el valor `crudo` que imprime el monitor con el
   sensor al aire y dentro de agua, y ponerlos en `SUELO_SECO_RAW` / `SUELO_MOJADO_RAW`
   (`src/main.cpp`).

El nodo no escribe directo en Orion: manda `POST /api/dispositivos/sensor01/lecturas` al
gestor (puerto 80) con la cabecera `X-Api-Key`. El gestor comprueba la clave (cada dispositivo
tiene la suya y solo puede escribir su propia entidad), valida los valores y los guarda en Orion.
Ejemplo:

```bash
curl -X POST http://<DNS-publico-EC2>/api/dispositivos/sensor01/lecturas   -H 'X-Api-Key: <clave>' -H 'Content-Type: application/json'   -d '{"temperatura": 23.4, "humedad": 61.2, "ubicacion": {"lat": 6.2425, "lon": -75.5895}}'
```

## Limpieza de datos y Grafana

El servicio `limpieza` lee cada 15 min (o con el boton del gestor) lo nuevo de CrateDB,
descarta lo que no es un dato real y guarda en Postgres el promedio de cada 5 min:

| Regla | Descarta |
|-------|----------|
| `fuera_de_rango` | Valores imposibles: temperatura fuera de -10..60 °C, humedad fuera de 0..100 %, luz < 0, etc. |
| `sensor_sin_respuesta` | La humedad cuando la temperatura del mismo chip (HDC1080) fallo en ese instante |
| `pico` | Saltos bruscos frente a la mediana de las 3 lecturas vecinas a cada lado (temperatura ±5 °C, humedades ±15 %) |
| `duplicada` | Lecturas repetidas con la misma hora |

Los limites estan en `limpieza/app/reglas.py`; ajustarlos cuando los sensores esten calibrados.
En Postgres quedan las tablas `mediciones` (datos limpios), `descartes` (que se quito y por que)
y `ejecuciones` (cada vuelta de la limpieza).

Grafana arranca con la fuente de datos *Postgres (datos limpios)* y el tablero
**Agricultura IoT · Datos limpios** ya creados (`grafana/provisioning` y `grafana/dashboards`):
`http://<DNS-publico-EC2>:3000/d/agricultura-limpios`. Si se cambia el tablero desde Grafana,
exportar el JSON y guardarlo en `grafana/dashboards/agricultura.json`.

## Alertas (toma de decisiones)

El servicio `alertas` es el manejador de mensajes del escenario "suscripcion de Orion": al
arrancar crea en Orion una suscripcion que le notifica cada lectura de los `SensorAgricola`
(`http://alertas:8000/notify`, por la red interna) y la compara con los umbrales:

| Umbral inicial | Accion recomendada |
|----------------|--------------------|
| temperatura > 35 °C | Dar sombra o ventilar el cultivo y revisar el riego |
| temperatura < 5 °C | Cubrir el cultivo durante la noche |
| humedadSuelo < 30 % | Regar |
| humedadSuelo > 90 % | Suspender el riego y revisar el drenaje |
| humedad > 90 % | Ventilar: riesgo de hongos |

Se editan desde el gestor (*Alertas*) y viven en la tabla `umbrales` de Postgres. Una alerta se
abre cuando 2 lecturas seguidas (`ALERTAS_CONFIRMAR_LECTURAS`) cruzan el umbral y se cierra cuando
otras 2 vuelven a la normalidad; asi se avisa una vez al empezar y otra al normalizarse, y un pico
suelto no dispara nada. Las lecturas fisicamente imposibles (los mismos rangos de la limpieza) se
ignoran. Cada alerta queda en la tabla `alertas` y se ve en el gestor y en la landing.

**Correo:** cada alerta que se abre o se cierra manda un correo por SMTP (Gmail por
defecto, gratis). En la cuenta de Gmail que envia: activar la verificacion en 2 pasos y crear una
contrasena de aplicacion en `https://myaccount.google.com/apppasswords`. En el `.env` de la raiz poner
`SMTP_USUARIO` (el correo), `SMTP_PASSWORD` (la contrasena de aplicacion, no la normal) y, si llegan a
otras personas, `ALERTAS_CORREO_DESTINO=uno@x.com,otro@y.com` (vacio = al mismo remitente). Recrear el
servicio:

```bash
sudo docker compose up -d alertas
```

En el gestor, *Alertas* -> *Enviar correo de prueba* lo comprueba (si no llega, revisar spam).

## Conectar Grafana a CrateDB

En Grafana: *Connections > Data sources > Add > PostgreSQL*

| Campo    | Valor           |
|----------|-----------------|
| Host     | `crate-db:5432` |
| Database | `doc`           |
| User     | `crate`         |
| TLS/SSL  | disable         |

## Comandos utiles

```bash
sudo docker compose logs -f orion       # ver logs de un servicio
sudo docker compose down                # detener (conserva los datos)
sudo docker compose down -v             # detener y BORRAR los datos
```

## Autores

Proyecto desarrollado por **Felipe Torres Montoya** y **Camilo Marin Muriel**
para la materia IoT, Universidad Pontificia Bolivariana (UPB), 2026.
