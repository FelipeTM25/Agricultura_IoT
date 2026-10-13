// Cliente de la API del gestor. Guarda el token de sesion y lo manda en cada peticion.

const CLAVE_TOKEN = 'gestor_token'
const CLAVE_USUARIO = 'gestor_usuario'

export const sesion = {
  get token() {
    return sessionStorage.getItem(CLAVE_TOKEN)
  },
  get usuario() {
    return sessionStorage.getItem(CLAVE_USUARIO)
  },
  guardar(token, usuario) {
    sessionStorage.setItem(CLAVE_TOKEN, token)
    sessionStorage.setItem(CLAVE_USUARIO, usuario)
  },
  cerrar() {
    sessionStorage.removeItem(CLAVE_TOKEN)
    sessionStorage.removeItem(CLAVE_USUARIO)
  },
}

// FastAPI responde {"detail": "texto"} o, si falla la validacion, {"detail": [{loc, msg}, ...]}
function mensajeDeError(detalle, status) {
  if (typeof detalle === 'string') return detalle
  if (Array.isArray(detalle)) {
    return detalle.map((e) => `${e.loc?.slice(1).join('.') || 'dato'}: ${e.msg}`).join(' · ')
  }
  return `Error ${status}`
}

// comoArchivo: devuelve { blob, nombre } en vez de JSON (para descargas)
async function pedir(metodo, ruta, cuerpo, { comoArchivo = false } = {}) {
  const cabeceras = {}
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
  if (sesion.token) cabeceras.Authorization = `Bearer ${sesion.token}`

  let respuesta
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
  } catch {
    throw new Error('No hay conexion con la API del gestor')
  }

  if (respuesta.status === 401 && ruta !== '/auth/login') {
    sesion.cerrar()
    window.dispatchEvent(new Event('sesion-expirada'))
  }
  if (!respuesta.ok) {
    let detalle
    try {
      detalle = (await respuesta.json()).detail
    } catch {
      /* respuesta sin JSON */
    }
    throw new Error(mensajeDeError(detalle, respuesta.status))
  }
  if (comoArchivo) {
    const disposicion = respuesta.headers.get('Content-Disposition') ?? ''
    const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? 'exportacion'
    return { blob: await respuesta.blob(), nombre }
  }
  return respuesta.status === 204 ? null : respuesta.json()
}

// Guarda un archivo descargado con su nombre
export function guardarArchivo({ blob, nombre }) {
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  URL.revokeObjectURL(url)
}

const id = (valor) => encodeURIComponent(valor)

export const api = {
  login: (usuario, password) => pedir('POST', '/auth/login', { usuario, password }),
  estado: () => pedir('GET', '/estado'),

  entidades: () => pedir('GET', '/entidades'),
  crearEntidad: (entidad) => pedir('POST', '/entidades', entidad),
  guardarAtributos: (entidadId, atributos) => pedir('PUT', `/entidades/${id(entidadId)}/atributos`, atributos),
  borrarAtributo: (entidadId, nombre) => pedir('DELETE', `/entidades/${id(entidadId)}/atributos/${id(nombre)}`),
  borrarEntidad: (entidadId) => pedir('DELETE', `/entidades/${id(entidadId)}`),
  historico: (entidadId, tipo, horas) =>
    pedir('GET', `/entidades/${id(entidadId)}/historico?tipo=${id(tipo)}&horas=${horas}`),
  exportar: (entidadId, opciones) =>
    pedir('GET', `/entidades/${id(entidadId)}/exportar?${new URLSearchParams(opciones)}`, undefined, { comoArchivo: true }),

  limpieza: () => pedir('GET', '/limpieza'),
  ejecutarLimpieza: () => pedir('POST', '/limpieza/ejecutar'),

  suscripciones: () => pedir('GET', '/suscripciones'),
  crearSuscripcion: (suscripcion) => pedir('POST', '/suscripciones', suscripcion),
  borrarSuscripcion: (suscripcionId) => pedir('DELETE', `/suscripciones/${id(suscripcionId)}`),
}
