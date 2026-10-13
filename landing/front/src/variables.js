// Como se presenta cada variable del nodo LilyGO. El orden es el de la pagina.
export const VARIABLES = [
  { clave: 'temperatura', titulo: 'Temperatura', detalle: 'del aire', unidad: '°C', icono: 'termometro', decimales: 1 },
  { clave: 'humedad', titulo: 'Humedad', detalle: 'del aire', unidad: '%', icono: 'gota', decimales: 0 },
  { clave: 'humedadSuelo', titulo: 'Humedad', detalle: 'del suelo', unidad: '%', icono: 'brote', decimales: 0 },
  { clave: 'luz', titulo: 'Luz', detalle: 'ambiente', unidad: 'lux', icono: 'sol', decimales: 0 },
  { clave: 'radiacion', titulo: 'Radiación', detalle: 'infrarroja', unidad: 'IR', icono: 'rayo', decimales: 0 },
]

export const formatear = (valor, decimales) =>
  valor === undefined || valor === null
    ? '—'
    : Number(valor).toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })

// "hace 12 s", "hace 3 min"…
export function haceCuanto(iso, ahora = Date.now()) {
  if (!iso) return 'sin datos'
  const segundos = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000))
  if (segundos < 60) return `hace ${segundos} s`
  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 48) return `hace ${horas} h`
  return `hace ${Math.round(horas / 24)} días`
}

// Un sensor se considera "en vivo" si actualizo en los ultimos 2 minutos (envia cada 30 s)
export const enVivo = (iso, ahora = Date.now()) => Boolean(iso) && ahora - new Date(iso).getTime() < 2 * 60 * 1000
