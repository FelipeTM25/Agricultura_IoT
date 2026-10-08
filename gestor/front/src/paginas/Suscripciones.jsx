import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Icono from '../componentes/Icono.jsx'
import FormSuscripcion from './FormSuscripcion.jsx'

const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '—')

export default function Suscripciones() {
  const [suscripciones, setSuscripciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      setSuscripciones(await api.suscripciones())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const borrar = async (s) => {
    if (!window.confirm(`¿Borrar la suscripción "${s.description || s.id}"? Orion dejará de notificar esos cambios.`)) return
    setAviso('')
    try {
      await api.borrarSuscripcion(s.id)
      setAviso('Suscripción borrada')
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  const alGuardar = (mensaje) => {
    setCreando(false)
    setAviso(mensaje)
    cargar()
  }

  return (
    <section className="pagina">
      <div className="acciones">
        <p className="texto-suave acciones-texto">
          Cada suscripción le dice a Orion a quién avisar cuando cambian los sensores.
        </p>
        <button className="boton boton-suave" onClick={cargar} disabled={cargando}>
          <Icono nombre="recargar" /> Actualizar
        </button>
        <button className="boton boton-primario" onClick={() => setCreando(true)}>
          <Icono nombre="mas" /> Nueva suscripción
        </button>
      </div>

      {aviso && <p className="aviso aviso-ok">{aviso}</p>}
      {error && <p className="aviso aviso-error">{error}</p>}

      <div className="tarjeta tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th>Descripción</th>
              <th>Entidades</th>
              <th>Dispara con</th>
              <th>Notifica a</th>
              <th>Estado</th>
              <th className="columna-acciones">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando && suscripciones.length === 0 ? (
              <tr>
                <td colSpan="6" className="tabla-vacia">Cargando…</td>
              </tr>
            ) : suscripciones.length === 0 ? (
              <tr>
                <td colSpan="6" className="tabla-vacia">
                  No hay suscripciones. Sin ellas, los cambios en Orion no llegan al histórico.
                </td>
              </tr>
            ) : (
              suscripciones.map((s) => {
                const entidades = s.subject?.entities ?? []
                const condicion = s.subject?.condition?.attrs ?? []
                const notif = s.notification ?? {}
                const estado = s.status ?? 'active'
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.description || 'Sin descripción'}</strong>
                      <small className="celda-sub">{s.id}</small>
                    </td>
                    <td>
                      {entidades.map((e, i) => (
                        <div key={i}>
                          <span className="etiqueta">{e.type ?? 'cualquier tipo'}</span> <code>{e.id ?? e.idPattern}</code>
                        </div>
                      ))}
                    </td>
                    <td>{condicion.length ? condicion.join(', ') : <span className="texto-suave">cualquier cambio</span>}</td>
                    <td>
                      <code className="celda-url">{notif.http?.url ?? notif.httpCustom?.url ?? '—'}</code>
                      <small className="celda-sub">
                        {notif.timesSent ?? 0} envíos · último {fecha(notif.lastNotification)}
                      </small>
                    </td>
                    <td>
                      <span className={`estado estado-${estado}`}>{estado}</span>
                      {notif.lastFailure && <small className="celda-sub texto-error">falló {fecha(notif.lastFailure)}</small>}
                    </td>
                    <td className="columna-acciones">
                      <button className="boton-icono boton-peligro" onClick={() => borrar(s)} aria-label="Borrar suscripción" title="Borrar">
                        <Icono nombre="basura" />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {creando && <FormSuscripcion onCerrar={() => setCreando(false)} onGuardado={alGuardar} />}
    </section>
  )
}
