import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { formatear } from '../variables.js'

// Grafica de una sola serie (una variable). Sin leyenda: el titulo de la tarjeta dice que es.
// El eje X va de `desde` a `hasta` aunque falten datos, y la linea se corta en los huecos
// para no inventar lecturas donde el sensor no envio nada.

const ALTO = 170
const MARGEN = { arriba: 12, derecha: 58, abajo: 24, izquierda: 42 }

function ticksLimpios(min, max, cantidad = 4) {
  if (min === max) {
    min -= 1
    max += 1
  }
  const pasoCrudo = (max - min) / cantidad
  const magnitud = 10 ** Math.floor(Math.log10(pasoCrudo))
  const normal = pasoCrudo / magnitud
  const paso = (normal <= 1 ? 1 : normal <= 2 ? 2 : normal <= 5 ? 5 : 10) * magnitud
  const ticks = []
  for (let v = Math.floor(min / paso) * paso; v <= Math.ceil(max / paso) * paso + paso / 2; v += paso) {
    ticks.push(Number(v.toFixed(10)))
  }
  return ticks
}

const textoTick = (v) => (Math.abs(v) >= 1000 ? `${Number((v / 1000).toFixed(1))}K` : String(Number(v.toFixed(2))))

function textoHora(ms, conDia) {
  const fecha = new Date(ms)
  return conDia
    ? fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
    : fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function GraficaLinea({ puntos, desde, hasta, intervaloMin, unidad, decimales, titulo }) {
  const contenedor = useRef(null)
  const [ancho, setAncho] = useState(0)
  const [activo, setActivo] = useState(null)

  useEffect(() => {
    const observador = new ResizeObserver(([e]) => setAncho(e.contentRect.width))
    observador.observe(contenedor.current)
    return () => observador.disconnect()
  }, [])

  const g = useMemo(() => {
    if (!ancho || puntos.length === 0) return null
    const datos = puntos.map((p) => ({ ms: new Date(p.t).getTime(), v: p.v }))
    const x0 = new Date(desde).getTime()
    const x1 = hasta
    const valores = datos.map((d) => d.v)
    const ticksY = ticksLimpios(Math.min(...valores), Math.max(...valores))
    const y0 = ticksY[0]
    const y1 = ticksY[ticksY.length - 1]
    const izq = MARGEN.izquierda
    const der = ancho - MARGEN.derecha
    const arriba = MARGEN.arriba
    const abajo = ALTO - MARGEN.abajo
    const x = (ms) => izq + ((ms - x0) / (x1 - x0)) * (der - izq)
    const y = (v) => abajo - ((v - y0) / (y1 - y0)) * (abajo - arriba)

    // Tramos continuos: se corta donde faltan mas de 3 intervalos seguidos
    const hueco = 3 * intervaloMin * 60 * 1000
    const tramos = []
    datos.forEach((d, i) => {
      if (i === 0 || d.ms - datos[i - 1].ms > hueco) tramos.push([])
      tramos[tramos.length - 1].push({ ...d, px: x(d.ms), py: y(d.v) })
    })

    const conDia = x1 - x0 > 36 * 3600 * 1000
    // En pantallas angostas caben menos etiquetas de hora sin encimarse
    const divisiones = ancho < 480 ? 2 : 3
    const ticksX = Array.from({ length: divisiones + 1 }, (_, k) => x0 + (k / divisiones) * (x1 - x0))
    return { datos, tramos, ticksY, ticksX, conDia, x, y, izq, der, arriba, abajo }
  }, [ancho, puntos, desde, hasta, intervaloMin])

  const plano = g?.tramos.flat() ?? []
  const ultimo = plano[plano.length - 1]

  const buscarCercano = (evento) => {
    const rect = evento.currentTarget.getBoundingClientRect()
    const px = evento.clientX - rect.left
    let mejor = 0
    plano.forEach((p, i) => {
      if (Math.abs(p.px - px) < Math.abs(plano[mejor].px - px)) mejor = i
    })
    setActivo(mejor)
  }

  const conTeclado = (e) => {
    if (e.key === 'ArrowLeft') setActivo((i) => Math.max(0, (i ?? plano.length) - 1))
    if (e.key === 'ArrowRight') setActivo((i) => Math.min(plano.length - 1, (i ?? -1) + 1))
  }

  const punto = activo !== null ? plano[activo] : null

  return (
    <div className="grafica" ref={contenedor}>
      {g && (
        <svg width={ancho} height={ALTO} role="img" aria-label={`${titulo}: ${plano.length} puntos, último ${formatear(ultimo?.v, decimales)} ${unidad}`}>
          {g.ticksY.map((v) => (
            <g key={v}>
              <line className="grafica-rejilla" x1={g.izq} x2={g.der} y1={g.y(v)} y2={g.y(v)} />
              <text className="grafica-eje" x={g.izq - 8} y={g.y(v)} dy="0.32em" textAnchor="end">
                {textoTick(v)}
              </text>
            </g>
          ))}
          {g.ticksX.map((ms, k, todos) => (
            <text key={ms} className="grafica-eje" x={g.x(ms)} y={ALTO - 6} textAnchor={k === 0 ? 'start' : k === todos.length - 1 ? 'end' : 'middle'}>
              {k === todos.length - 1 ? 'ahora' : textoHora(ms, g.conDia)}
            </text>
          ))}

          {g.tramos.map((tramo, k) => {
            const linea = tramo.map((p, i) => `${i ? 'L' : 'M'}${p.px},${p.py}`).join('')
            const area = `${linea}L${tramo[tramo.length - 1].px},${g.abajo}L${tramo[0].px},${g.abajo}Z`
            return tramo.length === 1 ? (
              <circle key={k} className="grafica-punto-suelto" cx={tramo[0].px} cy={tramo[0].py} r="3" />
            ) : (
              <g key={k}>
                <path className="grafica-area" d={area} />
                <path className="grafica-linea" d={linea} />
              </g>
            )
          })}

          {ultimo && (
            <>
              <circle className="grafica-fin" cx={ultimo.px} cy={ultimo.py} r="4" />
              <text className="grafica-valor-fin" x={ultimo.px + 9} y={ultimo.py} dy="0.32em">
                {formatear(ultimo.v, decimales)}
              </text>
            </>
          )}

          {punto && (
            <>
              <line className="grafica-cursor" x1={punto.px} x2={punto.px} y1={g.arriba} y2={g.abajo} />
              <circle className="grafica-fin" cx={punto.px} cy={punto.py} r="4" />
            </>
          )}

          {/* Zona de captura: todo el ancho del plano, para que el lector apunte a una hora y no a una linea de 2px */}
          <rect
            x={g.izq}
            y={g.arriba}
            width={g.der - g.izq}
            height={g.abajo - g.arriba}
            fill="transparent"
            tabIndex="0"
            onPointerMove={buscarCercano}
            onPointerLeave={() => setActivo(null)}
            onFocus={() => setActivo(plano.length - 1)}
            onBlur={() => setActivo(null)}
            onKeyDown={conTeclado}
            aria-label={`Recorrer ${titulo} con las flechas`}
          />
        </svg>
      )}

      {punto && (
        <div
          className="grafica-tooltip"
          style={{ left: punto.px, top: punto.py, transform: `translate(${punto.px > ancho * 0.65 ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}
        >
          <strong>
            {formatear(punto.v, decimales)} {unidad}
          </strong>
          <span>{new Date(punto.ms).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
    </div>
  )
}

export default memo(GraficaLinea)
