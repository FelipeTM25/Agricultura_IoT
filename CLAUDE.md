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
- Estado al 2026-10-08: los 5 contenedores arriba, Orion sin entidades ni suscripciones (base vacia).
- El compose de la EC2 tiene la misma configuracion que el del repo pero sin los comentarios nuevos.

### Instancia vieja (ya no se usa)
- `ec2-98-85-255-160.compute-1.amazonaws.com`, carpeta `~/proyecto1`, usa volumen `mongo-db4`.
  Tiene `sensor01` de prueba. Apagarla desde la consola de AWS si no se necesita.

## GitHub
- Repo privado: https://github.com/FelipeTM25/Agricultura_IoT (rama main).
- Todos los commits siguen Conventional Commits: `tipo(scope opcional): descripcion` en espanol,
  con tipos `feat`, `fix`, `docs`, `chore`, `refactor`, `ci`, etc. Ej: `docs: agregar CLAUDE.md`.
