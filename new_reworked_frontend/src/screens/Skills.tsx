import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Minus, Plus } from 'lucide-react'
import { useStore } from '../lib/store'
import { EQUIPMENT, SKILLS, VEHICLES } from '../lib/vocab'
import { qualifies } from '../lib/match'
import type { Vehicle, Volunteer } from '../lib/types'
import { Button, ScreenHeader, Steps, Toggle } from '../components/ui'

const DEFAULT_VEHICLE: Record<string, Vehicle> = {
  sedan: { type: 'sedan', capacity_gal: 10, seats: 4, high_clearance: false },
  suv: { type: 'suv', capacity_gal: 25, seats: 5, high_clearance: true },
  minivan: { type: 'minivan', capacity_gal: 35, seats: 7, high_clearance: false },
  pickup: { type: 'pickup', capacity_gal: 80, seats: 2, high_clearance: true },
}

export function CapabilityEditor({ skills, setSkills, equipment, setEquipment, vehicle, setVehicle }: {
  skills: string[]; setSkills: (s: string[]) => void
  equipment: string[]; setEquipment: (s: string[]) => void
  vehicle: Vehicle | null; setVehicle: (v: Vehicle | null) => void
}) {
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const step = (k: 'capacity_gal' | 'seats', d: number, min: number, max: number) =>
    vehicle && setVehicle({ ...vehicle, [k]: Math.max(min, Math.min(max, (vehicle[k] ?? 0) + d)) })

  return (
    <>
      <section className="form-section">
        <h2 className="section-title">Vehicle</h2>
        <div className="segmented" role="radiogroup" aria-label="Vehicle">
          {VEHICLES.map((v) => {
            const on = (vehicle?.type ?? 'none') === v.id
            return (
              <button key={v.id} type="button" role="radio" aria-checked={on} className={on ? 'is-on' : ''}
                onClick={() => setVehicle(v.id === 'none' ? null : DEFAULT_VEHICLE[v.id])}>{v.label}</button>
            )
          })}
        </div>
        {vehicle && (
          <div className="vehicle-spec">
            <div className="stepper">
              <span className="stepper-label">Water it can carry</span>
              <button type="button" aria-label="Less cargo" onClick={() => step('capacity_gal', -5, 0, 200)}><Minus size={16} /></button>
              <span className="stepper-value num">{vehicle.capacity_gal ?? 0} gal</span>
              <button type="button" aria-label="More cargo" onClick={() => step('capacity_gal', 5, 0, 200)}><Plus size={16} /></button>
            </div>
            <div className="stepper">
              <span className="stepper-label">Passenger seats</span>
              <button type="button" aria-label="Fewer seats" onClick={() => step('seats', -1, 0, 8)}><Minus size={16} /></button>
              <span className="stepper-value num">{vehicle.seats ?? 0}</span>
              <button type="button" aria-label="More seats" onClick={() => step('seats', 1, 0, 8)}><Plus size={16} /></button>
            </div>
            <Toggle label="High clearance" sub="Can cross washouts and gravel shoulders" checked={!!vehicle.high_clearance}
              onChange={(v) => setVehicle({ ...vehicle, high_clearance: v })} />
          </div>
        )}
      </section>

      <section className="form-section">
        <h2 className="section-title">Skills</h2>
        <div className="pick-grid">
          {SKILLS.map((s) => {
            const on = skills.includes(s.id)
            return (
              <button key={s.id} type="button" aria-pressed={on} className={`pick${on ? ' is-on' : ''}`} onClick={() => setSkills(toggle(skills, s.id))}>
                <span className="pick-box" aria-hidden>{on && <Check size={14} strokeWidth={3} />}</span>
                <span className="pick-text"><b>{s.label}</b><span className="sub">{s.hint}</span></span>
              </button>
            )
          })}
        </div>
        <p className="hint">Matching uses the first six today. The rest go to coordinators for crews they assemble by hand.</p>
      </section>

      <section className="form-section">
        <h2 className="section-title">Equipment you can bring</h2>
        <div className="tag-cloud">
          {EQUIPMENT.map((e) => {
            const on = equipment.includes(e.id)
            return (
              <button key={e.id} type="button" aria-pressed={on} className={`tag-pick${on ? ' is-on' : ''}`} onClick={() => setEquipment(toggle(equipment, e.id))}>
                {on && <Check size={14} strokeWidth={3} aria-hidden />}{e.label}
              </button>
            )
          })}
        </div>
      </section>
    </>
  )
}

export default function Skills() {
  const { profile, setProfile, snap } = useStore()
  const nav = useNavigate()
  const [skills, setSkills] = useState(profile.skills)
  const [equipment, setEquipment] = useState(profile.equipment)
  const [vehicle, setVehicle] = useState<Vehicle | null>(profile.vehicle)
  const [hours, setHours] = useState(profile.hours)

  const fit = useMemo(() => {
    const open = (snap?.tasks ?? []).filter((t) => t.status === 'OPEN' || t.status === 'ASSIGNED')
    const v: Volunteer = { id: -1, name: '', skills, equipment, vehicle, available: true, verify_safe: false, lon: 0, lat: 0 }
    return { n: open.filter((t) => qualifies(v, t)).length, of: open.length }
  }, [snap, skills, equipment, vehicle])

  return (
    <div className="onboard">
      <ScreenHeader title="What you can bring" back="/onboard/identity" right={<Steps at={2} total={3} />} />
      <div className="onboard-body">
        <CapabilityEditor {...{ skills, setSkills, equipment, setEquipment, vehicle, setVehicle }} />
        <section className="form-section">
          <h2 className="section-title">When</h2>
          <div className="segmented" role="radiogroup" aria-label="Availability">
            {([['now', 'Right now'], ['today', 'Later today'], ['weekend', 'This weekend']] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={hours === id} className={hours === id ? 'is-on' : ''} onClick={() => setHours(id)}>{label}</button>
            ))}
          </div>
        </section>
      </div>
      <div className="onboard-foot">
        <div className="fit-meter" aria-live="polite">
          <span className="fit-meter-n num">{fit.n}<span> of {fit.of}</span></span>
          <span className="fit-meter-text">open requests near Swannanoa fit what you selected</span>
          <span className="fit-meter-bar"><span style={{ width: `${fit.of ? (fit.n / fit.of) * 100 : 0}%` }} /></span>
        </div>
        <Button variant="primary" size="lg" block icon={ArrowRight}
          onClick={() => { setProfile({ skills, equipment, vehicle, hours }); nav('/onboard/permissions') }}>Continue</Button>
      </div>
    </div>
  )
}
