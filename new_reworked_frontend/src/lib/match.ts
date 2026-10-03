import type { Task, Volunteer } from './types'
import { meters } from './geo'
import { labelOf } from './vocab'

export type Line = { ok: boolean; label: string; detail: string }

/** Same hard filters as backend/app/coordination/matcher.py:capability_gaps, but returned as a readable ledger. */
export function ledger(v: Volunteer, t: Task): Line[] {
  const req = t.requirements ?? {}
  const veh = v.vehicle ?? {} as NonNullable<Volunteer['vehicle']>
  const lines: Line[] = []
  if (t.type === 'VERIFY_CONDITION')
    lines.push({ ok: v.verify_safe, label: 'Cleared for hazard checks', detail: v.verify_safe ? 'On your profile' : 'Not on your profile' })
  if (req.vehicle)
    lines.push({ ok: !!v.vehicle, label: 'Vehicle', detail: v.vehicle ? `Your ${vehicleName(v.vehicle.type)}` : 'You have no vehicle listed' })
  if (req.high_clearance)
    lines.push({ ok: !!veh.high_clearance, label: 'High clearance', detail: veh.high_clearance ? 'Washouts on the way' : 'Route has washouts' })
  if ((req.min_capacity_gal ?? 0) > 0)
    lines.push({ ok: (veh.capacity_gal ?? 0) >= req.min_capacity_gal!, label: `Cargo for ${req.min_capacity_gal} gal`, detail: `You carry ${veh.capacity_gal ?? 0} gal` })
  if ((req.min_seats ?? 0) > 0)
    lines.push({ ok: (veh.seats ?? 0) >= req.min_seats!, label: `${req.min_seats} passenger seat${req.min_seats! > 1 ? 's' : ''}`, detail: `You have ${veh.seats ?? 0}` })
  for (const s of req.skills ?? [])
    lines.push({ ok: v.skills.includes(s), label: labelOf(s), detail: v.skills.includes(s) ? 'On your profile' : 'Not on your profile' })
  for (const e of req.equipment ?? [])
    lines.push({ ok: v.equipment.includes(e), label: labelOf(e), detail: v.equipment.includes(e) ? 'You have it' : 'You do not have it' })
  return lines
}

export const qualifies = (v: Volunteer, t: Task) => ledger(v, t).every((l) => l.ok)

export function vehicleName(type?: string) {
  return ({ pickup: 'pickup', suv: 'SUV', sedan: 'car', minivan: 'minivan' } as Record<string, string>)[type ?? ''] ?? type ?? 'vehicle'
}

export type Ranked = { task: Task; distance_m: number; fits: boolean; score: number }

/** Recommendation order for the volunteer's own view: fit first, then urgency weighed against distance. */
export function rank(v: Volunteer | null, tasks: Task[]): Ranked[] {
  return tasks
    .filter((t) => t.status === 'OPEN' || t.status === 'ASSIGNED' || t.status === 'BLOCKED')
    .map((t) => {
      const d = v ? meters([v.lon, v.lat], [t.lon, t.lat]) : 0
      const fits = v ? qualifies(v, t) : false
      const score = (fits ? 1 : 0) * 10 + t.priority * 4 - d / 8000
      return { task: t, distance_m: d, fits, score }
    })
    .sort((a, b) => b.score - a.score)
}
