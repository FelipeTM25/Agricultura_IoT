# Agricultura IoT

Proyecto final de IoT. Plataforma basada en FIWARE para recibir, almacenar y
visualizar las lecturas de los sensores de un cultivo. Se despliega con Docker
Compose en una instancia EC2 de AWS con Ubuntu.

## Arquitectura

```
Sensor --HTTP--> Orion-LD (estado actual) --suscripcion--> QuantumLeap
                    |                                          |
                 MongoDB                                    CrateDB --> Grafana
                                                          (historico)  (tableros)
```

| Servicio    | Imagen                        | Puerto | Funcion                                         |
|-------------|-------------------------------|--------|-------------------------------------------------|
| Orion-LD    | `fiware/orion-ld`             | 1026   | Context Broker: estado actual de cada sensor    |
| MongoDB     | `mongo:4.4`                   | 27017  | Base de datos de Orion                          |
| QuantumLeap | `orchestracities/quantumleap` | 8668   | Convierte las notificaciones en series de tiempo |
| CrateDB     | `crate`                       | 4200, 5432 | Almacena el historico                       |
| Grafana     | `grafana/grafana`             | 3000   | Tableros de visualizacion                       |
| Gestor      | se construye desde `gestor/`  | 8000   | Front y API para administrar Orion con login    |

## Contenido del repositorio

| Archivo              | Descripcion                                             |
|----------------------|---------------------------------------------------------|
| `docker-compose.yml` | Definicion de todos los servicios                       |
| `ejemplos-api.sh`    | Peticiones de ejemplo para probar el flujo completo     |
| `gestor/`            | Gestor de Orion: API en FastAPI (`api/`) y front en React (`front/`) |

## Despliegue en EC2

### 1. Crear la instancia

- AMI: Ubuntu, arquitectura **x86_64** (las imagenes de FIWARE no tienen version ARM, no usar instancias Graviton como `t4g`).
- Tamano: minimo **`t3.large` (8 GB de RAM)**. CrateDB reserva 4 GB de heap (`CRATE_HEAP_SIZE=4g`).
- Disco: 20 GB o mas.
- Security Group, reglas de entrada:

  | Puerto | Uso                                   |
  |--------|---------------------------------------|
  | 22     | SSH (idealmente solo desde tu IP)     |
  | 1026   | Orion, para que los sensores envien datos |
  | 3000   | Grafana                               |
  | 8668   | QuantumLeap (opcional, consultas del historico) |
  | 8000   | Gestor de Orion                       |

  No abrir `27017`, `4200` ni `5432`: MongoDB y CrateDB no tienen autenticacion.

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

El gestor se construye desde la carpeta `gestor/`, asi que no basta con el
`docker-compose.yml`: hay que copiar el repositorio completo. Desde tu equipo:

```bash
scp -i "<tu-llave>.pem" -r docker-compose.yml gestor ubuntu@<DNS-publico-EC2>:agricultura/
```

(antes crear la carpeta en la EC2 con `mkdir ~/agricultura`), o clonar el repo directamente en la EC2.

Luego crear las credenciales del gestor en la EC2:

```bash
cd ~/agricultura
cp gestor/.env.example gestor/.env
python3 -c "import secrets; print(secrets.token_hex(32))"   # pegar el resultado en JWT_SECRET
nano gestor/.env                                             # cambiar ADMIN_PASSWORD y JWT_SECRET
```

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
sudo docker ps -a                       # los 6 contenedores deben estar "Up"
curl localhost:1026/version             # Orion
curl localhost:8668/version             # QuantumLeap
curl localhost:4200                     # CrateDB
curl localhost:8000/docs                # Gestor (documentacion de la API)
```

Grafana queda en `http://<DNS-publico-EC2>:3000` (usuario y contrasena inicial: `admin` / `admin`).

## Probar el flujo de datos

```bash
chmod +x ejemplos-api.sh
./ejemplos-api.sh                       # dentro de la EC2
./ejemplos-api.sh <DNS-publico-EC2>     # desde otro equipo
```

El script crea la entidad `sensor01`, suscribe QuantumLeap, actualiza la
temperatura y consulta el estado en Orion. Para ver el historico guardado en
CrateDB:

```bash
curl -X POST localhost:4200/_sql -H 'Content-Type: application/json' \
  -d '{"stmt":"SELECT entity_id, time_index, temperatura FROM doc.ettemperatura ORDER BY time_index"}'
```

## Gestor de Orion

Interfaz web en `http://<DNS-publico-EC2>:8000` para administrar Orion sin usar
`curl`. Se entra con el usuario y la contrasena de `gestor/.env` y permite:

- Ver un resumen: estado de Orion, numero de sensores y suscripciones, lecturas actuales.
- Crear, editar y borrar sensores (entidades). Al crear un `SensorAgricola` se
  precargan temperatura, humedad, luz, radiacion y ubicacion GPS.
- Crear y borrar suscripciones (por defecto hacia QuantumLeap).

La API esta documentada en `http://<DNS-publico-EC2>:8000/docs`. Todas las rutas
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

## Problemas conocidos

- **Orion se cae al arrancar** con `reports wire version 6, but this version of libmongoc requires at least 8`:
  la imagen de MongoDB es demasiado vieja. Orion-LD necesita MongoDB 4.2 o superior (el compose usa `mongo:4.4`).
  Si el volumen fue creado con una version anterior, hay que borrarlo (`sudo docker volume rm <carpeta>_mongo-db`).
- **CrateDB no arranca** con `max virtual memory areas vm.max_map_count [65530] is too low`: repetir el paso 5.
- **`permission denied ... docker.sock`**: usar `sudo`, o agregar el usuario al grupo con
  `sudo usermod -aG docker ubuntu` y volver a conectarse.
