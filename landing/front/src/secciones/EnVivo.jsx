import Icono from '../componentes/Icono.jsx'
import useAhora from '../useAhora.js'
import { VARIABLES, formatear, haceCuanto } from '../variables.js'

export default function EnVivo({ sensores, sensorId, onElegir, error }) {
  const ahora = useAhora()
  const sensor = sensores.find((s) => s.id === sensorId)

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

      <div className="tiles">
        {VARIABLES.map((v) => {
          const valor = sensor?.variables[v.clave]
          return (
            <article className="tile" key={v.clave}>
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
