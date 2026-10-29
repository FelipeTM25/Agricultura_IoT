import Icono from '../componentes/Icono.jsx'
import useAhora from '../useAhora.js'
import { VARIABLES, formatear, haceCuanto } from '../variables.js'

export default function EnVivo({ sensores, sensorId, onElegir, error, alertas }) {
  const ahora = useAhora()
  const sensor = sensores.find((s) => s.id === sensorId)
  const delSensor = alertas.filter((a) => a.sensor_id === sensorId)
  const conAlerta = new Set(delSensor.map((a) => a.variable))

  return (
    <section className="seccion" id="en-vivo">
      <div className="seccion-cabecera">
        <div>
          <p className="kicker kicker-oscuro">En vivo</p>
          <h2>Lecturas actuales</h2>
          <p className="texto-suave">
            Promedio de 20 muestras que el nodo toma en cada ciclo. Se actualiza solo cada 30 segundos.
          </p>
        </div>
        {sensores.length > 1 && (
          <div className="selector" role="group" aria-label="Elegir sensor">
            {sensores.map((s) => (
              <button key={s.id} className={s.id === sensorId ? 'activo' : ''} onClick={() => onElegir(s.id)}>
                {s.id}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="aviso">{error}</p>}

      {delSensor.length > 0 && (
        <ul className="alertas" aria-label="Alertas activas">
          {delSensor.map((a) => {
            const v = VARIABLES.find((x) => x.clave === a.variable)
            return (
              <li key={`${a.variable}-${a.inicio}`}>
                <Icono nombre="alerta" tamano={20} />
                <div>
                  <strong>{a.titulo}</strong>
                  <span>
                    {formatear(a.valor, v?.decimales ?? 1)} {v?.unidad} (límite {a.operador} {formatear(a.limite, v?.decimales ?? 1)}) ·{' '}
                    {haceCuanto(a.inicio, ahora)}
                  </span>
                  {a.accion && <span className="alertas-accion">Recomendación: {a.accion}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="tiles">
        {VARIABLES.map((v) => {
          const valor = sensor?.variables[v.clave]
          return (
            <article className={`tile ${conAlerta.has(v.clave) ? 'tile-alerta' : ''}`} key={v.clave}>
              <span className="tile-icono">
                <Icono nombre={v.icono} tamano={20} />
              </span>
              <p className="tile-etiqueta">
                {v.titulo} <span>{v.detalle}</span>
              </p>
              <p className="tile-valor">
                {formatear(valor, v.decimales)}
                {valor !== undefined && <small>{v.unidad}</small>}
              </p>
              <p className="tile-pie">{valor === undefined ? 'sin lectura' : haceCuanto(sensor.actualizado, ahora)}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
