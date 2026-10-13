import Icono from '../componentes/Icono.jsx'
import Mapa from '../componentes/Mapa.jsx'

export default function Ubicacion({ sensores }) {
  const conGps = sensores.filter((s) => s.ubicacion)

  return (
    <section className="seccion" id="ubicacion">
      <div className="seccion-cabecera">
        <div>
          <p className="kicker kicker-oscuro">Ubicación</p>
          <h2>Dónde está el sensor</h2>
          <p className="texto-suave">Posición que reporta el GPS del nodo. Se publica solo cuando el GPS tiene señal de satélites.</p>
        </div>
      </div>

      {conGps.length ? (
        <div className="ubicacion">
          <Mapa sensores={conGps} />
          <ul className="ubicacion-lista">
            {conGps.map((s) => (
              <li key={s.id}>
                <Icono nombre="pin" tamano={18} />
                <div>
                  <strong>{s.id}</strong>
                  <span>
                    {s.ubicacion.lat.toFixed(5)}, {s.ubicacion.lon.toFixed(5)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="vacio">
          <Icono nombre="pin" tamano={32} />
          <p>El GPS todavía no tiene señal. La ubicación aparece cuando el nodo está al aire libre y encuentra satélites.</p>
        </div>
      )}
    </section>
  )
}
