import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Icono from '../componentes/Icono.jsx'
import { ICONO_VARIABLE, formatear } from '../ngsi.js'
import FormUmbral, { VARIABLES } from './FormUmbral.jsx'

const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const nombreVariable = (clave) => VARIABLES.find((v) => v.clave === clave)?.texto ?? clave
const condicion = (operador, valor) => `${operador === '>' ? 'mayor que' : 'menor que'} ${formatear(valor)}`

// El nodo envia cada 30 s: refrescar cada 15 s deja ver una alerta casi apenas se abre
const REFRESCO_MS = 15 * 1000

export default function Alertas() {
  const [estado, setEstado] = useState(null)
  const [historial, setHistorial] = useState([])
  const [activas, setActivas] = useState([])
  const [umbrales, setUmbrales] = useState([])
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [editando, setEditando] = useState(undefined) // undefined: cerrado, null: nuevo, objeto: editar
  const [probando, setProbando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [e, a, h, u] = await Promise.all([api.estadoAlertas(), api.alertas(true), api.alertas(), api.umbrales()])
      setEstado(e)
      setActivas(a)
      setHistorial(h)
      setUmbrales(u)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, REFRESCO_MS)
    return () => clearInterval(id)
  }, [cargar])

  const probar = async () => {
    setProbando(true)
    setAviso('')
    setError('')
    try {
      const r = await api.probarAlertas()
      setAviso(`Correo de prueba enviado a ${r.destino.join(', ')}: revisa la bandeja (o spam)`)
    } catch (err) {
      setError(err.message)
    } finally {
      setProbando(false)
    }
  }

  const borrar = async (u) => {
    if (!window.confirm(`¿Borrar el umbral "${u.titulo}"? Sus alertas abiertas se cerrarán.`)) return
    setAviso('')
    try {
      await api.borrarUmbral(u.id)
      setAviso('Umbral borrado')
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  const alGuardar = (mensaje) => {
    setEditando(undefined)
    setAviso(mensaje)
    cargar()
  }

  const suscripcion = estado?.suscripcion

  return (
    <section className="pagina">
      <div className="acciones">
        <p className="texto-suave acciones-texto">
          Orion le notifica cada lectura al servicio de alertas, que la compara con estos umbrales. Si se cruzan
          {estado ? ` ${estado.confirmar_lecturas} ${estado.confirmar_lecturas === 1 ? 'vez' : 'veces'} seguidas` : ''}, abre una alerta y avisa por
          correo; al normalizarse, la cierra y avisa de nuevo.
        </p>
        {estado?.correo && (
          <button className="boton boton-suave" onClick={probar} disabled={probando}>
            <Icono nombre="campana" /> {probando ? 'Enviando…' : 'Enviar correo de prueba'}
          </button>
        )}
        <button className="boton boton-primario" onClick={() => setEditando(null)}>
          <Icono nombre="mas" /> Nuevo umbral
        </button>
      </div>

      {aviso && <p className="aviso aviso-ok">{aviso}</p>}
      {error && <p className="aviso aviso-error">{error}</p>}

      {estado && (
        <div className="indicadores">
          <article className="tarjeta indicador">
            <span className={`indicador-icono ${activas.length ? 'indicador-error' : ''}`}>
              <Icono nombre="alerta" tamano={22} />
            </span>
            <div>
              <small>Alertas activas</small>
              <strong>{activas.length}</strong>
              <span className="texto-suave">{activas.length ? 'revisa el cultivo' : 'todo en rango'}</span>
            </div>
          </article>
          <article className="tarjeta indicador">
            <span className={`indicador-icono ${estado.correo ? 'indicador-trigo' : 'indicador-tierra'}`}>
              <Icono nombre="campana" tamano={22} />
            </span>
            <div>
              <small>Correo</small>
              <strong>{estado.correo ? 'Configurado' : 'Sin configurar'}</strong>
              <span className="texto-suave" title={estado.correo ? estado.destino.join(', ') : 'SMTP_USUARIO y SMTP_PASSWORD en el .env de la raíz'}>
                {estado.correo ? `avisa a ${estado.destino.join(', ')}` : 'solo se registran aquí'}
              </span>
            </div>
          </article>
          <article className="tarjeta indicador">
            <span className={`indicador-icono ${suscripcion?.error ? 'indicador-error' : ''}`}>
              <Icono nombre="hoja" tamano={22} />
            </span>
            <div>
              <small>Suscripción en Orion</small>
              <strong>{suscripcion?.id ? 'Activa' : 'Pendiente'}</strong>
              <span className="texto-suave" title={suscripcion?.error ?? suscripcion?.id ?? ''}>
                {suscripcion?.error ?? suscripcion?.id ?? 'se crea al arrancar el servicio'}
              </span>
            </div>
          </article>
        </div>
      )}

      {activas.length > 0 && (
        <>
          <div className="seccion-cabecera">
            <h2>Activas ahora</h2>
          </div>
          <div className="alertas-activas">
            {activas.map((a) => (
              <article className="tarjeta alerta-activa" key={a.id}>
                <Icono nombre="alerta" tamano={22} />
                <div>
                  <strong>
                    {a.titulo} · {a.sensor_id}
                  </strong>
                  <span>
                    {a.variable} = {formatear(a.valor)} ({condicion(a.operador, a.limite)}) desde {fecha(a.inicio)}
                  </span>
                  {a.accion && <span className="alerta-accion">Recomendación: {a.accion}</span>}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <div className="seccion-cabecera">
        <h2>Umbrales</h2>
      </div>
      <div className="tarjeta tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Alerta cuando sea</th>
              <th>Título y acción recomendada</th>
              <th>Estado</th>
              <th className="columna-acciones">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {umbrales.length === 0 ? (
              <tr>
                <td colSpan="5" className="tabla-vacia">No hay umbrales: ninguna lectura genera alertas.</td>
              </tr>
            ) : (
              umbrales.map((u) => (
                <tr key={u.id}>
                  <td className="celda-id">
                    <Icono nombre={ICONO_VARIABLE[u.variable] ?? 'dato'} tamano={15} /> {nombreVariable(u.variable)}
                  </td>
                  <td>{condicion(u.operador, u.valor)}</td>
                  <td>
                    <strong>{u.titulo}</strong>
                    {u.accion && <small className="celda-sub">{u.accion}</small>}
                  </td>
                  <td>
                    <span className={`estado ${u.activo ? 'estado-active' : 'estado-inactive'}`}>{u.activo ? 'activo' : 'inactivo'}</span>
                  </td>
                  <td className="columna-acciones">
                    <button className="boton-icono" onClick={() => setEditando(u)} aria-label="Editar umbral" title="Editar">
                      <Icono nombre="lapiz" />
                    </button>
                    <button className="boton-icono boton-peligro" onClick={() => borrar(u)} aria-label="Borrar umbral" title="Borrar">
                      <Icono nombre="basura" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="seccion-cabecera">
        <h2>Historial</h2>
      </div>
      <div className="tarjeta tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th>Inicio</th>
              <th>Sensor</th>
              <th>Alerta</th>
              <th>Valor</th>
              <th>Fin</th>
              <th>Correo</th>
            </tr>
          </thead>
          <tbody>
            {historial.length === 0 ? (
              <tr>
                <td colSpan="6" className="tabla-vacia">Todavía no se ha disparado ninguna alerta.</td>
              </tr>
            ) : (
              historial.map((a) => (
                <tr key={a.id}>
                  <td>{fecha(a.inicio)}</td>
                  <td className="celda-id">{a.sensor_id}</td>
                  <td>
                    <strong>{a.titulo}</strong>
                    <small className="celda-sub">
                      {a.variable} {condicion(a.operador, a.limite)}
                    </small>
                  </td>
                  <td>
                    {formatear(a.valor)}
                    {a.valor_fin !== null && <small className="celda-sub">al cerrar {formatear(a.valor_fin)}</small>}
                  </td>
                  <td>{a.fin ? fecha(a.fin) : <span className="estado estado-failed">activa</span>}</td>
                  <td>{a.notificada ? 'enviada' : <span className="texto-suave">no</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editando !== undefined && <FormUmbral umbral={editando} onCerrar={() => setEditando(undefined)} onGuardado={alGuardar} />}
    </section>
  )
}
