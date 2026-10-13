import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import GraficaLinea from '../componentes/GraficaLinea.jsx'
import Icono from '../componentes/Icono.jsx'
import { ICONO_VARIABLE, formatear } from '../ngsi.js'

const RANGOS = [
  { horas: 1, texto: '1 h' },
  { horas: 6, texto: '6 h' },
  { horas: 24, texto: '24 h' },
  { horas: 168, texto: '7 días' },
]

const REFRESCO_MS = 60 * 1000

// La entidad elegida viaja en la URL (#historico/sensor01) para poder llegar desde la tabla de sensores
const entidadDeLaUrl = () => decodeURIComponent(window.location.hash.split('/')[1] ?? '')

export default function Historico() {
  const [entidades, setEntidades] = useState([])
  const [entidadId, setEntidadId] = useState(entidadDeLaUrl)
  const [horas, setHoras] = useState(24)
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [verTabla, setVerTabla] = useState(false)

  useEffect(() => {
    api
      .entidades()
      .then((lista) => {
        setEntidades(lista)
        setEntidadId((actual) => (lista.some((e) => e.id === actual) ? actual : lista[0]?.id ?? ''))
      })
      .catch((err) => setError(err.message))
  }, [])

  const entidad = entidades.find((e) => e.id === entidadId)

  const cargar = useCallback(async () => {
    if (!entidad) return
    setCargando(true)
    try {
      const respuesta = await api.historico(entidad.id, entidad.type, horas)
      setDatos({ ...respuesta, hasta: Date.now() })
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [entidad, horas])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, REFRESCO_MS)
    return () => clearInterval(id)
  }, [cargar])

  const elegir = (id) => {
    setEntidadId(id)
    setDatos(null)
    window.history.replaceState(null, '', `#historico/${encodeURIComponent(id)}`)
  }

  const nombres = Object.keys(datos?.series ?? {})

  return (
    <section className="pagina">
      {/* Filtros: una sola fila, arriba de todas las graficas a las que afectan */}
      <div className="acciones">
        <select className="selector-entidad" value={entidadId} onChange={(e) => elegir(e.target.value)} aria-label="Sensor">
          {entidades.length === 0 && <option value="">Sin sensores</option>}
          {entidades.map((e) => (
            <option key={e.id} value={e.id}>
              {e.id} ({e.type})
            </option>
          ))}
        </select>
        <div className="filtros" role="group" aria-label="Rango de tiempo">
          {RANGOS.map((r) => (
            <button key={r.horas} className={r.horas === horas ? 'activo' : ''} aria-pressed={r.horas === horas} onClick={() => setHoras(r.horas)}>
              {r.texto}
            </button>
          ))}
        </div>
        <button className="boton boton-suave" onClick={cargar} disabled={cargando || !entidad}>
          <Icono nombre="recargar" /> Actualizar
        </button>
        {nombres.length > 0 && (
          <button className="boton boton-suave" onClick={() => setVerTabla((v) => !v)} aria-pressed={verTabla}>
            <Icono nombre={verTabla ? 'grafica' : 'tabla'} /> {verTabla ? 'Ver gráficas' : 'Ver tabla'}
          </button>
        )}
      </div>

      {datos && (
        <p className="texto-suave">
          {datos.puntos} lecturas en CrateDB en este rango
          {datos.puntos ? `, promediadas cada ${datos.intervalo_min} min` : ''}.
        </p>
      )}
      {error && <p className="aviso aviso-error">{error}</p>}

      {!entidad ? (
        <div className="tarjeta vacio">
          <Icono nombre="grafica" tamano={32} />
          <p>No hay sensores en Orion todavía.</p>
        </div>
      ) : datos && nombres.length === 0 ? (
        <div className="tarjeta vacio">
          <Icono nombre="grafica" tamano={32} />
          <p>
            No hay histórico de <strong>{entidad.id}</strong> en este rango. Revisa que exista una suscripción de tipo{' '}
            <code>{entidad.type}</code> hacia QuantumLeap y que el sensor esté enviando.
          </p>
          <a href="#suscripciones" className="boton boton-primario">
            <Icono nombre="campana" /> Ir a suscripciones
          </a>
        </div>
      ) : verTabla ? (
        <TablaHistorico datos={datos} nombres={nombres} />
      ) : (
        // Mientras recarga, las graficas conservan el render anterior un poco atenuadas
        <div className={`multiples ${cargando && datos ? 'recargando' : ''}`}>
          {nombres.map((nombre) => {
            const serie = datos.series[nombre]
            const valores = serie.map((p) => p.v)
            return (
              <article className="tarjeta tarjeta-grafica" key={nombre}>
                <header>
                  <h3>
                    <Icono nombre={ICONO_VARIABLE[nombre] ?? 'dato'} tamano={16} /> {nombre}
                  </h3>
                  <p className="texto-suave">
                    mín {formatear(Math.min(...valores))} · máx {formatear(Math.max(...valores))}
                  </p>
                </header>
                <GraficaLinea
                  puntos={serie}
                  desde={datos.desde}
                  hasta={datos.hasta}
                  intervaloMin={datos.intervalo_min}
                  unidad=""
                  decimales={2}
                  titulo={nombre}
                />
              </article>
            )
          })}
          {!datos && <p className="texto-suave">Cargando histórico…</p>}
        </div>
      )}
    </section>
  )
}

// Vista de tabla: los mismos datos de las graficas, alineados por hora
function TablaHistorico({ datos, nombres }) {
  const horas = [...new Set(nombres.flatMap((n) => datos.series[n].map((p) => p.t)))].sort().reverse()
  const indice = Object.fromEntries(nombres.map((n) => [n, Object.fromEntries(datos.series[n].map((p) => [p.t, p.v]))]))

  return (
    <div className="tarjeta tabla-contenedor tabla-historico">
      <table className="tabla">
        <thead>
          <tr>
            <th>Hora</th>
            {nombres.map((n) => (
              <th key={n}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {horas.map((t) => (
            <tr key={t}>
              <td>{new Date(t).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              {nombres.map((n) => (
                <td key={n}>{formatear(indice[n][t])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
