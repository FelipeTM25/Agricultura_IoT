import { useEffect, useState } from 'react'
import { sesion } from './api.js'
import Icono from './componentes/Icono.jsx'
import Sidebar from './componentes/Sidebar.jsx'
import Entidades from './paginas/Entidades.jsx'
import Historico from './paginas/Historico.jsx'
import Login from './paginas/Login.jsx'
import Resumen from './paginas/Resumen.jsx'
import Suscripciones from './paginas/Suscripciones.jsx'

// Opciones del sidebar. La pagina actual se guarda en la URL (#entidades) para que sobreviva a un F5.
// Algunas paginas llevan un parametro despues de una barra: #historico/sensor01
const PAGINAS = {
  resumen: { titulo: 'Resumen', icono: 'panel', componente: Resumen },
  entidades: { titulo: 'Sensores', icono: 'sensor', componente: Entidades },
  historico: { titulo: 'Histórico', icono: 'grafica', componente: Historico },
  suscripciones: { titulo: 'Suscripciones', icono: 'campana', componente: Suscripciones },
}

const paginaDeLaUrl = () => {
  const clave = window.location.hash.slice(1).split('/')[0]
  return clave in PAGINAS ? clave : 'resumen'
}

export default function App() {
  const [usuario, setUsuario] = useState(sesion.token ? sesion.usuario : null)
  const [pagina, setPagina] = useState(paginaDeLaUrl)
  const [menuAbierto, setMenuAbierto] = useState(false)

  useEffect(() => {
    const alExpirar = () => setUsuario(null)
    const alCambiarHash = () => setPagina(paginaDeLaUrl())
    window.addEventListener('sesion-expirada', alExpirar)
    window.addEventListener('hashchange', alCambiarHash)
    return () => {
      window.removeEventListener('sesion-expirada', alExpirar)
      window.removeEventListener('hashchange', alCambiarHash)
    }
  }, [])

  if (!usuario) return <Login onEntrar={setUsuario} />

  const salir = () => {
    sesion.cerrar()
    setUsuario(null)
  }
  const { titulo, componente: Pagina } = PAGINAS[pagina]

  return (
    <div className="app">
      <Sidebar
        paginas={PAGINAS}
        actual={pagina}
        usuario={usuario}
        abierto={menuAbierto}
        onNavegar={() => setMenuAbierto(false)}
        onSalir={salir}
      />
      {menuAbierto && <div className="sidebar-fondo" onClick={() => setMenuAbierto(false)} />}

      <main className="contenido">
        <header className="barra-superior">
          <button className="boton-icono boton-menu" onClick={() => setMenuAbierto(true)} aria-label="Abrir menu">
            <Icono nombre="menu" />
          </button>
          <h1>{titulo}</h1>
        </header>
        <Pagina />
      </main>
    </div>
  )
}
