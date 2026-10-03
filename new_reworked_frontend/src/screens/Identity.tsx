import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Building2, Camera, CheckCircle2, IdCard } from 'lucide-react'
import { useStore } from '../lib/store'
import { Button, ScreenHeader, Steps } from '../components/ui'

export default function Identity() {
  const { profile, setProfile } = useStore()
  const nav = useNavigate()
  const [name, setName] = useState(profile.name)
  const [method, setMethod] = useState<'license' | 'org' | null>(profile.idMethod)
  const [photo, setPhoto] = useState<File | null>(null)
  const [org, setOrg] = useState('')
  const [tried, setTried] = useState(false)

  const nameOk = name.trim().split(/\s+/).length >= 2
  const orgOk = /^[A-Z0-9]{4,8}$/i.test(org.trim())
  const methodOk = method === 'license' ? !!photo : method === 'org' ? orgOk : false
  const next = () => {
    setTried(true)
    if (!nameOk || !methodOk) return
    setProfile({ name: name.trim(), idMethod: method })
    nav('/onboard/skills')
  }

  return (
    <div className="onboard">
      <ScreenHeader title="Who you are" back="/welcome" right={<Steps at={1} total={3} />} />
      <div className="onboard-body">
        <p className="lede">Residents open their door to a name they were told to expect. We check yours once.</p>

        <label className="field">
          <span className="field-label">Full name</span>
          <input autoComplete="name" placeholder="First and last name" value={name} onChange={(e) => setName(e.target.value)}
            aria-invalid={tried && !nameOk} />
          {tried && !nameOk && <span className="field-error" role="alert">Enter your first and last name as on your ID.</span>}
        </label>

        <fieldset className="choice-group">
          <legend className="field-label">Verify with</legend>
          <button type="button" className={`choice${method === 'license' ? ' is-on' : ''}`} aria-pressed={method === 'license'} onClick={() => setMethod('license')}>
            <IdCard size={22} aria-hidden />
            <span className="grow"><b>Driver license</b><span className="sub">Photo of the front. Reviewed by a coordinator.</span></span>
          </button>
          {method === 'license' && (
            <div className="choice-detail">
              {photo ? (
                <div className="id-ok"><CheckCircle2 size={18} aria-hidden /> <span><b>{photo.name}</b><span className="sub">Pending review. Deliveries unlock now; wellness checks after review.</span></span></div>
              ) : (
                <label className="btn btn-secondary btn-md btn-block file-btn">
                  <Camera size={18} aria-hidden /><span>Photograph license</span>
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                </label>
              )}
            </div>
          )}

          <button type="button" className={`choice${method === 'org' ? ' is-on' : ''}`} aria-pressed={method === 'org'} onClick={() => setMethod('org')}>
            <Building2 size={22} aria-hidden />
            <span className="grow"><b>Organization roster</b><span className="sub">Your church, CERT team or relief group already vouched for you.</span></span>
          </button>
          {method === 'org' && (
            <div className="choice-detail">
              <label className="field">
                <span className="field-label">Roster code from your coordinator</span>
                <input className="mono" placeholder="e.g. SWN24F" value={org} onChange={(e) => setOrg(e.target.value.toUpperCase())} aria-invalid={tried && !orgOk} />
                {tried && !orgOk && <span className="field-error" role="alert">Roster codes are 4 to 8 letters or numbers.</span>}
              </label>
            </div>
          )}
          {tried && !method && <span className="field-error" role="alert">Choose one way to verify.</span>}
        </fieldset>
      </div>
      <div className="onboard-foot">
        <Button variant="primary" size="lg" block icon={ArrowRight} onClick={next}>Continue</Button>
      </div>
    </div>
  )
}
