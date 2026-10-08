import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Modal from '../componentes/Modal.jsx'
import { TIPO_SENSOR, nombreValido } from '../ngsi.js'

const URL_QUANTUMLEAP = 'http://quantumleap:8668/v2/notify'

const lista = (texto) =>
  texto
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

export default function FormSuscripcion({ onCerrar, onGuardado }) {
  const [descripcion, setDescripcion] = useState('')
  const [tipoEntidad, setTipoEntidad] = useState(TIPO_SENSOR)
  const [patronId, setPatronId] = useState('.*')
  const [condicion, setCondicion] = useState('')
  const [destino, setDestino] = useState('quantumleap')
  const [urlPropia, setUrlPropia] = useState('')
  const [atributosNotificar, setAtributosNotificar] = useState('')
  const [metadata, setMetadata] = useState(true)
  const [tiposExistentes, setTiposExistentes] = useState([])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Sugerencias para el campo "tipo" con los tipos que ya hay en Orion
  useEffect(() => {
    api
      .entidades()
      .then((es) => setTiposExistentes([...new Set(es.map((e) => e.type))]))
      .catch(() => {})
  }, [])

  const guardar = async (e) => {
    e.preventDefault()
    setError('')
    const url = destino === 'quantumleap' ? URL_QUANTUMLEAP : urlPropia.trim()
    if (!nombreValido(tipoEntidad.trim())) return setError('Escribe un tipo de entidad válido (sin espacios)')
    if (!/^https?:\/\/.+/.test(url)) return setError('La URL de notificación debe empezar con http:// o https://')

    setGuardando(true)
    try {
      const { id } = await api.crearSuscripcion({
        descripcion: descripcion.trim(),
        tipo_entidad: tipoEntidad.trim(),
        patron_id: patronId.trim() || '.*',
        atributos_condicion: lista(condicion),
        url_notificacion: url,
        atributos_notificacion: lista(atributosNotificar),
        incluir_metadata: metadata,
      })
      onGuardado(`Suscripción ${id} creada`)
    } catch (err) {
      setError(err.message)
      setGuardando(false)
    }
  }

  return (
    <Modal titulo="Nueva suscripción" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <label className="campo">
          <span>Descripción</span>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Histórico de los sensores agrícolas" autoFocus />
        </label>

        <fieldset className="grupo">
          <legend>¿Qué entidades vigila?</legend>
          <div className="fila-campos">
            <label className="campo">
              <span>Tipo de entidad</span>
              <input value={tipoEntidad} onChange={(e) => setTipoEntidad(e.target.value)} list="tipos-existentes" required />
              <datalist id="tipos-existentes">
                {tiposExistentes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="campo">
              <span>Patrón de id</span>
              <input value={patronId} onChange={(e) => setPatronId(e.target.value)} placeholder=".*" />
              <small>Expresión regular. <code>.*</code> = todos los sensores de ese tipo.</small>
            </label>
          </div>
          <label className="campo">
            <span>Atributos que disparan la notificación</span>
            <input value={condicion} onChange={(e) => setCondicion(e.target.value)} placeholder="temperatura, humedad" />
            <small>Separados por coma. Vacío = cuando cambie cualquier atributo.</small>
          </label>
        </fieldset>

        <fieldset className="grupo">
          <legend>¿A dónde notifica?</legend>
          <div className="opciones">
            <label className="opcion">
              <input type="radio" name="destino" checked={destino === 'quantumleap'} onChange={() => setDestino('quantumleap')} />
              <span>
                <strong>QuantumLeap</strong>
                <small>Guarda el histórico en CrateDB ({URL_QUANTUMLEAP})</small>
              </span>
            </label>
            <label className="opcion">
              <input type="radio" name="destino" checked={destino === 'propia'} onChange={() => setDestino('propia')} />
              <span>
                <strong>Otra URL</strong>
                <small>Cualquier servicio que reciba notificaciones NGSI-v2</small>
              </span>
            </label>
          </div>
          {destino === 'propia' && (
            <label className="campo">
              <span>URL</span>
              <input value={urlPropia} onChange={(e) => setUrlPropia(e.target.value)} placeholder="http://mi-servicio:8080/notify" />
            </label>
          )}
          <label className="campo">
            <span>Atributos que se envían</span>
            <input value={atributosNotificar} onChange={(e) => setAtributosNotificar(e.target.value)} placeholder="temperatura, humedad, luz" />
            <small>Separados por coma. Vacío = todos los atributos de la entidad.</small>
          </label>
          <label className="casilla">
            <input type="checkbox" checked={metadata} onChange={(e) => setMetadata(e.target.checked)} />
            Incluir fecha de creación y modificación (QuantumLeap la usa como hora de la lectura)
          </label>
        </fieldset>

        {error && <p className="aviso aviso-error">{error}</p>}

        <footer className="modal-pie">
          <button type="button" className="boton boton-suave" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="boton boton-primario" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear suscripción'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
