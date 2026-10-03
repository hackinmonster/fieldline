import { useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  /** Visible heights in px, smallest first. */
  snaps: number[]
  index: number
  onIndex: (i: number) => void
  header?: ReactNode
  children: ReactNode
  label: string
}

/** Draggable sheet that snaps between heights. The handle is also a button, so keyboard users can expand it. */
export default function BottomSheet({ snaps, index, onIndex, header, children, label }: Props) {
  const max = snaps[snaps.length - 1]
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ y: number; h: number; t: number } | null>(null)
  const height = drag ?? snaps[Math.min(index, snaps.length - 1)]

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button:not(.sheet-handle), a, input, select, textarea')) return
    start.current = { y: e.clientY, h: snaps[index], t: performance.now() }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return
    const h = start.current.h - (e.clientY - start.current.y)
    setDrag(Math.max(snaps[0] - 24, Math.min(max + 16, h)))
  }
  const onUp = (e: React.PointerEvent) => {
    if (!start.current) return
    const dy = e.clientY - start.current.y
    const v = dy / Math.max(1, performance.now() - start.current.t) // px/ms, positive = down
    const h = start.current.h - dy
    start.current = null
    setDrag(null)
    if (Math.abs(dy) < 6) return
    let i = snaps.reduce((best, s, k) => (Math.abs(s - h) < Math.abs(snaps[best] - h) ? k : best), 0)
    if (v > 0.6) i = Math.max(0, snaps.findLastIndex((s) => s < h + 1))
    if (v < -0.6) i = Math.min(snaps.length - 1, Math.max(snaps.findIndex((s) => s > h - 1), 0))
    onIndex(i)
  }

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { if (index === 0) scroller.current?.scrollTo({ top: 0 }) }, [index])

  return (
    <section className={`sheet${drag != null ? ' is-dragging' : ''}`} style={{ height: max, transform: `translateY(${max - height}px)` }} aria-label={label}>
      <div className="sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <button className="sheet-handle" aria-label={index === snaps.length - 1 ? 'Collapse list' : 'Expand list'}
          aria-expanded={index > 0} onClick={() => onIndex(index === snaps.length - 1 ? 0 : index + 1)} />
        {header}
      </div>
      <div ref={scroller} className="sheet-body" style={{ overflowY: index === snaps.length - 1 ? 'auto' : 'hidden' }}>
        {children}
      </div>
    </section>
  )
}
