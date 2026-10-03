const TZ = 'America/New_York'

export function miles(m: number) {
  const mi = m / 1609.34
  if (mi < 0.1) return `${Math.round(m * 3.281)} ft`
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

export function minutes(s: number) {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export function clockTime(d: Date | string) {
  const x = typeof d === 'string' ? new Date(d) : d
  return x.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
}

export function dayTime(d: Date | string) {
  const x = typeof d === 'string' ? new Date(d) : d
  return x.toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "4 min ago", relative to the simulation clock rather than the wall clock. */
export function ago(at: string, now: Date | null) {
  if (!now) return clockTime(at)
  const s = (now.getTime() - new Date(at).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return dayTime(at)
}

export function arrival(now: Date | null, etaS: number) {
  if (!now) return '—'
  return clockTime(new Date(now.getTime() + etaS * 1000))
}

export function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}
