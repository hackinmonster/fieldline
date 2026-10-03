import { useState } from 'react'
import { BadgeCheck, Link2, MapPin } from 'lucide-react'
import type { Observation, Task } from '../lib/types'
import { SOURCE, isDone, postKind, type PostKind } from '../lib/vocab'
import { ago, miles } from '../lib/format'

type Props = {
  post: Observation
  now: Date | null
  distance_m?: number | null
  linkedTask?: Task | null
  onMap?: () => void
  onTask?: () => void
}

const KIND: Record<PostKind, { label: string; tone: string }> = {
  need: { label: 'Need', tone: 'danger' },
  road: { label: 'Road', tone: 'caution' },
  hazard: { label: 'Hazard', tone: 'caution' },
  info: { label: 'Update', tone: 'neutral' },
}

/** One report from the ground. The source line says who said it; official feeds are marked. */
export default function FeedPost({ post: o, now, distance_m, linkedTask, onMap, onTask }: Props) {
  const S = SOURCE[o.source_type] ?? SOURCE.resident
  const [open, setOpen] = useState(false)
  const kind = KIND[postKind(o)]
  const transcript = o.raw ?? o.text ?? null
  const body = o.summary ?? transcript ?? ''
  return (
    <article className={`post post-${o.source_type}`}>
      <header className="post-head">
        <span className={`post-avatar${S.official ? ' is-official' : ''}`} aria-hidden><S.icon size={18} /></span>
        <span className="post-who">
          <span className="post-name">
            {o.reporter ?? o.channel ?? S.label}
            {S.official && <BadgeCheck size={15} className="post-badge" aria-label="Official source" />}
          </span>
          <span className="post-src">{S.label}<span aria-hidden> · </span>{ago(o.observed_at, now)}</span>
        </span>
        {kind && <span className={`chip chip-${kind.tone}`}>{kind.label}</span>}
      </header>

      <p className="post-body">{body}</p>

      {transcript && o.source_type === 'radio' && (
        <div className="post-raw">
          <button className="linkish" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide transcript' : 'Radio transcript'}</button>
          {open && <blockquote className="mono">{transcript}</blockquote>}
        </div>
      )}

      {o.photo && <img className="post-photo" src={`/${o.photo}`} alt="Photo attached to this report" loading="lazy" />}

      <footer className="post-foot">
        {o.point && onMap && (
          <button className="post-action" onClick={onMap}>
            <MapPin size={16} aria-hidden />
            {distance_m != null ? <span className="num">{miles(distance_m)} away</span> : 'Show on map'}
          </button>
        )}
        {linkedTask && onTask && (
          <button className="post-action is-linked" onClick={onTask}>
            <Link2 size={16} aria-hidden />
            <span>Task #{linkedTask.id}{isDone(linkedTask) ? ' · done' : ''}</span>
          </button>
        )}
      </footer>
    </article>
  )
}
