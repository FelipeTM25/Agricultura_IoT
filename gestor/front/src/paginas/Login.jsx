import { useState } from 'react'
import { api, sesion } from '../api.js'
import Icono from '../componentes/Icono.jsx'

export default function Login({ onEntrar }) {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const entrar = async (e) => {
    e.preventDefault()
    setError('')
    setEnviando(true)
    try {
      const { token, usuario: nombre } = await api.login(usuario, password)
      sesion.guardar(token, nombre)
      onEntrar(nombre)
    } catch (err) {
      setError(err.message)
      setEnviando(false)
    }
  }

  return (
    <div className="login">
      <section className="login-portada">
        <div className="marca marca-grande">
          <span className="marca-logo">
            <Icono nombre="hoja" tamano={28} />
          </span>
          <div>
            <strong>Agricultura IoT</strong>
            <small>Plataforma FIWARE · UPB</small>
          </div>
        </div>
        <div className="login-lema">
          <h2>Administra los sensores de tu cultivo</h2>
          <p>Crea entidades en Orion, actualiza sus lecturas y conecta sus cambios con el histórico en CrateDB.</p>
        </div>
        <ul className="login-variables">
          <li><Icono nombre="termometro" /> Temperatura</li>
          <li><Icono nombre="gota" /> Humedad</li>
          <li><Icono nombre="sol" /> Luz</li>
          <li><Icono nombre="rayo" /> Radiación</li>
          <li><Icono nombre="pin" /> GPS</li>
        </ul>
      </section>

      <section className="login-formulario">
        <form onSubmit={entrar} className="tarjeta">
          <h1>Iniciar sesión</h1>
          <p className="texto-suave">Ingresa con la cuenta de administrador.</p>

          <label className="campo">
            <span>Usuario</span>
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label className="campo">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className="aviso aviso-error">{error}</p>}

          <button className="boton boton-primario boton-ancho" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </div>
  )
}
