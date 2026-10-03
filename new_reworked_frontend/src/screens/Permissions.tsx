import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, LocateFixed } from 'lucide-react'
import { useStore } from '../lib/store'
import { Alert, Button, ScreenHeader, Steps } from '../components/ui'

type Perm = 'idle' | 'granted' | 'denied' | 'unsupported'

export default function Permissions() {
  const { profile, setProfile, register, mode } = useStore()
  const nav = useNavigate()
  const [loc, setLoc] = useState<Perm>(profile.location ? 'granted' : 'idle')
  const [notif, setNotif] = useState<Perm>(profile.notifications ? 'granted' : 'idle')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const askLocation = () => {
    if (!('geolocation' in navigator)) { setLoc('unsupported'); return }
    navigator.geolocation.getCurrentPosition(
      () => { setLoc('granted'); setProfile({ location: true }) },
      () => { setLoc('denied'); setProfile({ location: false }) },
      { timeout: 8000 })
  }
  const askNotif = async () => {
    if (!('Notification' in window)) { setNotif('unsupported'); return }
    const r = await Notification.requestPermission()
    setNotif(r === 'granted' ? 'granted' : 'denied')
    setProfile({ notifications: r === 'granted' })
  }

  const finish = async () => {
    setBusy(true); setErr(null)
    try { await register(); nav('/map') } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="onboard">
      <ScreenHeader title="Two permissions" back="/onboard/skills" right={<Steps at={3} total={3} />} />
      <div className="onboard-body">
        <div className="perm">
          <span className="perm-icon"><LocateFixed size={22} aria-hidden /></span>
          <div className="perm-text">
            <h2>Location</h2>
            <p>Matching starts from where you are, and when you finish a task we compare your position with the address. Shared only while you are marked available.</p>
            <PermButton state={loc} onAsk={askLocation} label="Allow location" />
            {loc === 'denied' && <p className="field-error">Location is blocked. You can still help: you will be placed in Swannanoa and evidence checks will ask for a photo with the house number.</p>}
          </div>
        </div>

        <div className="perm">
          <span className="perm-icon"><Bell size={22} aria-hidden /></span>
          <div className="perm-text">
            <h2>Alerts</h2>
            <p>A request is offered to one volunteer at a time. An alert lets you say yes or no quickly so it does not sit waiting.</p>
            <PermButton state={notif} onAsk={askNotif} label="Allow alerts" />
            {notif === 'denied' && <p className="field-error">Alerts are blocked. Offers will still show at the top of the app while it is open.</p>}
          </div>
        </div>

        {err && <Alert tone="danger" title="Could not finish sign-up">{err}. Check your connection and try again.</Alert>}
      </div>
      <div className="onboard-foot">
        <Button variant="primary" size="lg" block busy={busy} onClick={finish}>{mode === 'live' ? 'Join the volunteer roster' : 'Open the map'}</Button>
        <button className="linkish center" onClick={finish} disabled={busy}>Skip for now</button>
      </div>
    </div>
  )
}

function PermButton({ state, onAsk, label }: { state: Perm; onAsk: () => void; label: string }) {
  if (state === 'granted') return <span className="perm-ok"><Check size={16} strokeWidth={3} aria-hidden /> Allowed</span>
  if (state === 'unsupported') return <span className="hint">This browser does not support it.</span>
  return <Button onClick={onAsk}>{state === 'denied' ? 'Try again' : label}</Button>
}
