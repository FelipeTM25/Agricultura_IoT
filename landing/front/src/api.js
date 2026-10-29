// Cliente de la API publica de la landing (solo lectura).

async function pedir(ruta) {
  let respuesta
  try {
    respuesta = await fetch(`/api${ruta}`)
  } catch {
    throw new Error('Sin conexión con el servidor')
  }
  if (!respuesta.ok) {
    let detalle
    try {
      detalle = (await respuesta.json()).detail
    } catch {
      /* respuesta sin JSON */
    }
    throw new Error(typeof detalle === 'string' ? detalle : `Error ${respuesta.status}`)
  }
  return respuesta.json()
}

export const api = {
  estado: () => pedir('/estado'),
  sensores: () => pedir('/sensores'),
  historico: (sensorId, horas) => pedir(`/historico/${encodeURIComponent(sensorId)}?horas=${horas}`),
  alertas: () => pedir('/alertas'),
}
