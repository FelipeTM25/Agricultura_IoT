import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import GraficaLinea from '../componentes/GraficaLinea.jsx'
import Icono from '../componentes/Icono.jsx'
import { VARIABLES, formatear } from '../variables.js'

const RANGOS = [
  { horas: 1, texto: 'Última hora' },
  { horas: 6, texto: '6 horas' },
  { horas: 24, texto: '24 horas' },
  { horas: 168, texto: '7 días' },
]

const REFRESCO_MS = 2 * 60 * 1000

export default function Historico({ sensorId }) {
  const [horas, setHoras] = useState(24)
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [verTabla, setVerTabla] = useState(false)

  const cargar = useCallback(async () => {
    if (!sensorId) return
    setCargando(true)
    try {
      const respuesta = await api.historico(sensorId, horas)
      setDatos({ ...respuesta, hasta: Date.now() })
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [sensorId, horas])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, REFRESCO_MS)
    return () => clearInterval(id)
  }, [cargar])

  const conDatos = VARIABLES.filter((v) => datos?.series[v.clave]?.length)

  return (
    <section className="seccion seccion-alterna" id="historico">
      <div className="seccion-cabecera">
        <div>
          <p className="kicker kicker-oscuro">Histórico</p>
          <h2>Cómo ha cambiado el cultivo</h2>
          <p className="texto-suave">
            Datos ya limpios: sin lecturas imposibles, picos ni duplicados
            {datos?.intervalo_min ? `, promediados cada ${datos.intervalo_min} min` : ''}. Se actualizan cada 15 minutos.
          </p>
        </div>
      </div>

      {/* Filtro de rango: una sola fila, arriba de todas las graficas a las que afecta */}
      <div className="filtros" role="group" aria-label="Rango de tiempo">
        {RANGOS.map((r) => (
          <button key={r.horas} className={r.horas === horas ? 'activo' : ''} onClick={() => setHoras(r.horas)} aria-pressed={r.horas === horas}>
            {r.texto}
          </button>
        ))}
        {conDatos.length > 0 && (
          <button className="filtros-tabla" onClick={() => setVerTabla((v) => !v)} aria-pressed={verTabla}>
            <Icono nombre={verTabla ? 'grafica' : 'tabla'} tamano={16} /> {verTabla ? 'Ver gráficas' : 'Ver tabla'}
          </button>
        )}
      </div>

      {error && <p className="aviso">{error}</p>}

      {!sensorId || (datos && conDatos.length === 0) ? (
        <div className="vacio">
          <Icono nombre="grafica" tamano={32} />
          <p>
            {sensorId
              ? 'Todavía no hay datos limpios en este rango. Se van llenando cada 15 minutos a medida que el sensor envía lecturas.'
              : 'Cuando haya un sensor enviando datos, aquí aparecerá su histórico.'}
          </p>
        </div>
      ) : verTabla ? (
        <TablaHistorico datos={datos} variables={conDatos} />
      ) : (
        // Mientras recarga, las graficas se quedan con el render anterior un poco atenuadas
        <div className={`multiples ${cargando && datos ? 'recargando' : ''}`}>
          {conDatos.map((v) => {
            const serie = datos.series[v.clave]
            const valores = serie.map((p) => p.v)
            return (
              <article className="tarjeta-grafica" key={v.clave}>
                <header>
                  <h3>
                    <Icono nombre={v.icono} tamano={16} /> {v.titulo} <span>{v.detalle}</span>
                  </h3>
                  <p className="texto-suave">
                    mín {formatear(Math.min(...valores), v.decimales)} · máx {formatear(Math.max(...valores), v.decimales)} {v.unidad}
                  </p>
                </header>
                <GraficaLinea
                  puntos={serie}
                  desde={datos.desde}
                  hasta={datos.hasta}
                  intervaloMin={datos.intervalo_min}
                  unidad={v.unidad}
                  decimales={v.decimales}
                  titulo={`${v.titulo} ${v.detalle}`}
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
function TablaHistorico({ datos, variables }) {
  const horas = [...new Set(variables.flatMap((v) => datos.series[v.clave].map((p) => p.t)))].sort().reverse()
  const indice = Object.fromEntries(variables.map((v) => [v.clave, Object.fromEntries(datos.series[v.clave].map((p) => [p.t, p.v]))]))

  return (
    <div className="tabla-contenedor">
      <table className="tabla">
        <thead>
          <tr>
            <th>Hora</th>
            {variables.map((v) => (
              <th key={v.clave}>
                {v.titulo} {v.detalle} ({v.unidad})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {horas.map((t) => (
            <tr key={t}>
              <td>{new Date(t).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              {variables.map((v) => (
                <td key={v.clave}>{formatear(indice[v.clave][t], v.decimales)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
