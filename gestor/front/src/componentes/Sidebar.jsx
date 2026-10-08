import Icono from './Icono.jsx'

export default function Sidebar({ paginas, actual, usuario, abierto, onNavegar, onSalir }) {
  return (
    <aside className={`sidebar ${abierto ? 'abierto' : ''}`}>
      <div className="marca">
        <span className="marca-logo">
          <Icono nombre="hoja" tamano={22} />
        </span>
        <div>
          <strong>Agricultura IoT</strong>
          <small>Gestor de Orion</small>
        </div>
      </div>

      <nav className="menu">
        {Object.entries(paginas).map(([clave, pagina]) => (
          <a
            key={clave}
            href={`#${clave}`}
            className={clave === actual ? 'activo' : ''}
            onClick={onNavegar}
          >
            <Icono nombre={pagina.icono} />
            {pagina.titulo}
          </a>
        ))}
      </nav>

      <div className="sidebar-pie">
        <div className="usuario">
          <span className="avatar">{usuario.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{usuario}</strong>
            <small>Administrador</small>
          </div>
        </div>
        <button className="boton-salir" onClick={onSalir}>
          <Icono nombre="salir" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
