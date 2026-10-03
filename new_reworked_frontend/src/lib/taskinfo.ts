import type { Snapshot, Task } from './types'

/** Rough on-site time by task type, shown next to the drive ETA. */
export const ON_SITE_MIN: Record<Task['type'], number> = {
  DELIVER_SUPPLIES: 15, WELLNESS_CHECK: 20, TRANSPORT: 60, VERIFY_CONDITION: 10,
}

export const SAFETY: Record<Task['type'], string[]> = {
  DELIVER_SUPPLIES: [
    'Turn around at standing or moving water. Six inches can stall a car; a foot can float it.',
    'Lift with your legs. A 5-gallon jug weighs about 42 lb.',
  ],
  WELLNESS_CHECK: [
    'Do not force entry. If no one answers, report it and dispatch will send responders.',
    'If someone needs medical care, call 911 first, then update the task.',
  ],
  TRANSPORT: [
    'Confirm the rider’s name before they get in.',
    'Stay on the route shown. It avoids roads reported closed.',
  ],
  VERIFY_CONDITION: [
    'Stay back from slides and washouts. Ground near the edge can give way.',
    'Photograph from a safe distance. Never cross debris to get a better view.',
  ],
}

export function checklist(t: Task): string[] {
  const req = t.requirements ?? {}
  const items: string[] = []
  if (req.supplies?.length) items.push(`Load: ${req.supplies.join(', ')}`)
  if (t.type === 'DELIVER_SUPPLIES') items.push('Arrive and introduce yourself by name', 'Carry supplies inside', 'Ask what else they need before you leave')
  if (t.type === 'WELLNESS_CHECK') items.push('Knock and identify yourself', 'Check: water, food, medication, heat, mobility', 'Note anything urgent for dispatch')
  if (t.type === 'TRANSPORT') items.push('Confirm rider name and destination', 'Drop off and confirm they are checked in')
  if (t.type === 'VERIFY_CONDITION') items.push('Stop at a safe distance', 'Photograph the road surface', 'Report: passable, one lane, or closed')
  items.push('Take a photo for verification')
  return items
}

/** The reports that led to this task, oldest first: the requester and anyone who corroborated. */
export function sourcesFor(snap: Snapshot | null, t: Task) {
  if (!snap || t.incident_id == null) return []
  return snap.observations.filter((o) => o.incident_id === t.incident_id).sort((a, b) => a.observed_at.localeCompare(b.observed_at))
}

export function mapsLink(t: Task) {
  return `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lon}`
}
