"""Reglas de limpieza: deciden que lecturas se descartan antes de guardarlas en Postgres.

Son una base pensada para el nodo LilyGO y sus sensores. Cuando los sensores esten
calibrados se pueden ajustar los numeros de RANGOS y SALTO_MAXIMO sin tocar el resto.

Cada lectura descartada queda registrada con el nombre de la regla, para poder ver en
Grafana cuanto y por que se esta limpiando.
"""
from dataclasses import dataclass
from datetime import datetime
from statistics import median

# Rango fisicamente posible de cada variable. Fuera de el, la lectura es un error del
# sensor, no un dato del cultivo.
RANGOS = {
    "temperatura": (-10.0, 60.0),   # °C: clima de cultivo (el HDC1080 llega a 125, eso es falla)
    "humedad": (0.0, 100.0),        # % humedad relativa del aire
    "humedadSuelo": (0.0, 100.0),   # % del sensor capacitivo, ya calibrado en el nodo
    "luz": (0.0, 20661.0),          # lux: tope del rango del AP3216
    "radiacion": (0.0, 1023.0),     # cuentas IR de 10 bits del AP3216
}

# Salto maximo creible entre una lectura y la mediana de sus vecinas. Una lectura que
# se aleja mas que esto es un pico (ruido electrico, mala conexion), no un cambio real.
# Luz y radiacion no se filtran asi: tapar el sensor o una nube cambian el valor de golpe.
SALTO_MAXIMO = {
    "temperatura": 5.0,     # °C
    "humedad": 15.0,        # puntos de %
    "humedadSuelo": 15.0,   # puntos de %: el suelo se moja o seca lento
}
VECINAS = 3  # lecturas a cada lado que se usan para la mediana

# Variables que vienen del mismo chip: si una falla, la otra de ese instante tampoco vale
MISMO_SENSOR = {"temperatura": "humedad", "humedad": "temperatura"}

DESCRIPCION = {
    "duplicada": "Misma hora que otra lectura del sensor: se deja una sola",
    "fuera_de_rango": "Valor imposible para la variable (falla del sensor)",
    "sensor_sin_respuesta": "La otra variable del mismo chip fallo en ese instante",
    "pico": "Salto brusco respecto a las lecturas vecinas",
}


@dataclass
class Lectura:
    hora: datetime
    valor: float


@dataclass
class Descarte:
    hora: datetime
    valor: float
    regla: str


def limpiar_serie(variable: str, lecturas: list[Lectura], fallas_del_chip: set[datetime]) -> tuple[list[Lectura], list[Descarte]]:
    """Limpia la serie de una variable (ordenada por hora). Devuelve (validas, descartadas)."""
    validas: list[Lectura] = []
    descartes: list[Descarte] = []
    vistas: set[datetime] = set()
    minimo, maximo = RANGOS.get(variable, (float("-inf"), float("inf")))

    for l in lecturas:
        if l.hora in vistas:
            descartes.append(Descarte(l.hora, l.valor, "duplicada"))
        elif not (minimo <= l.valor <= maximo):
            descartes.append(Descarte(l.hora, l.valor, "fuera_de_rango"))
        elif l.hora in fallas_del_chip:
            descartes.append(Descarte(l.hora, l.valor, "sensor_sin_respuesta"))
        else:
            validas.append(l)
        vistas.add(l.hora)

    salto = SALTO_MAXIMO.get(variable)
    if salto is None or len(validas) < 3:
        return validas, descartes

    # Picos: se compara cada lectura con la mediana de sus vecinas (sin contarse a si misma)
    sin_picos: list[Lectura] = []
    for i, l in enumerate(validas):
        vecinas = [v.valor for v in validas[max(0, i - VECINAS) : i] + validas[i + 1 : i + 1 + VECINAS]]
        if vecinas and abs(l.valor - median(vecinas)) > salto:
            descartes.append(Descarte(l.hora, l.valor, "pico"))
        else:
            sin_picos.append(l)
    return sin_picos, descartes


def fallas_por_hora(variable: str, lecturas: list[Lectura]) -> set[datetime]:
    """Horas en las que `variable` dio un valor imposible (para invalidar a su pareja del chip)."""
    minimo, maximo = RANGOS.get(variable, (float("-inf"), float("inf")))
    return {l.hora for l in lecturas if not (minimo <= l.valor <= maximo)}
