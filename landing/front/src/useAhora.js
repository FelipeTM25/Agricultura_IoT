import { useEffect, useState } from 'react'

// Hora actual que se refresca sola, para los textos "hace 12 s"
export default function useAhora(cadaMs = 1000) {
  const [ahora, setAhora] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs)
    return () => clearInterval(id)
  }, [cadaMs])
  return ahora
}
