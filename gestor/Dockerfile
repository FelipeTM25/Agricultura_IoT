# Gestor de Orion: un solo contenedor con la API (FastAPI) y el front (React).
# Etapa 1 compila el front; etapa 2 deja solo Python + los archivos estaticos.

FROM node:22-alpine AS front
WORKDIR /front
COPY front/package.json front/package-lock.json ./
RUN npm ci
COPY front/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./api/
COPY --from=front /front/dist ./static
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
