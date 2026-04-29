import { useEffect, useState } from 'react'

export function useDataFreshness(updatedAt: number, staleSeconds: number) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - updatedAt) / 1000))
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [updatedAt])

  const isStale = elapsed >= staleSeconds
  const label = updatedAt === 0 ? '' :
    elapsed < 60 ? `${elapsed}초 전 갱신` :
    `${Math.floor(elapsed / 60)}분 전 갱신`

  return { isStale, label, elapsed }
}
