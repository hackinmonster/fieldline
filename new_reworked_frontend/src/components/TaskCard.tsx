import { Check, ChevronRight, Navigation, X } from 'lucide-react'
import type { Task } from '../lib/types'
import { TASK_KIND, TASK_STATUS_LABEL, isDone } from '../lib/vocab'
import { miles } from '../lib/format'
import { UrgencyChip } from './ui'

type Props = {
  task: Task
  distance_m?: number
  fits?: boolean
  gaps?: string[]
  selected?: boolean
  mine?: boolean
  variant?: 'row' | 'feature'
  onClick?: () => void
}

/** One request. `row` lives in lists and the map sheet; `feature` leads the sheet when a task is selected. */
export default function TaskCard({ task: t, distance_m, fits, gaps, selected, mine, variant = 'row', onClick }: Props) {
  const K = TASK_KIND[t.type]
  return (
    <button type="button" onClick={onClick}
      className={`task-card task-${variant}${selected ? ' is-selected' : ''}${mine ? ' is-mine' : ''}${isDone(t) ? ' is-done' : ''}`}>
      <span className={`task-glyph u-${t.urgency >= 0.75 ? 'urgent' : t.urgency >= 0.5 ? 'soon' : 'routine'}`} aria-hidden>
        <K.icon size={20} strokeWidth={2.25} />
      </span>
      <span className="task-main">
        <span className="task-meta">
          <span className="task-kind">{K.label}</span>
          {distance_m != null && <><span aria-hidden>·</span><span className="num">{miles(distance_m)}</span></>}
        </span>
        <span className="task-title">{t.title}</span>
        <span className="task-foot">
          {isDone(t)
            ? <span className="fit fit-done"><Check size={14} strokeWidth={3} aria-hidden />Done</span>
            : <UrgencyChip urgency={t.urgency} />}
          {mine && <span className="fit fit-mine"><Navigation size={13} strokeWidth={2.5} aria-hidden />Offered to you</span>}
          {!mine && fits === true && !isDone(t) && <span className="fit fit-yes"><Check size={14} strokeWidth={3} aria-hidden />You qualify</span>}
          {!mine && fits === false && <span className="fit fit-no"><X size={14} strokeWidth={3} aria-hidden />{gaps?.[0] ?? 'Missing requirement'}</span>}
          {t.status !== 'OPEN' && !isDone(t) && !mine && <span className="task-status">{TASK_STATUS_LABEL[t.status]}</span>}
        </span>
      </span>
      {variant === 'row' && <ChevronRight size={18} className="task-chev" aria-hidden />}
    </button>
  )
}
