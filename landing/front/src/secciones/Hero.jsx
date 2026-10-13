import Icono from '../componentes/Icono.jsx'
import useAhora from '../useAhora.js'
import { VARIABLES, enVivo, formatear, haceCuanto } from '../variables.js'

export default function Hero({ sensor, cargando }) {
  const ahora = useAhora()
  const vivo = enVivo(sensor?.actualizado, ahora)
  const temperatura = sensor?.variables.temperatura
  const secundarias = VARIABLES.filter((v) => v.clave !== 'temperatura')

  return (
    <section className="hero" id="inicio">
      <div className="hero-texto">
        <p className="kicker">Proyecto IoT · UPB · Plataforma FIWARE</p>
        <h1>El cultivo, medido en tiempo real</h1>
        <p className="hero-descripcion">
          Un nodo LilyGO en el campo mide temperatura, humedad del aire y del suelo, luz y radiación, y las publica cada 30 segundos
          en la nube. Aquí puedes ver cómo está la planta ahora mismo y cómo ha cambiado durante el día.
        </p>
        <div className="hero-acciones">
          <a href="#en-vivo" className="boton boton-trigo">
            Ver lecturas <Icono nombre="flecha" />
          </a>
          <a href="#como-funciona" className="boton boton-contorno">
            Cómo funciona
          </a>
        </div>
      </div>

      <article className="hero-tarjeta" aria-live="polite">
        <header>
          <span className={`pulso ${vivo ? 'pulso-vivo' : ''}`} aria-hidden="true" />
          <span>{sensor ? (vivo ? 'En vivo' : 'Última lectura') : cargando ? 'Conectando…' : 'Sin lecturas'}</span>
          <span className="hero-tarjeta-hora">{sensor ? haceCuanto(sensor.actualizado, ahora) : ''}</span>
        </header>

        {sensor && temperatura !== undefined ? (
          <>
            <p className="hero-cifra-etiqueta">Temperatura del aire · {sensor.id}</p>
            <p className="hero-cifra">
              {formatear(temperatura, 1)}
              <span>°C</span>
            </p>
            <dl className="hero-lista">
              {secundarias.map((v) => (
                <div key={v.clave}>
                  <dt>
                    <Icono nombre={v.icono} tamano={15} /> {v.titulo} {v.detalle}
                  </dt>
                  <dd>
                    {formatear(sensor.variables[v.clave], v.decimales)} <small>{v.unidad}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <div className="hero-espera">
            <Icono nombre="brote" tamano={36} />
            <p>{cargando ? 'Buscando el sensor…' : 'El sensor todavía no ha enviado lecturas. Apenas lo haga, aparecerán aquí.'}</p>
          </div>
        )}
      </article>
    </section>
  )
}
