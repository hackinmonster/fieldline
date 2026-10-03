import { useNavigate } from 'react-router-dom'
import { Flashlight, Camera, Navigation } from 'lucide-react'
import { useStore } from '../lib/store'
import MapCanvas from '../components/MapCanvas'
import { rank } from '../lib/match'
import { meters } from '../lib/geo'
import { miles, minutes } from '../lib/format'

/** Concept: the offer as it lands on a locked phone. Uses the real offer when there is one. */
export default function Lock() {
  const { snap, me, assignment, task, now, declinedIds } = useStore()
  const nav = useNavigate()
  const t = (assignment?.status === 'OFFERED' && task) || rank(me, snap?.tasks ?? [], declinedIds).find((r) => r.fits && !r.declined)?.task || null
  const eta = assignment?.status === 'OFFERED' && task ? assignment.eta_s : null
  const d = t && me ? meters([me.lon, me.lat], [t.lon, t.lat]) : null
  const time = now?.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')
  const date = now?.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="lock">
      <div className="lock-bg" aria-hidden>
        {snap && <MapCanvas snap={snap} me={me} interactive={false} initial={{ center: me ? [me.lon, me.lat] : [-82.45, 35.61], zoom: 11.2 }}
          layers={{ tasks: false, closures: true, flood: true, resources: false, gauges: false, volunteers: false, reports: false }} />}
      </div>
      <div className="lock-top">
        <div className="lock-date">{date}</div>
        <div className="lock-time num">{time}</div>
      </div>

      {t ? (
        <button className="lock-note" onClick={() => nav(`/task/${t.id}`)}>
          <span className="lock-note-head">
            <img src="/mark.svg" alt="" width={20} height={20} />
            <span>FIELDLINE</span>
            <span className="lock-note-when">now</span>
          </span>
          <span className="lock-note-title">You are needed nearby</span>
          <span className="lock-note-body">{t.title}{t.address ? `, ${t.address}` : ''}.</span>
          <span className="lock-note-meta num">
            <Navigation size={13} strokeWidth={2.5} aria-hidden />
            {eta != null ? `${minutes(eta)} drive` : d != null ? `${miles(d)} away` : ''} · matched to your {me?.vehicle ? 'truck and skills' : 'skills'}
          </span>
          <span className="lock-note-hint">Press to review and answer</span>
        </button>
      ) : (
        <div className="lock-note is-empty">No offers right now.</div>
      )}

      <div className="lock-bottom" aria-hidden>
        <span className="lock-round"><Flashlight size={22} /></span>
        <span className="lock-bar" />
        <span className="lock-round"><Camera size={22} /></span>
      </div>
    </div>
  )
}
