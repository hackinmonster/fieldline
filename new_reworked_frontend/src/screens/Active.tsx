import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUp, ArrowUpLeft, ArrowUpRight, CornerUpLeft, CornerUpRight, Flag, Check, MessageSquareText, TrafficCone, CircleSlash,
  ChevronUp, ChevronDown, Play, Pause, MapPin, LocateFixed, type LucideIcon,
} from 'lucide-react'
import { ARRIVE_RADIUS_M, useStore } from '../lib/store'
import MapCanvas from '../components/MapCanvas'
import ReportSheet from '../components/ReportSheet'
import { Alert, Button, Empty } from '../components/ui'
import { along, lineLength, meters, progressOn, type LonLat } from '../lib/geo'
import { arrival, miles, minutes } from '../lib/format'
import { checklist, SAFETY } from '../lib/taskinfo'
import { TASK_KIND } from '../lib/vocab'
import type { Step } from '../lib/types'

function turnIcon(s: Step | undefined): LucideIcon {
  if (!s || s.type === 'arrive') return Flag
  const m = s.modifier ?? ''
  if (m.includes('slight left')) return ArrowUpLeft
  if (m.includes('slight right')) return ArrowUpRight
  if (m.includes('left')) return CornerUpLeft
  if (m.includes('right')) return CornerUpRight
  return ArrowUp
}
function turnText(s: Step | undefined, dest: string) {
  if (!s || s.type === 'arrive') return `Arrive at ${dest}`
  const verb = s.type === 'turn' || s.type === 'end of road' ? `Turn ${s.modifier}` : s.type === 'new name' || s.type === 'continue' ? 'Continue' : s.modifier ? `Keep ${s.modifier}` : 'Continue'
  return s.name ? `${verb} onto ${s.name}` : verb
}

export default function Active() {
  const { snap, me, now, assignment, task, mode, demoDrive, driving, decline, complete } = useStore()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finishErr, setFinishErr] = useState<string | null>(null)
  const key = `fieldline.check.${task?.id}`
  const [done, setDone] = useState<number[]>(() => { try { return JSON.parse(sessionStorage.getItem(key) ?? '[]') } catch { return [] } })
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(done)) } catch { /* ignore */ } }, [done, key])

  const nav_ = useMemo(() => {
    if (!assignment?.route || !me || !task) return null
    const coords = assignment.route.coordinates as LonLat[]
    const total = lineLength(coords)
    const prog = progressOn(coords, [me.lon, me.lat])
    const remaining = Math.max(0, total - prog)
    const heading = along(coords, Math.min(total, prog + 30)).heading
    let next: Step | undefined, after: Step | undefined, toNext = remaining
    if (assignment.steps?.length) {
      let start = 0
      const starts = assignment.steps.map((s) => { const v = start; start += s.distance_m; return v })
      const i = starts.findIndex((v) => v > prog + 5)
      if (i >= 0) { next = assignment.steps[i]; after = assignment.steps[i + 1]; toNext = starts[i] - prog }
      else next = assignment.steps[assignment.steps.length - 1]
    }
    const eta = assignment.eta_s * (total ? remaining / total : 0)
    const toDest = meters([me.lon, me.lat], [task.lon, task.lat])
    return { remaining, heading, next, after, toNext, eta, arrived: toDest <= ARRIVE_RADIUS_M, toDest }
  }, [assignment, me, task])

  if (!snap) return null
  if (!assignment || assignment.status !== 'ACCEPTED' || !task) {
    return (
      <div className="active-empty">
        <Empty icon={MapPin} title="No active task" action={<Button variant="primary" onClick={() => nav('/map')}>Back to the map</Button>}>
          When you accept an offer, directions and the checklist appear here.
        </Empty>
      </div>
    )
  }

  const K = TASK_KIND[task.type]
  const items = checklist(task)
  const dest = task.address ?? 'destination'
  const NextIcon = nav_?.arrived ? Flag : turnIcon(nav_?.next)
  const reroute = /^rerouted/i.test(assignment.reason) ? assignment.reason : null

  return (
    <div className="active">
      <MapCanvas snap={snap} me={me} route={{ line: assignment.route!, kind: 'active' }} mineTaskId={task.id} selectedTaskId={task.id}
        filter={(t) => t.id === task.id}
        layers={{ tasks: true, closures: true, resources: false, gauges: false, volunteers: false, reports: false }}
        follow={nav_ ? { heading: nav_.heading } : null} padBottom={open ? 420 : 220} />

      <div className="maneuver" role="status" aria-live="polite">
        <span className="maneuver-icon"><NextIcon size={40} strokeWidth={2.5} aria-hidden /></span>
        <div className="grow">
          {nav_?.arrived ? (
            <><div className="maneuver-dist">Arrived</div><div className="maneuver-road">{dest}</div></>
          ) : (
            <>
              <div className="maneuver-dist num">{miles(nav_?.toNext ?? 0)}</div>
              <div className="maneuver-road">{turnText(nav_?.next, dest)}</div>
            </>
          )}
        </div>
      </div>
      {!nav_?.arrived && nav_?.after && <div className="maneuver-then">Then {turnText(nav_.after, dest).replace(/^Turn/, 'turn').replace(/^Continue/, 'continue').replace(/^Arrive/, 'arrive')}</div>}
      {reroute && !nav_?.arrived && (
        <div className="reroute"><TrafficCone size={16} aria-hidden /><span>{reroute}</span></div>
      )}

      {mode === 'demo' && (
        <button className="demo-drive" onClick={() => demoDrive(!driving)} disabled={nav_?.arrived && !driving}>
          {driving ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          {driving ? 'Pause drive' : nav_?.arrived ? 'At destination' : 'Demo: drive the route'}
        </button>
      )}

      <section className={`nav-panel${open ? ' is-open' : ''}`} aria-label="Task details">
        <button className="nav-panel-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="eta-big num">{nav_?.arrived ? 'Here' : minutes(nav_?.eta ?? 0)}</span>
          <span className="eta-sub num">
            {nav_?.arrived ? `${Math.round(nav_.toDest)} m from the address` : <>{miles(nav_?.remaining ?? 0)} · arrive {arrival(now, nav_?.eta ?? 0)}</>}
          </span>
          <span className="nav-panel-title">{K.label}: {task.title}</span>
          {open ? <ChevronDown size={22} aria-hidden /> : <ChevronUp size={22} aria-hidden />}
        </button>

        {open && (
          <div className="nav-panel-body">
            <div className="progress-line" aria-label={`${done.length} of ${items.length} steps done`}>
              <span style={{ width: `${(done.length / items.length) * 100}%` }} />
            </div>
            <ul className="checklist">
              {items.map((it, i) => (
                <li key={it}>
                  <label>
                    <input type="checkbox" checked={done.includes(i)} onChange={(e) => setDone(e.target.checked ? [...done, i] : done.filter((x) => x !== i))} />
                    <span className="check-box" aria-hidden><Check size={14} strokeWidth={3} /></span>
                    <span>{it}</span>
                  </label>
                </li>
              ))}
            </ul>
            <Alert tone="caution" title="Before you go in">{SAFETY[task.type][0]}</Alert>
            <div className="nav-actions">
              <Button icon={MessageSquareText} onClick={() => setReporting(true)}>Update dispatch</Button>
              <Button icon={TrafficCone} onClick={() => setReporting(true)}>Road blocked</Button>
              <Button icon={CircleSlash} variant="quiet" onClick={async () => { await decline(assignment.id); nav('/map') }}>Can’t finish</Button>
            </div>
          </div>
        )}

        <div className="nav-panel-foot">
          {finishErr && <Alert tone="caution" title="Not marked done yet">{finishErr}</Alert>}
          {!nav_?.arrived && <p className="hint center"><LocateFixed size={14} aria-hidden /> Unlocks within {ARRIVE_RADIUS_M} m of the address. Your location is the only check.</p>}
          <Button variant="primary" size="lg" block icon={Check} busy={finishing} disabled={!nav_?.arrived}
            onClick={async () => {
              setFinishing(true); setFinishErr(null)
              try { await complete(assignment.id, ''); nav('/done') }
              catch (e: any) { setFinishErr(String(e.message).replace(/^\d+:\s*/, '')) }
              finally { setFinishing(false) }
            }}>
            {finishing ? 'Checking your location…' : 'Yes, I did it'}
          </Button>
        </div>
      </section>

      {reporting && <ReportSheet onClose={() => setReporting(false)} />}
    </div>
  )
}
