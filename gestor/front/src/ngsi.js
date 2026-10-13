// Conversion entre las entidades NGSI-v2 de Orion y las filas que edita el formulario.

export const TIPO_SENSOR = 'SensorAgricola'
export const TIPOS_ATRIBUTO = ['Number', 'Text', 'Boolean', 'geo:json']

// Orion no acepta espacios ni estos caracteres en ids, tipos y nombres de atributos
const NOMBRE_VALIDO = /^[^\s<>"'=;()&?/#]+$/
export const nombreValido = (texto) => NOMBRE_VALIDO.test(texto)

const esNumerico = (tipo) => ['Number', 'Float', 'Integer'].includes(tipo)

// Variables del sensor LilyGO: se precargan al crear un SensorAgricola
const PLANTILLA_SENSOR = [
  { nombre: 'temperatura', tipo: 'Number', pista: '°C' },
  { nombre: 'humedad', tipo: 'Number', pista: '% aire' },
  { nombre: 'humedadSuelo', tipo: 'Number', pista: '% suelo' },
  { nombre: 'luz', tipo: 'Number', pista: 'lux' },
  { nombre: 'radiacion', tipo: 'Number', pista: 'IR 0-1023' },
  { nombre: 'ubicacion', tipo: 'geo:json' },
]

// Icono para mostrar cada variable conocida
export const ICONO_VARIABLE = {
  temperatura: 'termometro',
  humedad: 'gota',
  humedadSuelo: 'brote',
  luz: 'sol',
  radiacion: 'rayo',
  ubicacion: 'pin',
}

let contador = 0
export const filaVacia = (datos = {}) => ({
  clave: ++contador,
  nombre: '',
  tipo: 'Number',
  valor: '',
  lat: '',
  lon: '',
  pista: '',
  ...datos,
})

export const filasDePlantilla = () => PLANTILLA_SENSOR.map((f) => filaVacia(f))

export function filasDeEntidad(entidad) {
  return Object.entries(entidad)
    .filter(([nombre]) => nombre !== 'id' && nombre !== 'type')
    .map(([nombre, atributo]) => {
      const { type: tipo, value: valor } = atributo
      if (tipo === 'geo:json' && valor?.type === 'Point') {
        const [lon, lat] = valor.coordinates
        return filaVacia({ nombre, tipo, lat: String(lat), lon: String(lon) })
      }
      const texto = valor === null || valor === undefined ? '' : typeof valor === 'object' ? JSON.stringify(valor) : String(valor)
      return filaVacia({ nombre, tipo, valor: texto })
    })
}

function valorDeFila(fila) {
  const { nombre, tipo } = fila
  if (tipo === 'geo:json') {
    const lat = Number(fila.lat)
    const lon = Number(fila.lon)
    if (fila.lat === '' || fila.lon === '' || Number.isNaN(lat) || Number.isNaN(lon)) {
      throw new Error(`${nombre}: escribe latitud y longitud, o quita el atributo`)
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error(`${nombre}: la latitud va de -90 a 90 y la longitud de -180 a 180`)
    }
    // GeoJSON pone primero la longitud
    return { type: 'Point', coordinates: [lon, lat] }
  }

  const texto = fila.valor.trim()
  if (texto === '') return null
  if (esNumerico(tipo)) {
    const numero = Number(texto.replace(',', '.'))
    if (Number.isNaN(numero)) throw new Error(`${nombre}: "${texto}" no es un número`)
    return numero
  }
  if (tipo === 'Boolean') return texto === 'true'
  return fila.valor
}

// Devuelve { nombre: { value, type } } listo para la API, o lanza un Error con el problema
export function atributosDeFilas(filas) {
  const atributos = {}
  for (const fila of filas) {
    const nombre = fila.nombre.trim()
    if (!nombre) throw new Error('Hay un atributo sin nombre')
    if (!nombreValido(nombre)) throw new Error(`"${nombre}": el nombre no puede tener espacios ni < > " ' = ; ( ) & ? / #`)
    if (nombre in atributos) throw new Error(`El atributo "${nombre}" está repetido`)
    atributos[nombre] = { type: fila.tipo, value: valorDeFila({ ...fila, nombre }) }
  }
  return atributos
}

// Texto corto para mostrar un valor en tablas y tarjetas
export function valorLegible(atributo) {
  const { type: tipo, value: valor } = atributo ?? {}
  if (valor === null || valor === undefined || valor === '') return '—'
  if (tipo === 'geo:json' && valor.type === 'Point') {
    const [lon, lat] = valor.coordinates
    return `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`
  }
  if (typeof valor === 'object') return JSON.stringify(valor)
  return String(valor)
}

export const atributosDe = (entidad) =>
  Object.entries(entidad).filter(([nombre]) => nombre !== 'id' && nombre !== 'type')

// Numero con separadores en espanol y los decimales pedidos
export const formatear = (valor, decimales = 2) =>
  valor === undefined || valor === null
    ? '—'
    : Number(valor).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: decimales })
