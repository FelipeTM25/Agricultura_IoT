import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Icono from '../componentes/Icono.jsx'
import { ICONO_VARIABLE, atributosDe, valorLegible } from '../ngsi.js'

// Orion-LD responde algo como {"orionld version": "1.x", ...}; tomamos la primera clave con "version"
function versionDeOrion(estado) {
  const entrada = Object.entries(estado ?? {}).find(([clave]) => /version/i.test(clave))
  return entrada ? String(entrada[1]) : 'en línea'
}

export default function Resumen() {
  const [datos, setDatos] = useState(null)

  useEffect(() => {
    Promise.allSettled([api.estado(), api.entidades(), api.suscripciones(), api.alertas(true)]).then(
      ([estado, entidades, suscripciones, alertas]) => setDatos({ estado, entidades, suscripciones, alertas }),
    )
  }, [])

  if (!datos) return <p className="texto-suave">Cargando…</p>

  const { estado, entidades, suscripciones, alertas } = datos
  const activas = alertas.status === 'fulfilled' ? alertas.value : null
  const orionOk = estado.status === 'fulfilled'
  const listaEntidades = entidades.status === 'fulfilled' ? entidades.value : []
  const tipos = new Set(listaEntidades.map((e) => e.type))

  return (
    <section className="pagina">
      <div className="indicadores">
        <article className="tarjeta indicador">
          <span className={`indicador-icono ${orionOk ? '' : 'indicador-error'}`}>
            <Icono nombre="hoja" tamano={22} />
          </span>
          <div>
            <small>Orion</small>
            <strong>{orionOk ? 'Conectado' : 'Sin conexión'}</strong>
            <span className="texto-suave">{orionOk ? versionDeOrion(estado.value) : estado.reason.message}</span>
          </div>
        </article>
        <article className="tarjeta indicador">
          <span className="indicador-icono indicador-trigo">
            <Icono nombre="sensor" tamano={22} />
          </span>
          <div>
            <small>Sensores</small>
            <strong>{entidades.status === 'fulfilled' ? listaEntidades.length : '—'}</strong>
            <span className="texto-suave">{tipos.size} {tipos.size === 1 ? 'tipo' : 'tipos'} de entidad</span>
          </div>
        </article>
        <article className="tarjeta indicador">
          <span className="indicador-icono indicador-tierra">
            <Icono nombre="campana" tamano={22} />
          </span>
          <div>
            <small>Suscripciones</small>
            <strong>{suscripciones.status === 'fulfilled' ? suscripciones.value.length : '—'}</strong>
            <span className="texto-suave">notificando cambios</span>
          </div>
        </article>
        <a href="#alertas" className="tarjeta indicador indicador-enlace">
          <span className={`indicador-icono ${activas?.length ? 'indicador-error' : ''}`}>
            <Icono nombre="alerta" tamano={22} />
          </span>
          <div>
            <small>Alertas activas</small>
            <strong>{activas ? activas.length : '—'}</strong>
            <span className="texto-suave">
              {activas === null ? 'servicio sin respuesta' : activas.length ? activas.map((a) => a.titulo).join(' · ') : 'todo en rango'}
            </span>
          </div>
        </a>
      </div>

      <div className="seccion-cabecera">
        <h2>Lecturas actuales</h2>
        <a href="#entidades" className="enlace">Gestionar sensores →</a>
      </div>

      {listaEntidades.length === 0 ? (
        <div className="tarjeta vacio">
          <Icono nombre="hoja" tamano={32} />
          <p>Aún no hay sensores registrados en Orion.</p>
          <a href="#entidades" className="boton boton-primario">
            <Icono nombre="mas" /> Registrar el primer sensor
          </a>
        </div>
      ) : (
        <div className="sensores">
          {listaEntidades.map((entidad) => (
            <article className="tarjeta sensor" key={entidad.id}>
              <header>
                <strong>{entidad.id}</strong>
                <span className="etiqueta">{entidad.type}</span>
              </header>
              <dl>
                {atributosDe(entidad).map(([nombre, atributo]) => (
                  <div className="lectura" key={nombre}>
                    <dt>
                      <Icono nombre={ICONO_VARIABLE[nombre] ?? 'dato'} tamano={15} />
                      {nombre}
                    </dt>
                    <dd>{valorLegible(atributo)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
