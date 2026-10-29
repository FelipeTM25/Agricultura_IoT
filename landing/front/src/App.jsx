import { useEffect, useState } from 'react'
import { api } from './api.js'
import Icono from './componentes/Icono.jsx'
import ComoFunciona from './secciones/ComoFunciona.jsx'
import EnVivo from './secciones/EnVivo.jsx'
import Hero from './secciones/Hero.jsx'
import Historico from './secciones/Historico.jsx'
import Ubicacion from './secciones/Ubicacion.jsx'

const REFRESCO_SENSORES_MS = 30 * 1000 // el nodo envia cada 30 s
const REFRESCO_ESTADO_MS = 60 * 1000

const ENLACES = [
  ['en-vivo', 'En vivo'],
  ['historico', 'Histórico'],
  ['ubicacion', 'Ubicación'],
  ['como-funciona', 'Cómo funciona'],
]

export default function App() {
  const [sensores, setSensores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [estado, setEstado] = useState(null)
  const [sensorId, setSensorId] = useState(null)
  const [alertas, setAlertas] = useState([])

  useEffect(() => {
    const cargarSensores = () =>
      api
        .sensores()
        .then((lista) => {
          setSensores(lista)
          setError('')
          // Si no hay uno elegido (o desaparecio), se toma el primero
          setSensorId((actual) => (lista.some((s) => s.id === actual) ? actual : lista[0]?.id ?? null))
        })
        .catch((err) => setError(`No se pudieron cargar las lecturas: ${err.message}`))
        .finally(() => setCargando(false))
    // Si el servicio de alertas no responde se deja la ultima lista: no es motivo para un error en pantalla
    const cargarAlertas = () => api.alertas().then(setAlertas).catch(() => {})
    const cargarEstado = () =>
      api
        .estado()
        .then(setEstado)
        .catch(() => setEstado({ orion: false, limpieza: false, alertas: false }))

    cargarSensores()
    cargarAlertas()
    cargarEstado()
    const a = setInterval(() => {
      cargarSensores()
      cargarAlertas()
    }, REFRESCO_SENSORES_MS)
    const b = setInterval(cargarEstado, REFRESCO_ESTADO_MS)
    return () => {
      clearInterval(a)
      clearInterval(b)
    }
  }, [])

  const sensor = sensores.find((s) => s.id === sensorId)
  const plataformaOk = estado && estado.orion && estado.limpieza && estado.alertas

  return (
    <>
      <header className="nav">
        <a href="#inicio" className="marca">
          <span className="marca-logo">
            <Icono nombre="hoja" tamano={20} />
          </span>
          <strong>Agricultura IoT</strong>
        </a>
        <nav aria-label="Secciones">
          {ENLACES.map(([id, texto]) => (
            <a key={id} href={`#${id}`}>
              {texto}
            </a>
          ))}
        </nav>
        {estado && (
          <span className={`nav-estado ${plataformaOk ? 'nav-estado-ok' : 'nav-estado-error'}`}>
            {plataformaOk ? '● Plataforma en línea' : '● Plataforma con fallas'}
          </span>
        )}
      </header>

      <main>
        <Hero sensor={sensor} cargando={cargando} />
        <EnVivo sensores={sensores} sensorId={sensorId} onElegir={setSensorId} error={error} alertas={alertas} />
        <Historico sensorId={sensorId} />
        <Ubicacion sensores={sensores} />
        <ComoFunciona estado={estado} />
      </main>

      <footer className="pie">
        <span className="marca-logo">
          <Icono nombre="hoja" tamano={16} />
        </span>
        <p>
          Agricultura IoT · Proyecto final de Internet de las Cosas, Universidad Pontificia Bolivariana · 2026
        </p>
      </footer>
    </>
  )
}
