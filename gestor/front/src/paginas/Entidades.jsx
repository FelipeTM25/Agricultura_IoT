import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import Icono from '../componentes/Icono.jsx'
import { ICONO_VARIABLE, atributosDe, valorLegible } from '../ngsi.js'
import FormEntidad from './FormEntidad.jsx'

export default function Entidades() {
  const [entidades, setEntidades] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [busqueda, setBusqueda] = useState('')
  // null = formulario cerrado, 'nueva' = crear, o la entidad que se edita
  const [formulario, setFormulario] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      setEntidades(await api.entidades())
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const borrar = async (entidad) => {
    if (!window.confirm(`¿Borrar el sensor ${entidad.id}? Se elimina de Orion (el histórico en CrateDB se conserva).`)) return
    setAviso('')
    try {
      await api.borrarEntidad(entidad.id)
      setAviso(`Sensor ${entidad.id} borrado`)
      cargar()
    } catch (err) {
      setError(err.message)
    }
  }

  const alGuardar = (mensaje) => {
    setFormulario(null)
    setAviso(mensaje)
    cargar()
  }

  const texto = busqueda.trim().toLowerCase()
  const visibles = entidades.filter((e) => !texto || e.id.toLowerCase().includes(texto) || e.type.toLowerCase().includes(texto))

  return (
    <section className="pagina">
      <div className="acciones">
        <input
          className="buscador"
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por id o tipo…"
          aria-label="Buscar sensores"
        />
        <button className="boton boton-suave" onClick={cargar} disabled={cargando}>
          <Icono nombre="recargar" /> Actualizar
        </button>
        <button className="boton boton-primario" onClick={() => setFormulario('nueva')}>
          <Icono nombre="mas" /> Nuevo sensor
        </button>
      </div>

      {aviso && <p className="aviso aviso-ok">{aviso}</p>}
      {error && <p className="aviso aviso-error">{error}</p>}

      <div className="tarjeta tabla-contenedor">
        <table className="tabla">
          <thead>
            <tr>
              <th>Id</th>
              <th>Tipo</th>
              <th>Valores actuales</th>
              <th className="columna-acciones">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando && entidades.length === 0 ? (
              <tr>
                <td colSpan="4" className="tabla-vacia">Cargando…</td>
              </tr>
            ) : visibles.length === 0 ? (
              <tr>
                <td colSpan="4" className="tabla-vacia">
                  {entidades.length === 0 ? 'Todavía no hay sensores en Orion. Crea el primero con "Nuevo sensor".' : 'Ningún sensor coincide con la búsqueda.'}
                </td>
              </tr>
            ) : (
              visibles.map((entidad) => (
                <tr key={entidad.id}>
                  <td className="celda-id">{entidad.id}</td>
                  <td>
                    <span className="etiqueta">{entidad.type}</span>
                  </td>
                  <td>
                    <div className="chips">
                      {atributosDe(entidad).map(([nombre, atributo]) => (
                        <span className="chip" key={nombre} title={`${nombre} (${atributo.type})`}>
                          <Icono nombre={ICONO_VARIABLE[nombre] ?? 'dato'} tamano={14} />
                          <span className="chip-nombre">{nombre}</span>
                          {valorLegible(atributo)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="columna-acciones">
                    <button className="boton-icono" onClick={() => setFormulario(entidad)} aria-label={`Editar ${entidad.id}`} title="Editar">
                      <Icono nombre="lapiz" />
                    </button>
                    <button className="boton-icono boton-peligro" onClick={() => borrar(entidad)} aria-label={`Borrar ${entidad.id}`} title="Borrar">
                      <Icono nombre="basura" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {formulario && (
        <FormEntidad
          entidad={formulario === 'nueva' ? null : formulario}
          onCerrar={() => setFormulario(null)}
          onGuardado={alGuardar}
        />
      )}
    </section>
  )
}
