import { useState } from 'react'
import { api } from '../api.js'
import Modal from '../componentes/Modal.jsx'

// Variables que el servicio de alertas sabe evaluar (las del nodo LilyGO)
export const VARIABLES = [
  { clave: 'temperatura', texto: 'Temperatura (°C)' },
  { clave: 'humedad', texto: 'Humedad del aire (%)' },
  { clave: 'humedadSuelo', texto: 'Humedad del suelo (%)' },
  { clave: 'luz', texto: 'Luz (lux)' },
  { clave: 'radiacion', texto: 'Radiación (IR 0-1023)' },
]

// umbral: null para crear uno nuevo
export default function FormUmbral({ umbral, onCerrar, onGuardado }) {
  const [variable, setVariable] = useState(umbral?.variable ?? 'humedadSuelo')
  const [operador, setOperador] = useState(umbral?.operador ?? '<')
  const [valor, setValor] = useState(umbral ? String(umbral.valor) : '')
  const [titulo, setTitulo] = useState(umbral?.titulo ?? '')
  const [accion, setAccion] = useState(umbral?.accion ?? '')
  const [activo, setActivo] = useState(umbral?.activo ?? true)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async (e) => {
    e.preventDefault()
    setError('')
    const numero = Number(valor.replace(',', '.'))
    if (valor.trim() === '' || Number.isNaN(numero)) return setError('El límite debe ser un número')

    const cuerpo = { variable, operador, valor: numero, titulo: titulo.trim(), accion: accion.trim(), activo }
    setGuardando(true)
    try {
      if (umbral) await api.editarUmbral(umbral.id, cuerpo)
      else await api.crearUmbral(cuerpo)
      onGuardado(umbral ? 'Umbral actualizado' : 'Umbral creado')
    } catch (err) {
      setError(err.message)
      setGuardando(false)
    }
  }

  return (
    <Modal titulo={umbral ? 'Editar umbral' : 'Nuevo umbral'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <fieldset className="grupo">
          <legend>Condición</legend>
          <div className="fila-campos fila-umbral">
            <label className="campo">
              <span>Variable</span>
              <select value={variable} onChange={(e) => setVariable(e.target.value)}>
                {VARIABLES.map((v) => (
                  <option key={v.clave} value={v.clave}>
                    {v.texto}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Cuando sea</span>
              <select value={operador} onChange={(e) => setOperador(e.target.value)}>
                <option value=">">mayor que</option>
                <option value="<">menor que</option>
              </select>
            </label>
            <label className="campo">
              <span>Límite</span>
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="30" required />
            </label>
          </div>
        </fieldset>

        <label className="campo">
          <span>Título de la alerta</span>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Suelo seco" maxLength={80} required autoFocus />
        </label>
        <label className="campo">
          <span>Acción recomendada</span>
          <input value={accion} onChange={(e) => setAccion(e.target.value)} placeholder="Regar" maxLength={200} />
          <small>Va en el correo de la alerta y en la landing.</small>
        </label>
        <label className="casilla">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Activo (si se desactiva, se cierran sus alertas abiertas)
        </label>

        {error && <p className="aviso aviso-error">{error}</p>}
        <div className="modal-pie">
          <button type="button" className="boton boton-suave" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="boton boton-primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
