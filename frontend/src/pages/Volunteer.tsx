import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PhoneMap from '../PhoneMap'
import { mins, post, useLiveState, useSimClock, vehicleDesc, type Assignment, type State } from '../api'

/**
 * Volunteer mobile app, shown inside a phone frame for the demo.
 * `/volunteer?id=N` pins a volunteer; plain `/volunteer` follows whoever was most recently
 * dispatched (DEMO-STUB login shortcut so the tab can be opened before the match happens).
 */
export default function Volunteer() {
  const [params] = useSearchParams()
  const pinned = params.get('id') ? Number(params.get('id')) : null
  const { state } = useLiveState()
  const now = useSimClock(state?.clock)
  const [screen, setScreen] = useState<'lock' | 'app'>('lock')

  const vid = pinned ?? followed(state)
  const v = state?.volunteers.find((x) => x.id === vid) ?? null
  const a = state?.assignments.filter((x) => x.volunteer_id === vid && x.status !== 'SUPERSEDED').slice(-1)[0] ?? null
  const t = a ? state?.tasks.find((x) => x.id === a.task_id) ?? null : null

  // A new offer always lands on the lock screen as a push notification.
  const notified = useRef<number | null>(null)
  useEffect(() => {
    if (a?.status === 'OFFERED' && notified.current !== a.id) {
      notified.current = a.id
      setScreen('lock')
      chime()
      navigator.vibrate?.([120, 80, 120])
    }
  }, [a?.id, a?.status])

  return (
    <div className="phone-page">
      <div className="phone">
        <div className="notch" />
        <StatusBar now={now} dark={screen === 'lock'} />
        {screen === 'lock'
          ? <LockScreen now={now} offer={a?.status === 'OFFERED' ? a : null} title={t?.title} where={incidentWhere(state, t?.incident_id)} onOpen={() => setScreen('app')} />
          : state && <App state={state} vid={vid} a={a} onLock={() => setScreen('lock')} now={now} />}
      </div>
      <div className="phone-caption muted">
        {v ? <>Signed in as <b>{v.name}</b>{pinned ? '' : ' (auto: most recently dispatched volunteer)'}</> : 'Waiting for a dispatch…'}
        {screen === 'app' && <> · <button className="linkish" onClick={() => setScreen('lock')}>lock phone</button></>}
      </div>
    </div>
  )
}

function followed(state: State | null): number | null {
  if (!state) return null
  const live = state.assignments.filter((x) => ['OFFERED', 'ACCEPTED'].includes(x.status))
  const pick = live.slice(-1)[0] ?? state.assignments.filter((x) => x.status === 'DONE').slice(-1)[0]
  return pick?.volunteer_id ?? null
}

function incidentWhere(state: State | null, incidentId?: number) {
  const loc = state?.incidents.find((i) => i.id === incidentId)?.location_text
  return loc?.replace(/,?\s*NC$/, '') ?? ''
}

function chime() {
  try {
    const ctx = new AudioContext()
    ;[880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.15)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.15 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.15 + 0.3)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.15)
      o.stop(ctx.currentTime + i * 0.15 + 0.35)
    })
  } catch { /* autoplay blocked; the visual notification still shows */ }
}

const et = (d: Date | null, opts: Intl.DateTimeFormatOptions) => (d ? d.toLocaleString('en-US', { timeZone: 'America/New_York', ...opts }) : '')

function StatusBar({ now, dark }: { now: Date | null; dark: boolean }) {
  return (
    <div className={`statusbar ${dark ? 'on-dark' : ''}`}>
      <span>{et(now, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}</span>
      <span>▂▄▆ 🔋</span>
    </div>
  )
}

function LockScreen({ now, offer, title, where, onOpen }: { now: Date | null; offer: Assignment | null; title?: string; where: string; onOpen: () => void }) {
  return (
    <div className="lock">
      <div className="lock-date">{et(now, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <div className="lock-time">{et(now, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}</div>
      {offer && (
        <button className="notif" onClick={onOpen}>
          <div className="notif-head"><span className="app-icon">🤝</span><span>HELENE RESPONSE</span><span className="grow" /><span>now</span></div>
          <div className="notif-title">New mission near you · {mins(offer.eta_s)} away</div>
          <div className="notif-body">{title}{where ? ` · ${where}` : ''}</div>
        </button>
      )}
      <div className="lock-hint">{offer ? 'Tap the notification to open' : ''}</div>
    </div>
  )
}

function App({ state, vid, a, onLock, now }: { state: State; vid: number | null; a: Assignment | null; onLock: () => void; now: Date | null }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const v = state.volunteers.find((x) => x.id === vid)
  const t = a ? state.tasks.find((x) => x.id === a.task_id) : undefined
  const where = incidentWhere(state, t?.incident_id)
  const arrived = a && state.activity.some((x) => x.kind === 'arrived' && x.data?.assignment_id === a.id)
  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e: any) { setMsg(e.message) } finally { setBusy(false) }
  }
  const complete = () => act(() => post(`/assignments/${a!.id}/complete`, { note }))

  const me = v?.lon != null ? [v.lon, v.lat] : null
  const dest = t ? [t.lon, t.lat] : null
  const showMap = a && ['OFFERED', 'ACCEPTED'].includes(a.status)

  return (
    <div className="app">
      <div className="app-bar">
        <span className="app-icon">🤝</span><b>Helene Response</b><span className="grow" />
        {v && <span className="avatar sm" onClick={onLock}>{v.name.split(' ').map((w) => w[0]).join('')}</span>}
      </div>
      {showMap && <div className="app-map"><PhoneMap me={me} dest={dest} route={a!.route} /></div>}
      <div className="app-body">
        {(!a || !t || a.status === 'RELEASED') && <div className="app-empty">You're available. We'll notify you when someone nearby needs exactly what you can offer.</div>}

        {a && t && a.status === 'OFFERED' && (
          <>
            <div className="mission-tag">{t.urgency >= 0.75 ? '🔴 Urgent mission' : 'New mission'}</div>
            <h2>{t.title}</h2>
            <div className="mission-meta">📍 {where}<br />🚗 {mins(a.eta_s)} drive from you</div>
            <div className="mission-sec"><h4>Why you</h4><WhyYou req={t.requirements} v={v} eta={a.eta_s} /></div>
            {t.requirements?.supplies?.length > 0 && <div className="mission-sec"><h4>Bring</h4><p>{t.requirements.supplies.join(' · ')}</p></div>}
            <div className="mission-sec"><h4>What's needed</h4><p>{t.description}</p></div>
            <div className="mission-actions">
              <button className="decline" disabled={busy} onClick={() => act(() => post(`/assignments/${a.id}/decline`))}>Decline</button>
              <button className="accept" disabled={busy} onClick={() => act(() => post(`/assignments/${a.id}/accept`))}>Accept mission</button>
            </div>
          </>
        )}

        {a && t && a.status === 'ACCEPTED' && !arrived && (
          <>
            <div className="mission-tag ok">✔ Mission accepted</div>
            <h2>Head to {where}</h2>
            <EtaLeft a={a} now={now} />
            <div className="nav-buttons">
              <a className="button" href={`https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lon}`} target="_blank" rel="noreferrer">Google Maps ↗</a>
              <a className="button" href={`https://maps.apple.com/?daddr=${t.lat},${t.lon}`} target="_blank" rel="noreferrer">Apple Maps ↗</a>
            </div>
            <div className="mission-sec"><h4>On arrival</h4><p>{t.description}</p></div>
          </>
        )}

        {a && t && a.status === 'ACCEPTED' && arrived && (
          <>
            <div className="mission-tag ok">📍 You've arrived</div>
            <h2>{t.title}</h2>
            <div className="mission-sec"><h4>What's needed</h4><p>{t.description}</p></div>
            <div className="mission-sec"><h4>Anything command should know? (optional)</h4>
              <textarea placeholder="e.g. They also need a ride to the pharmacy tomorrow" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <button className="accept full" disabled={busy} onClick={complete}>{busy ? 'Saving…' : 'Mark complete'}</button>
          </>
        )}

        {a && t && a.status === 'DONE' && (
          <div className="app-done"><div className="big-check">✅</div><h2>Mission complete</h2><p className="muted">Thank you, {v?.name.split(' ')[0]}. You made a real difference today.</p></div>
        )}
        {msg && <div className="app-msg">{msg}</div>}
      </div>
    </div>
  )
}

/** Shows the job's hard requirements checked against this volunteer's profile. */
function WhyYou({ req, v, eta }: { req: any; v: any; eta: number }) {
  const veh = v?.vehicle ?? {}
  const rows: [string, string][] = []
  if (req?.vehicle) rows.push(['Vehicle needed', vehicleDesc(v?.vehicle)])
  if (req?.min_capacity_gal > 0) rows.push([`≥ ${req.min_capacity_gal} gal cargo`, `${veh.capacity_gal ?? 0} gal`])
  if (req?.high_clearance) rows.push(['High clearance', 'yes'])
  if (req?.min_seats > 0) rows.push([`≥ ${req.min_seats} seats`, `${veh.seats} seats`])
  for (const s of req?.skills ?? []) rows.push([s.replace(/_/g, ' '), 'skill on profile'])
  for (const e of req?.equipment ?? []) rows.push([e.replace(/_/g, ' '), 'equipment on profile'])
  return (
    <div className="why">
      {rows.map(([k, val]) => <div key={k} className="why-row"><span>✓ {k}</span><span className="muted">{val}</span></div>)}
      <div className="why-row"><span>✓ Fastest capable volunteer</span><span className="muted">{mins(eta)} by road</span></div>
    </div>
  )
}

function EtaLeft({ a, now }: { a: Assignment; now: Date | null }) {
  const elapsed = now ? (now.getTime() - new Date(a.updated_at).getTime()) / 1000 : 0
  const left = Math.max(0, a.eta_s - elapsed)
  return <div className="eta-big"><b>{mins(left)}</b><span className="muted"> away</span></div>
}
