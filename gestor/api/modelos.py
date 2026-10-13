"""Cuerpos que recibe la API, validados antes de mandarlos a Orion."""
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints

# Orion no acepta espacios ni estos caracteres en ids, tipos y nombres de atributos
NOMBRE_NGSI = r"^[^\s<>\"'=;()&?/#]+$"
NombreAtributo = Annotated[str, StringConstraints(min_length=1, max_length=256, pattern=NOMBRE_NGSI)]


class Credenciales(BaseModel):
    usuario: str
    password: str


class Atributo(BaseModel):
    value: Any = None
    type: str = Field("Text", pattern=NOMBRE_NGSI)
    metadata: dict[str, Any] = {}

    def a_ngsi(self) -> dict:
        datos = {"value": self.value, "type": self.type}
        if self.metadata:
            datos["metadata"] = self.metadata
        return datos


class EntidadNueva(BaseModel):
    id: str = Field(min_length=1, max_length=256, pattern=NOMBRE_NGSI)
    type: str = Field("SensorAgricola", min_length=1, max_length=256, pattern=NOMBRE_NGSI)
    atributos: dict[NombreAtributo, Atributo] = {}
    # Si es True, se asegura que exista una suscripcion de su tipo hacia QuantumLeap
    guardar_historico: bool = False

    def a_ngsi(self) -> dict:
        return {"id": self.id, "type": self.type, **{n: a.a_ngsi() for n, a in self.atributos.items()}}


class SuscripcionNueva(BaseModel):
    # Orion rechaza estos caracteres en la descripcion: < > " ' = ; ( )
    descripcion: str = Field("", pattern=r"^[^<>\"'=;()]*$")
    tipo_entidad: str = Field(min_length=1, pattern=NOMBRE_NGSI)
    patron_id: str = ".*"
    # Vacio = notificar cuando cambie cualquier atributo
    atributos_condicion: list[str] = []
    url_notificacion: str = "http://quantumleap:8668/v2/notify"
    # Vacio = mandar todos los atributos de la entidad
    atributos_notificacion: list[str] = []
    incluir_metadata: bool = True

    def a_ngsi(self) -> dict:
        notificacion: dict[str, Any] = {"http": {"url": self.url_notificacion}}
        if self.atributos_notificacion:
            notificacion["attrs"] = self.atributos_notificacion
        if self.incluir_metadata:
            # QuantumLeap usa dateModified como marca de tiempo de cada lectura
            notificacion["metadata"] = ["dateCreated", "dateModified"]

        sujeto: dict[str, Any] = {"entities": [{"idPattern": self.patron_id, "type": self.tipo_entidad}]}
        if self.atributos_condicion:
            sujeto["condition"] = {"attrs": self.atributos_condicion}

        datos = {"subject": sujeto, "notification": notificacion}
        if self.descripcion:
            datos["description"] = self.descripcion
        return datos
