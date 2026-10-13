import { useState } from 'react'
import { api } from '../api.js'
import Icono from '../componentes/Icono.jsx'
import Modal from '../componentes/Modal.jsx'
import {
  TIPO_SENSOR,
  TIPOS_ATRIBUTO,
  atributosDeFilas,
  filaVacia,
  filasDeEntidad,
  filasDePlantilla,
  nombreValido,
} from '../ngsi.js'

// Crea una entidad nueva (entidad = null) o edita los atributos de una existente.
export default function FormEntidad({ entidad, onCerrar, onGuardado }) {
  const editando = Boolean(entidad)
  const [id, setId] = useState(entidad?.id ?? '')
  const [tipo, setTipo] = useState(entidad?.type ?? TIPO_SENSOR)
  const [filas, setFilas] = useState(() => (editando ? filasDeEntidad(entidad) : filasDePlantilla()))
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [guardarHistorico, setGuardarHistorico] = useState(true)

  const cambiarFila = (clave, cambios) => setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)))
  const quitarFila = (clave) => setFilas((fs) => fs.filter((f) => f.clave !== clave))

  const guardar = async (e) => {
    e.preventDefault()
    setError('')
    try {
      if (!editando && !nombreValido(id.trim())) throw new Error('El id no puede estar vacío ni tener espacios o < > " \' = ; ( ) & ? / #')
      if (!editando && !nombreValido(tipo.trim())) throw new Error('El tipo no puede estar vacío ni tener espacios')
      const atributos = atributosDeFilas(filas)

      setGuardando(true)
      if (editando) {
        if (Object.keys(atributos).length) await api.guardarAtributos(entidad.id, atributos)
        // Los atributos que estaban en Orion y se quitaron del formulario se borran
        const quitados = filasDeEntidad(entidad).map((f) => f.nombre).filter((n) => !(n in atributos))
        for (const nombre of quitados) await api.borrarAtributo(entidad.id, nombre)
        onGuardado(`Sensor ${entidad.id} actualizado`)
      } else {
        const { suscripcion } = await api.crearEntidad({
          id: id.trim(),
          type: tipo.trim(),
          atributos,
          guardar_historico: guardarHistorico,
        })
        const historico = {
          creada: '. Se creó la suscripción a QuantumLeap: su histórico se guarda en CrateDB',
          existente: `. Su histórico ya se guarda con la suscripción existente del tipo ${tipo.trim()}`,
          error: `, pero no se pudo crear su suscripción: ${suscripcion?.detalle}`,
        }
        onGuardado(`Sensor ${id.trim()} creado${historico[suscripcion?.estado] ?? ''}`)
      }
    } catch (err) {
      setError(err.message)
      setGuardando(false)
    }
  }

  return (
    <Modal titulo={editando ? `Editar ${entidad.id}` : 'Nuevo sensor'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <div className="fila-campos">
          <label className="campo">
            <span>Id de la entidad</span>
            <input value={id} onChange={(e) => setId(e.target.value)} placeholder="sensor01" disabled={editando} autoFocus={!editando} />
          </label>
          <label className="campo">
            <span>Tipo</span>
            <input value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={editando} />
          </label>
        </div>

        <div className="atributos">
          <div className="atributos-cabecera">
            <h3>Atributos</h3>
            <button type="button" className="boton boton-suave" onClick={() => setFilas((fs) => [...fs, filaVacia()])}>
              <Icono nombre="mas" /> Agregar
            </button>
          </div>

          {filas.length === 0 && <p className="texto-suave">Sin atributos.</p>}

          {filas.map((fila) => (
            <div className="atributo" key={fila.clave}>
              <input
                className="atributo-nombre"
                value={fila.nombre}
                onChange={(e) => cambiarFila(fila.clave, { nombre: e.target.value })}
                placeholder="nombre"
                aria-label="Nombre del atributo"
              />
              <select
                value={fila.tipo}
                onChange={(e) => cambiarFila(fila.clave, { tipo: e.target.value })}
                aria-label="Tipo del atributo"
              >
                {[...new Set([...TIPOS_ATRIBUTO, fila.tipo])].map((t) => (
                  <option key={t} value={t}>
                    {t === 'geo:json' ? 'GPS (geo:json)' : t}
                  </option>
                ))}
              </select>

              {fila.tipo === 'geo:json' ? (
                <div className="atributo-gps">
                  <input value={fila.lat} onChange={(e) => cambiarFila(fila.clave, { lat: e.target.value })} placeholder="latitud" aria-label="Latitud" />
                  <input value={fila.lon} onChange={(e) => cambiarFila(fila.clave, { lon: e.target.value })} placeholder="longitud" aria-label="Longitud" />
                </div>
              ) : fila.tipo === 'Boolean' ? (
                <select value={fila.valor} onChange={(e) => cambiarFila(fila.clave, { valor: e.target.value })} aria-label="Valor">
                  <option value="">sin valor</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  value={fila.valor}
                  onChange={(e) => cambiarFila(fila.clave, { valor: e.target.value })}
                  placeholder={fila.pista ? `valor (${fila.pista})` : 'valor'}
                  aria-label="Valor"
                />
              )}

              <button type="button" className="boton-icono boton-peligro" onClick={() => quitarFila(fila.clave)} aria-label={`Quitar ${fila.nombre}`}>
                <Icono nombre="basura" />
              </button>
            </div>
          ))}
        </div>

        {!editando && (
          <label className="casilla">
            <input type="checkbox" checked={guardarHistorico} onChange={(e) => setGuardarHistorico(e.target.checked)} />
            Guardar su histórico en CrateDB (crea la suscripción a QuantumLeap si su tipo todavía no tiene una)
          </label>
        )}

        {error && <p className="aviso aviso-error">{error}</p>}

        <footer className="modal-pie">
          <button type="button" className="boton boton-suave" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="boton boton-primario" disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear sensor'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
