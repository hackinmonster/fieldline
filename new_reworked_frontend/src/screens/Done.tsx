import { useNavigate } from 'react-router-dom'
import { Check, Map as MapIcon, MapPin } from 'lucide-react'
import { ARRIVE_RADIUS_M, useStore } from '../lib/store'
import { Button, Empty } from '../components/ui'
import { dayTime } from '../lib/format'
import { TASK_KIND } from '../lib/vocab'
import { rank } from '../lib/match'

/** The receipt: what was marked done, where and when, and what is next nearby. */
export default function Done() {
  const { lastCompletion, history, me, snap, declinedIds } = useStore()
  const nav = useNavigate()
  const c = lastCompletion ?? (history[0] ? { task: history[0].task, at: new Date(history[0].assignment.updated_at), distance_m: null, note: '' } : null)
  if (!c) return <div className="done"><Empty icon={MapPin} title="No completed tasks yet" action={<Button onClick={() => nav('/map')}>Find a task</Button>}>Your finished work shows up here.</Empty></div>

  const K = TASK_KIND[c.task.type]
  const next = rank(me, snap?.tasks ?? [], declinedIds).filter((r) => r.fits && !r.declined).length

  return (
    <div className="done">
      <div className="done-mark" aria-hidden><Check size={44} strokeWidth={3} /></div>
      <h1 className="display-l center">Done. Thank you.</h1>
      <p className="lede center">Dispatch marked the request complete{c.task.incident_id ? ' and closed it out for the people who asked' : ''}.</p>

      <div className="receipt" aria-label="Completion receipt">
        <div className="receipt-row"><span>Task</span><b>{K.label} #{c.task.id}</b></div>
        <div className="receipt-row"><span>For</span><b>{c.task.address ?? c.task.title}</b></div>
        <div className="receipt-row"><span>Completed</span><b className="num">{dayTime(c.at)}</b></div>
        {c.distance_m != null && <div className="receipt-row"><span>Location</span><b className="num">{c.distance_m} m from address (limit {ARRIVE_RADIUS_M}) <Check size={14} aria-hidden /></b></div>}
        {c.note && <div className="receipt-row"><span>Note</span><b>{c.note}</b></div>}
      </div>

      <div className="done-foot">
        <Button variant="primary" size="lg" block icon={MapIcon} onClick={() => nav('/map')}>Back to the map</Button>
        <p className="hint center">{next ? `${next} more request${next > 1 ? 's' : ''} nearby fit what you can bring.` : 'Nothing else fits right now. We will alert you when something does.'}</p>
      </div>
    </div>
  )
}
