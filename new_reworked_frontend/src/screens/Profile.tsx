import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, Clock, LogOut, PenLine, ShieldCheck, Truck } from 'lucide-react'
import { useStore } from '../lib/store'
import { CapabilityEditor } from './Skills'
import { Alert, Button, Chip, ScreenHeader, Toggle } from '../components/ui'
import { dayTime, initials } from '../lib/format'
import { labelOf, TASK_KIND } from '../lib/vocab'
import { vehicleName } from '../lib/match'
import type { Vehicle } from '../lib/types'

export default function Profile() {
  const { me, profile, setProfile, history, setAvailable, mode, signOut } = useStore()
  const nav = useNavigate()
  const [editing, setEditing] = useState(false)
  const [skills, setSkills] = useState(me?.skills ?? [])
  const [equipment, setEquipment] = useState(me?.equipment ?? [])
  const [vehicle, setVehicle] = useState<Vehicle | null>(me?.vehicle ?? null)

  if (!me) return <div className="profile"><ScreenHeader title="Profile" /><Alert tone="caution" title="Profile not found">Your volunteer record is not in the current snapshot. Sign out and sign in again.</Alert></div>

  const save = () => { setProfile({ skills, equipment, vehicle }); setEditing(false) }
  const verified = profile.idMethod === 'org' || mode === 'demo'
  const kinds = history.reduce<Record<string, number>>((acc, h) => ({ ...acc, [h.task.type]: (acc[h.task.type] ?? 0) + 1 }), {})

  return (
    <div className="profile">
      <ScreenHeader title="Profile" right={!editing && <Button variant="quiet" icon={PenLine} onClick={() => setEditing(true)}>Edit</Button>} />
      <div className="profile-body">
        {/* Capability tag: the same fields the matcher reads */}
        <div className="cap-tag">
          <span className="cap-tag-hole" aria-hidden />
          <div className="cap-tag-top">
            <span className="avatar lg">{initials(me.name)}</span>
            <div className="grow">
              <div className="cap-tag-name">{me.name}</div>
              <div className="cap-tag-id">
                {verified
                  ? <Chip tone="done" icon={BadgeCheck}>ID verified{profile.idMethod === 'org' ? ' by roster' : ''}</Chip>
                  : <Chip tone="caution" icon={Clock}>ID under review</Chip>}
              </div>
            </div>
            <span className="cap-tag-no num" aria-label={`Volunteer number ${me.id}`}>V-{String(me.id).padStart(3, '0')}</span>
          </div>
          <dl className="cap-tag-grid">
            <div><dt>Vehicle</dt><dd>{me.vehicle ? <><Truck size={15} aria-hidden /> {vehicleName(me.vehicle.type)}</> : 'None'}</dd></div>
            <div><dt>Cargo</dt><dd className="num">{me.vehicle?.capacity_gal ?? 0} gal</dd></div>
            <div><dt>Seats</dt><dd className="num">{me.vehicle?.seats ?? 0}</dd></div>
            <div><dt>Clearance</dt><dd>{me.vehicle?.high_clearance ? 'High' : 'Standard'}</dd></div>
          </dl>
          <div className="cap-tag-list">
            {me.skills.map((s) => <span key={s} className="cap-item">{labelOf(s)}</span>)}
            {me.equipment.map((e) => <span key={e} className="cap-item is-gear">{labelOf(e)}</span>)}
            {!me.skills.length && !me.equipment.length && <span className="hint">No skills or equipment listed yet.</span>}
          </div>
          <div className="cap-tag-foot">
            <ShieldCheck size={14} aria-hidden />
            {me.verify_safe ? 'Cleared for hazard checks' : 'Hazard checks need a coordinator sign-off'}
          </div>
        </div>

        {editing ? (
          <div className="edit-block">
            <CapabilityEditor {...{ skills, setSkills, equipment, setEquipment, vehicle, setVehicle }} />
            {mode === 'live' && <p className="hint">Changes are saved on this phone. Your coordinator updates the roster that matching uses.</p>}
            <div className="row">
              <Button onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="primary" className="grow" onClick={save}>Save</Button>
            </div>
          </div>
        ) : (
          <>
            <section className="form-section">
              <h2 className="section-title">Availability</h2>
              <Toggle checked={me.available} onChange={setAvailable}
                label={me.available ? 'Available for offers' : 'Off duty'} sub="Turn off when you are driving home or out of supplies." />
            </section>

            <section className="form-section">
              <h2 className="section-title">Your work</h2>
              <div className="impact">
                <div className="impact-n num">{history.length}</div>
                <div className="impact-text">
                  completed task{history.length === 1 ? '' : 's'}
                  {Object.entries(kinds).length > 0 && <span className="sub">{Object.entries(kinds).map(([k, n]) => `${n} ${TASK_KIND[k as keyof typeof TASK_KIND].label.toLowerCase()}`).join(' · ')}</span>}
                </div>
              </div>
              {history.length === 0 ? (
                <p className="hint">Nothing completed yet. Your first finished task shows up here with its receipt.</p>
              ) : (
                <ol className="timeline">
                  {history.map((h) => {
                    const K = TASK_KIND[h.task.type]
                    return (
                      <li key={h.assignment.id}>
                        <span className="tl-dot"><K.icon size={14} aria-hidden /></span>
                        <div className="grow">
                          <div className="tl-title">{h.task.title}</div>
                          <div className="sub num">{dayTime(h.assignment.updated_at)} · done</div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>

            <section className="form-section">
              <h2 className="section-title">Account</h2>
              <div className="kv"><span>Phone</span><b className="num">{profile.phone ? `(${profile.phone.slice(0, 3)}) ${profile.phone.slice(3, 6)}-${profile.phone.slice(6)}` : 'Not set'}</b></div>
              <div className="kv"><span>Location sharing</span><b>{profile.location ? 'On while available' : 'Off'}</b></div>
              <div className="kv"><span>Alerts</span><b>{profile.notifications ? 'On' : 'Off'}</b></div>
              <Button variant="quiet" icon={LogOut} onClick={() => { signOut(); nav('/welcome') }}>Sign out</Button>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
