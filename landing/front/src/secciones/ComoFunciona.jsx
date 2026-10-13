import Icono from '../componentes/Icono.jsx'

const PASOS = [
  {
    icono: 'chip',
    titulo: 'Nodo LilyGO',
    texto: 'Un ESP32 con sensores de temperatura, humedad, suelo, luz y GPS toma 20 muestras, las promedia y las envía por WiFi.',
  },
  {
    icono: 'nube',
    titulo: 'Orion-LD',
    texto: 'El Context Broker de FIWARE guarda el estado actual de cada sensor y avisa cada vez que una lectura cambia.',
  },
  {
    icono: 'campana',
    titulo: 'QuantumLeap',
    texto: 'Recibe los avisos de Orion y convierte cada lectura en un punto de una serie de tiempo.',
  },
  {
    icono: 'base',
    titulo: 'CrateDB',
    texto: 'Base de datos de series de tiempo donde queda todo el histórico del cultivo.',
  },
  {
    icono: 'grafica',
    titulo: 'Visualización',
    texto: 'Esta página y los tableros de Grafana leen el estado actual y el histórico para mostrarlos.',
  },
]

export default function ComoFunciona({ estado }) {
  const servicio = { 'Orion-LD': estado?.orion, QuantumLeap: estado?.quantumleap }

  return (
    <section className="seccion seccion-oscura" id="como-funciona">
      <div className="seccion-cabecera">
        <div>
          <p className="kicker">Cómo funciona</p>
          <h2>Del campo a la pantalla</h2>
          <p className="texto-claro">Todo corre sobre la plataforma abierta FIWARE, en contenedores Docker en una instancia de AWS.</p>
        </div>
      </div>

      <ol className="flujo">
        {PASOS.map((p, i) => (
          <li key={p.titulo}>
            <span className="flujo-numero">{i + 1}</span>
            <span className="flujo-icono">
              <Icono nombre={p.icono} tamano={24} />
            </span>
            <h3>{p.titulo}</h3>
            <p>{p.texto}</p>
            {p.titulo in servicio && estado && (
              <span className={`estado ${servicio[p.titulo] ? 'estado-ok' : 'estado-error'}`}>
                {servicio[p.titulo] ? '✓ en línea' : '✕ sin conexión'}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
