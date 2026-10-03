import { useEffect, useRef, useState, useCallback } from 'react'

export const API = '/api'

export type Activity = { at: string; kind: string; message: string; data: any }
export type Task = {
  id: number; incident_id: number; type: string; status: string; title: string; description: string
  requirements: any; urgency: number; priority: number; proposal_reasoning: string; lon: number; lat: number
  created_at: string; updated_at: string
}
export type Assignment = {
  id: number; task_id: number; volunteer_id: number; status: string; eta_s: number; reason: string
  route: GeoJSON.LineString | null; created_at: string; updated_at: string
}
export type Volunteer = {
  id: number; name: string; skills: string[]; equipment: string[]; vehicle: any; available: boolean
  verify_safe: boolean; lon: number; lat: number
}
export type Incident = {
  id: number; status: string; type: string; summary: string; priority: number; confidence: number
  lon: number; lat: number; n_obs: number; sources: string[] | null; location_text: string | null
}
export type Observation = {
  id: number; observed_at: string; source_type: string; category: string; subtype: string
  confidence: number; incident_id: number | null; summary: string; point: GeoJSON.Point | null
  text: string | null; reporter: string | null; channel: string | null
}
export type DemoStatus = {
  phase: 'idle' | 'loading' | 'ingesting' | 'ready' | 'error'; message: string; done: number; total: number
  by_source: Record<string, number>; live_start: string | null; travel_speed: number
}
/** One volunteer the matcher looked at, and what it decided about them. */
export type Candidate = {
  id: number; name: string; lon: number; lat: number; dist_m: number; skills: string[]; equipment: string[]
  vehicle: any; role: 'chosen' | 'alternative' | 'skipped' | 'unreachable' | 'farther'
  eta_s?: number; mode?: string; rank?: number; reasons?: string[]
}
export type Sensor = { site_id: string; name: string; flood_stage_ft: number; lon: number; lat: number; stage_ft: number | null; at: string | null }
export type Closure = { id: number; name: string; closed_reason: string; geometry: GeoJSON.LineString }
export type State = {
  clock: { sim_now: string; speed: number; simulated: boolean }
  demo: DemoStatus
  incidents: Incident[]; tasks: Task[]; assignments: Assignment[]; volunteers: Volunteer[]
  observations: Observation[]; closures: Closure[]; sensors: Sensor[]; activity: Activity[]
}

export async function get<T = any>(path: string): Promise<T> {
  const r = await fetch(API + path)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

export async function post<T = any>(path: string, body?: any): Promise<T> {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

/** Live operational state: snapshot + WebSocket events (debounced refetch, instant GPS moves). */
export function useLiveState() {
  const [state, setState] = useState<State | null>(null)
  const [lastEvent, setLastEvent] = useState<{ event: string; data: any } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const refresh = useCallback(() => {
    get<State>('/state').then(setState).catch(console.error)
  }, [])

  useEffect(() => {
    refresh()
    let ws: WebSocket | null = null
    let closed = false
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data)
        setLastEvent(msg)
        if (msg.event === 'volunteer.location') {
          setState((s) => s && {
            ...s,
            volunteers: s.volunteers.map((v) => (v.id === msg.data.id ? { ...v, lon: msg.data.lon, lat: msg.data.lat } : v)),
          })
          return
        }
        if (msg.event === 'clock') {
          setState((s) => s && { ...s, clock: msg.data })
          return
        }
        if (msg.event === 'demo.status') {
          setState((s) => s && { ...s, demo: { ...msg.data, by_source: { ...msg.data.by_source } } })
          if (msg.data.phase !== 'ingesting') { window.clearTimeout(timer.current); timer.current = window.setTimeout(refresh, 250) }
          return
        }
        if (msg.event === 'sensor.reading') return
        if (msg.event === 'activity') {
          setState((s) => s && { ...s, activity: [msg.data, ...s.activity].slice(0, 200) })
        }
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(refresh, 250)
      }
      ws.onclose = () => { if (!closed) setTimeout(connect, 1000) }
    }
    connect()
    return () => { closed = true; ws?.close() }
  }, [refresh])

  return { state, refresh, lastEvent }
}

/** Simulated clock that ticks locally between server updates. */
export function useSimClock(clock?: State['clock']) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    if (!clock) return
    const base = new Date(clock.sim_now).getTime()
    const start = performance.now()
    const id = window.setInterval(() => setNow(new Date(base + (performance.now() - start) * clock.speed)), 250)
    return () => window.clearInterval(id)
  }, [clock?.sim_now, clock?.speed])
  return now
}

export const SOURCES: Record<string, { label: string; icon: string; color: string }> = {
  social: { label: 'Social media', icon: '📱', color: '#a78bfa' },
  ngo: { label: 'NGO request', icon: '🏢', color: '#fbbf24' },
  shelter: { label: 'Shelter', icon: '🏠', color: '#fbbf24' },
  resident: { label: 'SMS / hotline', icon: '💬', color: '#fb923c' },
  radio: { label: 'Public-safety radio', icon: '📻', color: '#f472b6' },
  volunteer: { label: 'Volunteer field report', icon: '🙋', color: '#34d399' },
  ncdot: { label: 'NCDOT road feed', icon: '🚧', color: '#ef4444' },
  usgs: { label: 'USGS river gauge', icon: '🌊', color: '#60a5fa' },
}

export function vehicleDesc(v: any) {
  if (!v) return 'No vehicle'
  return `${v.type} · ${v.capacity_gal ?? 0} gal cargo · ${v.seats ?? '?'} seats${v.high_clearance ? ' · high clearance' : ''}`
}

export const mins = (s?: number | null) => (s == null ? '—' : `${Math.max(1, Math.round(s / 60))} min`)

export function fmtTime(d: Date | string | null | undefined) {
  if (!d) return '—'
  const x = typeof d === 'string' ? new Date(d) : d
  return x.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
