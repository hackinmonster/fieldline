import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, MessageSquareText, Users } from 'lucide-react'
import { useStore } from '../lib/store'
import MapCanvas from '../components/MapCanvas'
import { Button } from '../components/ui'

/** "French Broad River At Asheville, NC" → "French Broad River" */
const riverName = (name: string) => name.split(/ at /i)[0]

export default function Welcome() {
  const { snap, profile, setProfile, signInAs } = useStore()
  const nav = useNavigate()
  const [phone, setPhone] = useState(profile.phone)
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'phone' | 'code' | 'roster'>('phone')
  const [err, setErr] = useState<string | null>(null)

  const situation = useMemo(() => {
    if (!snap) return null
    const open = snap.tasks.filter((t) => t.status === 'OPEN' || t.status === 'ASSIGNED').length
    // Only gauges still reporting (same 6 h rule the map uses to mark one offline).
    const now = new Date(snap.clock.sim_now).getTime()
    const gauge = [...snap.sensors].filter((s) => s.stage_ft != null && s.at && now - new Date(s.at).getTime() <= 6 * 3600e3)
      .sort((a, b) => (b.stage_ft! - b.flood_stage_ft) - (a.stage_ft! - a.flood_stage_ft))[0]
    return { open, closed: snap.closures.length, gauge }
  }, [snap])

  const digits = phone.replace(/\D/g, '')
  const sendCode = () => {
    if (digits.length !== 10) { setErr('Enter a 10-digit US number, like 828 555 0142.'); return }
    setErr(null); setProfile({ phone: digits }); setStage('code')
  }
  const checkCode = () => {
    if (!/^\d{6}$/.test(code)) { setErr('The code is 6 digits.'); return }
    setErr(null); nav('/onboard/identity')
  }

  return (
    <div className="welcome">
      <div className="welcome-map" aria-hidden>
        {snap && <MapCanvas snap={snap} me={null} interactive={false} initial={{ center: [-82.46, 35.6], zoom: 10.6 }} />}
        <div className="welcome-mark"><img src="/mark.svg" alt="" width={32} height={32} /><span>Fieldline</span></div>
      </div>

      <div className="welcome-panel">
        <h1 className="display-xl">Help the people you can actually reach.</h1>
        <p className="lede">
          Requests from residents, shelters and radio traffic come in here. You get the ones your vehicle, skills and
          location can handle, a route around closed roads, and a quick check when the job is done.
        </p>

        {situation && (
          <p className="situation num" aria-label="Current situation">
            <span><b>{situation.open}</b> open requests</span>
            <span><b>{situation.closed}</b> roads closed</span>
            {situation.gauge && <span>{riverName(situation.gauge.name)} <b>{situation.gauge.stage_ft?.toFixed(1)} ft</b> (flood {situation.gauge.flood_stage_ft})</span>}
          </p>
        )}

        {stage === 'phone' && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); sendCode() }}>
            <label className="field">
              <span className="field-label">Mobile number</span>
              <input inputMode="tel" autoComplete="tel" placeholder="828 555 0142" value={phone}
                aria-invalid={!!err} onChange={(e) => setPhone(e.target.value)} />
            </label>
            {err && <p className="field-error" role="alert">{err}</p>}
            <Button variant="primary" size="lg" block icon={MessageSquareText} type="submit">Text me a code</Button>
          </form>
        )}

        {stage === 'code' && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); checkCode() }}>
            <label className="field">
              <span className="field-label">Code sent to <span className="num">({digits.slice(0, 3)}) {digits.slice(3, 6)}-{digits.slice(6)}</span></span>
              <input className="mono code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
                value={code} aria-invalid={!!err} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </label>
            {err && <p className="field-error" role="alert">{err}</p>}
            <Button variant="primary" size="lg" block icon={ArrowRight} type="submit">Continue</Button>
            <button type="button" className="linkish" onClick={() => setStage('phone')}>Use a different number</button>
          </form>
        )}

        {stage === 'roster' && (
          <div className="roster">
            <p className="hint">Already on a coordinator's roster? Pick your name.</p>
            {snap?.volunteers.map((v) => (
              <button key={v.id} className="roster-row" onClick={() => { signInAs(v.id); nav('/map') }}>
                <span className="avatar">{v.name.split(' ').map((p) => p[0]).join('')}</span>
                <span className="grow"><b>{v.name}</b><span className="sub">{v.vehicle ? v.vehicle.type : 'No vehicle'}{v.skills.length ? ` · ${v.skills.length} skills` : ''}</span></span>
                <ArrowRight size={18} aria-hidden />
              </button>
            ))}
          </div>
        )}

        {stage !== 'roster' && (
          <button className="linkish welcome-alt" onClick={() => setStage('roster')}>
            <Users size={16} aria-hidden /> Sign in from a coordinator roster
          </button>
        )}
      </div>
    </div>
  )
}
