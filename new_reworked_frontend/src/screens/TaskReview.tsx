import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Clock, ExternalLink, MapPin, Navigation, Package, ShieldAlert, X } from 'lucide-react'
import { useStore } from '../lib/store'
import MapCanvas, { type MapHandle, type RouteDraw } from '../components/MapCanvas'
import { Alert, Button, Empty, IconButton, UrgencyChip } from '../components/ui'
import { ledger } from '../lib/match'
import { meters, type LonLat } from '../lib/geo'
import { ago, arrival, miles, minutes } from '../lib/format'
import { SOURCE, TASK_KIND, TASK_STATUS_LABEL } from '../lib/vocab'
import { ON_SITE_MIN, SAFETY, mapsLink, sourcesFor } from '../lib/taskinfo'

export default function TaskReview() {
  const { id } = useParams()
  const { snap, me, assignment, accept, decline, claim, declinedIds, now } = useStore()
  const nav = useNavigate()
  const [busy, setBusy] = useState<'accept' | 'decline' | 'claim' | null>(null)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const mapRef = useRef<MapHandle>(null)

  const t = snap?.tasks.find((x) => x.id === Number(id)) ?? null
  const offered = !!t && assignment?.task_id === t.id ? assignment : null
  const route: RouteDraw = useMemo(() => {
    if (!t) return null
    if (offered?.route) return { line: offered.route, kind: 'offer' }
    if (me) return { line: { type: 'LineString', coordinates: [[me.lon, me.lat], [t.lon, t.lat]] }, kind: 'preview' }
    return null
  }, [t, offered, me])
  useEffect(() => {
    if (route) mapRef.current?.fit(route.line.coordinates as LonLat[], { top: 60, bottom: 20 })
  }, [route])

  if (!snap) return null
  if (!t) return <div className="review"><Empty icon={MapPin} title="This request is no longer listed" action={<Button onClick={() => nav('/map')}>Back to map</Button>}>It may have been completed or merged with another report.</Empty></div>

  const K = TASK_KIND[t.type]
  const lines = me ? ledger(me, t) : []
  const sources = sourcesFor(snap, t)
  const dist = me ? meters([me.lon, me.lat], [t.lon, t.lat]) : null
  const drive = offered?.eta_s ?? null
  const total = (drive ?? 0) + ON_SITE_MIN[t.type] * 60
  const coords = (route?.line.coordinates ?? [[t.lon, t.lat]]) as LonLat[]

  const takeBack = async () => {
    setBusy('claim'); setErr(null)
    try { await claim(t.id); nav('/active') }
    catch (e: any) { setErr(String(e.message).replace(/^\d+:\s*/, '')) } finally { setBusy(null) }
  }

  const act = async (kind: 'accept' | 'decline') => {
    if (!offered) return
    setBusy(kind); setErr(null)
    try {
      if (kind === 'accept') { await accept(offered.id); nav('/active') }
      else { await decline(offered.id); nav('/map') }
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }

  return (
    <div className="review">
      <div className="review-map">
        <MapCanvas ref={mapRef} snap={snap} me={me} route={route} selectedTaskId={t.id} mineTaskId={offered ? t.id : null}
          layers={{ tasks: true, closures: true, flood: true, resources: false, gauges: false, volunteers: false, reports: false }}
          filter={(x) => x.id === t.id} interactive={false}
          initial={{ center: [(coords[0][0] + t.lon) / 2, (coords[0][1] + t.lat) / 2], zoom: coords.length > 2 ? 11.3 : 11.8 }} />
        <IconButton icon={ArrowLeft} label="Back" className="glass review-back" onClick={() => nav(-1)} />
        {offered && <span className="review-shield num"><Navigation size={14} strokeWidth={2.5} aria-hidden />{minutes(offered.eta_s)} · {miles(offered.distance_m ?? dist ?? 0)}</span>}
      </div>

      <div className="review-body">
        <div className="eyebrow">{offered ? 'Offered to you' : TASK_STATUS_LABEL[t.status]} · {K.label}</div>
        <h1 className="display-l">{t.title}</h1>
        <div className="review-chips">
          <UrgencyChip urgency={t.urgency} solid />
          {drive != null && <span className="fact num"><Clock size={15} aria-hidden /> <b>{minutes(drive)}</b> drive, arrive {arrival(now, drive)}</span>}
          {drive == null && dist != null && <span className="fact num"><MapPin size={15} aria-hidden /> <b>{miles(dist)}</b> straight line</span>}
        </div>

        <a className="address-row" href={mapsLink(t)} target="_blank" rel="noreferrer">
          <MapPin size={18} aria-hidden />
          <span className="grow"><b>{t.address ?? 'Location on map'}</b><span className="sub mono">{t.lat.toFixed(4)}° N, {Math.abs(t.lon).toFixed(4)}° W</span></span>
          <ExternalLink size={16} aria-hidden />
        </a>

        <section className="review-section">
          <h2 className="section-title">What to do</h2>
          <p className="body-text">{t.description}</p>
          {t.requirements?.supplies?.length ? (
            <div className="bring"><Package size={16} aria-hidden /><span><b>Bring</b> {t.requirements.supplies.join(' · ')}</span></div>
          ) : null}
          <p className="time-line num">About <b>{minutes(total)}</b> in all{drive != null ? `: ${minutes(drive)} driving, ~${ON_SITE_MIN[t.type]} min there` : `, ~${ON_SITE_MIN[t.type]} min on site plus the drive`}.</p>
        </section>

        {sources.length > 0 && (
          <section className="review-section">
            <h2 className="section-title">Who asked</h2>
            <ol className="sources">
              {sources.map((o, i) => {
                const S = SOURCE[o.source_type]
                return (
                  <li key={o.id}>
                    <span className="src-icon"><S.icon size={14} aria-hidden /></span>
                    <span className="grow">
                      <span className="src-who"><b>{o.reporter ?? S.label}</b> · {i === 0 ? 'request' : 'corroborated'} · {ago(o.observed_at, now)}</span>
                      <span className="src-text">“{o.raw ?? o.text ?? o.summary}”</span>
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {me && (
          <section className="review-section">
            <h2 className="section-title">Why you</h2>
            <ul className="ledger">
              {dist != null && <li className="ok"><Check size={16} strokeWidth={3} aria-hidden /><span className="grow">Nearby</span><span className="ledger-detail num">{miles(dist)} from you</span></li>}
              {lines.map((l) => (
                <li key={l.label} className={l.ok ? 'ok' : 'no'}>
                  {l.ok ? <Check size={16} strokeWidth={3} aria-hidden /> : <X size={16} strokeWidth={3} aria-hidden />}
                  <span className="grow">{l.label}</span><span className="ledger-detail">{l.detail}</span>
                </li>
              ))}
            </ul>
            {offered?.reason && <p className="ledger-reason">{offered.reason}</p>}
          </section>
        )}

        <section className="review-section">
          <h2 className="section-title">Safety</h2>
          <ul className="safety">
            {SAFETY[t.type].map((s) => <li key={s}><ShieldAlert size={16} aria-hidden />{s}</li>)}
          </ul>
        </section>

        {err && <Alert tone="danger" title="That did not go through">{err}</Alert>}
      </div>

      <div className="review-foot">
        {offered?.status === 'OFFERED' ? (
          confirmDecline ? (
            <div className="decline-confirm">
              <p>Dispatch will offer this to the next nearest volunteer who fits.</p>
              <div className="row">
                <Button onClick={() => setConfirmDecline(false)}>Keep it</Button>
                <Button variant="danger" busy={busy === 'decline'} onClick={() => act('decline')}>Decline</Button>
              </div>
            </div>
          ) : (
            <div className="row">
              <Button size="lg" onClick={() => setConfirmDecline(true)}>Decline</Button>
              <Button variant="primary" size="lg" icon={Check} busy={busy === 'accept'} className="grow" onClick={() => act('accept')}>Accept and navigate</Button>
            </div>
          )
        ) : declinedIds.has(t.id) ? (
          <div className="not-offered">
            <p>You declined this earlier. It is still open{assignment ? ', but finish or decline your current task first' : ', so you can take it now'}.</p>
            <Button variant="primary" size="lg" block icon={Check} busy={busy === 'claim'} disabled={!!assignment} onClick={takeBack}>Accept and navigate</Button>
          </div>
        ) : offered?.status === 'ACCEPTED' ? (
          <Button variant="primary" size="lg" block icon={Navigation} onClick={() => nav('/active')}>Resume navigation</Button>
        ) : (
          <div className="not-offered">
            <p>Dispatch offers each request to one volunteer at a time, nearest who fits first. If this one comes to you, you will get an alert.</p>
            <Button block onClick={() => nav(`/map?task=${t.id}`)}>Show on map</Button>
          </div>
        )}
      </div>
    </div>
  )
}
