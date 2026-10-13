import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Icono from '../componentes/Icono.jsx'
import { formatear } from '../ngsi.js'

const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

// URL de Grafana: mismo host que el gestor, puerto 3000
const URL_GRAFANA = `${window.location.protocol}//${window.location.hostname}:3000/d/agricultura-limpios`

export default function Limpieza() {
  const [estado, setEstado] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ejecutando, setEjecutando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setEstado(await api.limpieza())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    cargar()
    const id = setInterval(cargar, 30 * 1000)
    return () => clearInterval(id)
  }, [cargar])

  const ejecutar = async () => {
    setEjecutando(true)
    setAviso('')
    setError('')
    try {
      const r = await api.ejecutarLimpieza()
      if (r.error) setError(`La limpieza terminó con error: ${r.error}`)
      else setAviso(`Listo: ${r.leidas} lecturas revisadas, ${r.validas} válidas, ${r.descartadas} descartadas, ${r.intervalos} intervalos guardados en Postgres`)
      cargar()
    } catch (err) {
      setError(err.message)
    } finally {
      setEjecutando(false)
    }
  }

  const reglas = estado?.reglas
  const datos = estado?.datos

  return (
    <section className="pagina">
      <div className="acciones">
        <p className="texto-suave acciones-texto">
          Lee el histórico crudo de CrateDB, descarta las lecturas imposibles o con picos y guarda en Postgres los promedios
          {estado ? ` cada ${estado.intervalo_datos_min} min` : ''}. Grafana dibuja desde ahí.
        </p>
        <a className="boton boton-suave" href={URL_GRAFANA} target="_blank" rel="noreferrer">
          <Icono nombre="grafica" /> Abrir Grafana
        </a>
        <button className="boton boton-primario" onClick={ejecutar} disabled={ejecutando || estado?.en_curso}>
          <Icono nombre="recargar" /> {ejecutando ? 'Limpiando…' : 'Limpiar ahora'}
        </button>
      </div>

      {aviso && <p className="aviso aviso-ok">{aviso}</p>}
      {error && <p className="aviso aviso-error">{error}</p>}

      {estado && (
        <>
          <div className="indicadores">
            <article className="tarjeta indicador">
              <span className="indicador-icono"><Icono nombre="filtro" tamano={22} /></span>
              <div>
                <small>Limpieza automática</small>
                <strong>{estado.intervalo_min ? `Cada ${estado.intervalo_min} min` : 'Apagada'}</strong>
                <span className="texto-suave">{estado.proxima ? `próxima ${fecha(estado.proxima)}` : 'solo con el botón'}</span>
              </div>
            </article>
            <article className="tarjeta indicador">
              <span className="indicador-icono indicador-trigo"><Icono nombre="tabla" tamano={22} /></span>
              <div>
                <small>Datos limpios en Postgres</small>
                <strong>{formatear(datos?.intervalos, 0)}</strong>
                <span className="texto-suave">
                  {datos?.sensores ? `${datos.sensores} sensor(es) · ${fecha(datos.desde)} → ${fecha(datos.hasta)}` : 'todavía vacío'}
                </span>
              </div>
            </article>
            <article className="tarjeta indicador">
              <span className="indicador-icono indicador-tierra"><Icono nombre="basura" tamano={22} /></span>
              <div>
                <small>Lecturas descartadas</small>
                <strong>{formatear(Object.values(estado.descartes_por_regla).reduce((a, b) => a + b, 0), 0)}</strong>
                <span className="texto-suave">
                  {Object.entries(estado.descartes_por_regla).map(([r, n]) => `${r}: ${n}`).join(' · ') || 'ninguna'}
                </span>
              </div>
            </article>
          </div>

          <div className="seccion-cabecera">
            <h2>Reglas que se aplican</h2>
          </div>
          <div className="tarjeta tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Rango válido</th>
                  <th>Salto máximo entre vecinas</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(reglas.rangos).map(([variable, [min, max]]) => (
                  <tr key={variable}>
                    <td className="celda-id">{variable}</td>
                    <td>
                      {formatear(min)} a {formatear(max)}
                    </td>
                    <td>{reglas.salto_maximo[variable] !== undefined ? `± ${formatear(reglas.salto_maximo[variable])}` : 'no aplica (cambia de golpe)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="reglas">
            {Object.entries(reglas.descripcion).map(([regla, texto]) => (
              <li key={regla}>
                <code>{regla}</code> {texto}
              </li>
            ))}
          </ul>

          <div className="seccion-cabecera">
            <h2>Últimas ejecuciones</h2>
          </div>
          <div className="tarjeta tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Inicio</th>
                  <th>Origen</th>
                  <th>Revisadas</th>
                  <th>Válidas</th>
                  <th>Descartadas</th>
                  <th>Intervalos</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {estado.ejecuciones.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="tabla-vacia">Todavía no ha corrido ninguna limpieza.</td>
                  </tr>
                ) : (
                  estado.ejecuciones.map((e) => (
                    <tr key={e.inicio}>
                      <td>{fecha(e.inicio)}</td>
                      <td>{e.origen}</td>
                      <td>{e.leidas}</td>
                      <td>{e.validas}</td>
                      <td>{e.descartadas}</td>
                      <td>{e.intervalos}</td>
                      <td>
                        <span className={`estado ${e.error ? 'estado-failed' : 'estado-active'}`} title={e.error ?? ''}>
                          {e.error ? 'error' : 'ok'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
