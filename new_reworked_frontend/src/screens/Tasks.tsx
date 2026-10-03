import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ClipboardList, Navigation, X } from 'lucide-react'
import { useStore } from '../lib/store'
import TaskCard from '../components/TaskCard'
import { Button, Empty, ScreenHeader, Toggle } from '../components/ui'
import { ledger, rank, vehicleName } from '../lib/match'
import { meters } from '../lib/geo'
import { miles, minutes } from '../lib/format'
import type { Task } from '../lib/types'

export default function Tasks() {
  const { snap, me, assignment, task, setAvailable, declinedIds } = useStore()
  const nav = useNavigate()
  const ranked = useMemo(() => rank(me, snap?.tasks ?? [], declinedIds).filter((r) => r.task.id !== task?.id), [me, snap, task, declinedIds])
  const fits = ranked.filter((r) => r.fits && !r.declined)
  const notYet = ranked.filter((r) => !r.fits && !r.declined)
  const declined = ranked.filter((r) => r.declined)

  return (
    <div className="tasks">
      <ScreenHeader title="Matched for you" sub={me ? capabilityLine(me) : undefined} />

      <div className="tasks-body">
        {me && (
          <div className="avail">
            <Toggle checked={me.available} onChange={(v) => setAvailable(v)}
              label={me.available ? 'Available for offers' : 'Not taking offers'}
              sub={me.available ? 'Dispatch can offer you requests that fit.' : 'You will not get offers until you switch this on.'} />
          </div>
        )}

        {assignment && task && (
          <section>
            <h2 className="section-title">{assignment.status === 'ACCEPTED' ? 'In progress' : 'Waiting for your answer'}</h2>
            <button className="offer-card" onClick={() => nav(assignment.status === 'ACCEPTED' ? '/active' : `/task/${task.id}`)}>
              <span className="offer-card-top">
                <Navigation size={16} aria-hidden />
                <span>{assignment.status === 'ACCEPTED' ? 'You accepted this task' : 'Offered to you by dispatch'}</span>
              </span>
              <span className="offer-card-title">{task.title}</span>
              <span className="offer-card-meta num">
                <span><b>{minutes(assignment.eta_s)}</b> drive</span>
                {me && <span><b>{miles(meters([me.lon, me.lat], [task.lon, task.lat]))}</b> away</span>}
              </span>
              <span className="offer-card-cta">{assignment.status === 'ACCEPTED' ? 'Resume' : 'Review and answer'} <ArrowRight size={18} aria-hidden /></span>
            </button>
          </section>
        )}

        <section>
          <div className="section-row">
            <h2 className="section-title">Fits what you can bring <span className="num">· {fits.length}</span></h2>
          </div>
          {fits.length === 0 && (
            <Empty icon={ClipboardList} title="Nothing fits right now" action={<Button onClick={() => nav('/profile')}>Edit what you can bring</Button>}>
              None of the open requests match your vehicle, skills and equipment. Requests below say what is missing.
            </Empty>
          )}
          <div className="card-list">
            {fits.map((r) => (
              <div key={r.task.id} className="match-item">
                <TaskCard task={r.task} distance_m={r.distance_m} fits onClick={() => nav(`/task/${r.task.id}`)} />
                {me && <Factors task={r.task} distance_m={r.distance_m} />}
              </div>
            ))}
          </div>
        </section>

        {notYet.length > 0 && (
          <section>
            <h2 className="section-title">Needs something you have not listed <span className="num">· {notYet.length}</span></h2>
            <div className="card-list">
              {notYet.map((r) => (
                <TaskCard key={r.task.id} task={r.task} distance_m={r.distance_m} fits={false}
                  gaps={me ? ledger(me, r.task).filter((l) => !l.ok).map((l) => `Needs ${l.label.toLowerCase()}`) : undefined}
                  onClick={() => nav(`/task/${r.task.id}`)} />
              ))}
            </div>
          </section>
        )}

        {declined.length > 0 && (
          <section>
            <h2 className="section-title">You declined <span className="num">· {declined.length}</span></h2>
            <p className="hint section-hint">Still open. Changed your mind? Open one and take it.</p>
            <div className="card-list">
              {declined.map((r) => (
                <TaskCard key={r.task.id} task={r.task} distance_m={r.distance_m} declined onClick={() => nav(`/task/${r.task.id}`)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function capabilityLine(v: NonNullable<ReturnType<typeof useStore>['me']>) {
  const parts = [v.vehicle ? `${vehicleName(v.vehicle.type)}, ${v.vehicle.capacity_gal ?? 0} gal` : 'No vehicle']
  if (v.skills.length) parts.push(`${v.skills.length} skill${v.skills.length > 1 ? 's' : ''}`)
  if (v.equipment.length) parts.push(`${v.equipment.length} equipment`)
  return parts.join(' · ')
}

/** The things the matcher weighs, as a compact row under each recommended card. Only shown for tasks that fit, so the hard filters pass. */
function Factors({ task: t, distance_m }: { task: Task; distance_m: number }) {
  const req = t.requirements ?? {}
  const f = [
    { label: 'Distance', ok: distance_m < 16000, value: miles(distance_m) },
    { label: 'Vehicle', ok: true, value: req.vehicle ? 'yours' : 'none' },
    { label: 'Skills', ok: true, value: (req.skills ?? []).length ? 'yours' : 'none' },
    { label: 'Gear', ok: true, value: (req.equipment ?? []).length ? 'yours' : 'none' },
    { label: 'Urgency', ok: true, value: t.urgency >= 0.75 ? 'urgent' : t.urgency >= 0.5 ? 'today' : 'when able' },
  ]
  return (
    <ul className="factors" aria-label="Why this fits">
      {f.map((x) => (
        <li key={x.label} className={x.ok ? 'ok' : 'no'}>
          {x.ok ? <Check size={12} strokeWidth={3} aria-hidden /> : <X size={12} strokeWidth={3} aria-hidden />}
          <span className="factor-label">{x.label}</span>
          <span className="factor-value num">{x.value}</span>
        </li>
      ))}
    </ul>
  )
}
