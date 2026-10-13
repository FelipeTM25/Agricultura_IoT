import L from 'leaflet'
import { useEffect, useRef } from 'react'

// Mapa con un punto por sensor. Se usan circleMarker en vez del icono por defecto de
// Leaflet, que necesita imagenes que el empaquetador no copia.
export default function Mapa({ sensores }) {
  const nodo = useRef(null)
  const mapa = useRef(null)
  const capa = useRef(null)
  const centrado = useRef(false)

  useEffect(() => {
    mapa.current = L.map(nodo.current, { scrollWheelZoom: false, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; colaboradores de OpenStreetMap',
    }).addTo(mapa.current)
    capa.current = L.layerGroup().addTo(mapa.current)
    return () => {
      mapa.current.remove()
      centrado.current = false
    }
  }, [])

  useEffect(() => {
    capa.current.clearLayers()
    const puntos = sensores.map((s) => [s.ubicacion.lat, s.ubicacion.lon])
    sensores.forEach((s, i) => {
      L.circleMarker(puntos[i], { radius: 9, color: '#fffdf8', weight: 3, fillColor: '#2e8540', fillOpacity: 1 })
        .bindTooltip(s.id, { permanent: true, direction: 'top', offset: [0, -10], className: 'mapa-etiqueta' })
        .addTo(capa.current)
    })
    // Se centra solo la primera vez, para no deshacer lo que el usuario movio en cada refresco
    if (puntos.length && !centrado.current) {
      mapa.current.setView(puntos[0], 16)
      centrado.current = true
    }
  }, [sensores])

  return <div className="mapa" ref={nodo} role="region" aria-label="Mapa con la ubicación de los sensores" />
}
