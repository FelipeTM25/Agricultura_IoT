import { useState } from 'react'
import { api, guardarArchivo } from '../api.js'
import Modal from '../componentes/Modal.jsx'

const INTERVALOS = [
  { valor: 0, texto: 'Cada lectura (sin agrupar)' },
  { valor: 5, texto: 'Promedio cada 5 min' },
  { valor: 15, texto: 'Promedio cada 15 min' },
  { valor: 60, texto: 'Promedio cada hora' },
  { valor: 1440, texto: 'Promedio por día' },
]

const NUMERICOS = ['Number', 'Float', 'Integer']

// <input type="datetime-local"> trabaja en hora local y sin zona: "2026-10-13T09:30"
const aLocal = (fecha) => new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

// Configuracion de la exportacion del historico de una entidad (CrateDB via QuantumLeap)
// `delHistorico`: atributos que ya tienen datos en CrateDB (pueden no estar hoy en Orion)
export default function FormExportar({ entidad, delHistorico = [], onCerrar, onExportado }) {
  const actuales = Object.entries(entidad)
    .filter(([nombre, a]) => nombre !== 'id' && nombre !== 'type' && NUMERICOS.includes(a?.type))
    .map(([nombre]) => nombre)
  const atributosNumericos = [...new Set([...actuales, ...delHistorico])].sort()

  const ahora = new Date()
  const [desde, setDesde] = useState(aLocal(new Date(ahora.getTime() - 24 * 3600 * 1000)))
  const [hasta, setHasta] = useState(aLocal(ahora))
  const [elegidos, setElegidos] = useState(atributosNumericos)
  const [intervalo, setIntervalo] = useState(0)
  const [formato, setFormato] = useState('csv')
  const [separador, setSeparador] = useState(';')
  const [error, setError] = useState('')
  const [exportando, setExportando] = useState(false)

  const alternar = (nombre) => setElegidos((ls) => (ls.includes(nombre) ? ls.filter((n) => n !== nombre) : [...ls, nombre]))

  const exportar = async (e) => {
    e.preventDefault()
    setError('')
    if (!desde || !hasta || new Date(hasta) <= new Date(desde)) return setError('La fecha final debe ser posterior a la inicial')
    if (elegidos.length === 0) return setError('Elige al menos un atributo')

    setExportando(true)
    try {
      const archivo = await api.exportar(entidad.id, {
        tipo: entidad.type,
        desde: new Date(desde).toISOString(),
        hasta: new Date(hasta).toISOString(),
        atributos: elegidos.join(','),
        intervalo_min: intervalo,
        formato,
        separador,
      })
      guardarArchivo(archivo)
      onExportado(`Descargado ${archivo.nombre}`)
    } catch (err) {
      setError(err.message)
      setExportando(false)
    }
  }

  return (
    <Modal titulo={`Exportar histórico de ${entidad.id}`} onCerrar={onCerrar}>
      <form onSubmit={exportar} className="formulario">
        <div className="fila-campos">
          <label className="campo">
            <span>Desde</span>
            <input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} required />
          </label>
          <label className="campo">
            <span>Hasta</span>
            <input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} required />
          </label>
        </div>

        <fieldset className="grupo">
          <legend>Atributos</legend>
          {atributosNumericos.length === 0 ? (
            <p className="texto-suave">Esta entidad no tiene atributos numéricos.</p>
          ) : (
            <div className="casillas">
              {atributosNumericos.map((nombre) => (
                <label className="casilla" key={nombre}>
                  <input type="checkbox" checked={elegidos.includes(nombre)} onChange={() => alternar(nombre)} />
                  {nombre}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="fila-campos">
          <label className="campo">
            <span>Agrupación</span>
            <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))}>
              {INTERVALOS.map((i) => (
                <option key={i.valor} value={i.valor}>
                  {i.texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Formato</span>
            <select value={formato} onChange={(e) => setFormato(e.target.value)}>
              <option value="csv">CSV (Excel, hojas de cálculo)</option>
              <option value="json">JSON (programas, APIs)</option>
            </select>
          </label>
        </div>

        {formato === 'csv' && (
          <label className="campo">
            <span>Separador del CSV</span>
            <select value={separador} onChange={(e) => setSeparador(e.target.value)}>
              <option value=";">Punto y coma, decimales con coma (Excel en español)</option>
              <option value=",">Coma, decimales con punto (estándar, Python, Google Sheets)</option>
            </select>
          </label>
        )}

        {error && <p className="aviso aviso-error">{error}</p>}

        <footer className="modal-pie">
          <button type="button" className="boton boton-suave" onClick={onCerrar}>
            Cancelar
          </button>
          <button className="boton boton-primario" disabled={exportando || atributosNumericos.length === 0}>
            {exportando ? 'Exportando…' : 'Descargar'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
