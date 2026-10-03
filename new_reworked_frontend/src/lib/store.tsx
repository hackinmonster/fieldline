import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import fixtureJson from '../data/fixture.json'
import { get, openSocket, post } from './api'
import { along, lineLength, meters, progressOn, type LonLat } from './geo'
import type { Assignment, Completion, Snapshot, Task, Volunteer, Vehicle } from './types'

const fixture = fixtureJson as unknown as Snapshot
const DEMO_VID = 1
const OFFER_DELAY_MS = 9000
export const ARRIVE_RADIUS_M = 200 // backend/app/state/api.py

export type Mode = 'connecting' | 'live' | 'demo'

export type Profile = {
  name: string
  phone: string
  idMethod: 'license' | 'org' | null
  skills: string[]
  equipment: string[]
  vehicle: Vehicle | null
  hours: 'now' | 'today' | 'weekend'
  location: boolean
  notifications: boolean
  onboarded: boolean
  vid: number | null
}

const EMPTY_PROFILE: Profile = {
  name: '', phone: '', idMethod: null, skills: [], equipment: [], vehicle: null, hours: 'now',
  location: false, notifications: false, onboarded: false, vid: null,
}

/** `?scene=` stages the demo at one point of the story (used by the flow overview and screen links). */
export type Scene = 'browse' | 'offer' | 'active' | 'arrived' | 'done'
const params = new URLSearchParams(location.search)
const SCENE = (params.get('scene') as Scene | null) ?? null
const FORCE_DEMO = params.has('demo') || SCENE != null
const SCENE_PROFILE: Profile = {
  name: 'Jordan Reyes', phone: '8285550142', idMethod: 'org', skills: [], equipment: [], vehicle: null, hours: 'now',
  location: true, notifications: true, onboarded: true, vid: DEMO_VID,
}

function loadProfile(): Profile {
  if (SCENE) return SCENE_PROFILE
  try { return { ...EMPTY_PROFILE, ...JSON.parse(localStorage.getItem('fieldline.profile') ?? '{}') } } catch { return EMPTY_PROFILE }
}


type Ctx = {
  mode: Mode
  socketUp: boolean
  snap: Snapshot | null
  now: Date | null
  profile: Profile
  setProfile: (p: Partial<Profile>) => void
  me: Volunteer | null
  assignment: Assignment | null
  task: Task | null
  history: { assignment: Assignment; task: Task }[]
  offer: Assignment | null
  dismissOffer: () => void
  lastCompletion: Completion | null
  register: () => Promise<void>
  signInAs: (vid: number) => void
  accept: (aid: number) => Promise<void>
  /** Take a task directly (e.g. one you declined and changed your mind about). Ends ACCEPTED. */
  claim: (taskId: number) => Promise<void>
  /** Tasks you declined that nobody else has taken: shown last, still yours to take. */
  declinedIds: Set<number>
  decline: (aid: number) => Promise<void>
  complete: (aid: number, note: string) => Promise<Completion>
  setAvailable: (on: boolean) => Promise<void>
  report: (text: string) => Promise<void>
  demoDrive: (on: boolean) => void
  driving: boolean
  signOut: () => void
}

const StoreCtx = createContext<Ctx | null>(null)
export const useStore = () => useContext(StoreCtx)!

/** Demo snapshot: the fixture with Jordan's offer held back so the "task matched" moment happens on screen. */
function initialDemo(): Snapshot {
  const s: Snapshot = structuredClone(fixture)
  s.assignments = s.assignments.filter((a) => a.id !== 1)
  s.tasks = s.tasks.map((t) => (t.id === 1 ? { ...t, status: 'OPEN' } : t))
  return SCENE && SCENE !== 'browse' ? staged(s, SCENE) : s
}

function staged(s: Snapshot, scene: Scene): Snapshot {
  const a = structuredClone(fixture.assignments.find((x) => x.id === 1)!)
  const coords = a.route!.coordinates as LonLat[]
  const total = lineLength(coords)
  const status = scene === 'offer' ? 'OFFERED' : scene === 'done' ? 'DONE' : 'ACCEPTED'
  const taskStatus = scene === 'offer' ? 'ASSIGNED' : scene === 'done' ? 'COMPLETED' : 'EN_ROUTE'
  const at = scene === 'active' ? along(coords, total * 0.42).point : scene === 'arrived' || scene === 'done' ? along(coords, total - 25).point : null
  return {
    ...s,
    assignments: [...s.assignments, { ...a, status, updated_at: scene === 'done' ? '2024-09-29T14:41:00Z' : a.updated_at }],
    tasks: s.tasks.map((t) => (t.id === 1 ? { ...t, status: taskStatus } : t)),
    volunteers: at ? s.volunteers.map((v) => (v.id === DEMO_VID ? { ...v, lon: at[0], lat: at[1] } : v)) : s.volunteers,
  }
}

function stagedCompletion(): Completion {
  return { task: fixture.tasks.find((x) => x.id === 1)!, at: new Date('2024-09-29T14:41:00Z'), distance_m: 25, note: '' }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('connecting')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [socketUp, setSocketUp] = useState(false)
  const [profile, setProfileState] = useState<Profile>(loadProfile)
  const [offer, setOffer] = useState<Assignment | null>(null)
  const [lastCompletion, setLastCompletion] = useState<Completion | null>(SCENE === 'done' ? stagedCompletion : null)
  const [driving, setDriving] = useState(false)
  const seenOffers = useRef(new Set<number>(SCENE && SCENE !== 'offer' ? [1] : []))
  const refreshTimer = useRef<number | undefined>(undefined)

  const setProfile = useCallback((p: Partial<Profile>) => {
    setProfileState((prev) => {
      const next = { ...prev, ...p }
      if (!SCENE) try { localStorage.setItem('fieldline.profile', JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }, [])

  // ---- Connect: live backend if it answers, otherwise the demo snapshot ----
  const refresh = useCallback(() => get<Snapshot>('/state').then(setSnap).catch(() => undefined), [])

  useEffect(() => {
    let stop: (() => void) | undefined
    if (FORCE_DEMO) { setSnap(initialDemo()); setMode('demo'); return }
    get<Snapshot>('/state', 2500)
      .then((s) => {
        setSnap(s)
        setMode('live')
        stop = openSocket((msg) => {
          if (msg.event === 'volunteer.location') {
            setSnap((x) => x && { ...x, volunteers: x.volunteers.map((v) => (v.id === msg.data.id ? { ...v, lon: msg.data.lon, lat: msg.data.lat } : v)) })
            return
          }
          if (msg.event === 'clock') { setSnap((x) => x && { ...x, clock: msg.data }); return }
          window.clearTimeout(refreshTimer.current)
          refreshTimer.current = window.setTimeout(refresh, 250)
        }, setSocketUp)
      })
      .catch(() => {
        setSnap(initialDemo())
        setMode('demo')
      })
    return () => stop?.()
  }, [refresh])

  // ---- Clock: server sim time, ticking locally ----
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    if (!snap) return
    const base = new Date(snap.clock.sim_now).getTime()
    const start = performance.now()
    const speed = snap.clock.speed || 1
    const tick = () => setNow(new Date(base + (performance.now() - start) * speed))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.clock.sim_now, snap?.clock.speed])

  const vid = mode === 'demo' ? DEMO_VID : profile.vid

  // Demo: the onboarding profile becomes Jordan's capabilities, so the story still matches.
  const me = useMemo<Volunteer | null>(() => {
    const v = snap?.volunteers.find((x) => x.id === vid) ?? null
    if (!v || mode !== 'demo' || !profile.onboarded) return v
    return {
      ...v,
      name: profile.name || v.name,
      skills: profile.skills.length ? profile.skills : v.skills,
      equipment: profile.equipment.length ? profile.equipment : v.equipment,
      vehicle: profile.vehicle ?? v.vehicle,
    }
  }, [snap, vid, mode, profile])

  const assignment = useMemo(() => {
    if (!snap || vid == null) return null
    const mine = snap.assignments.filter((a) => a.volunteer_id === vid && (a.status === 'OFFERED' || a.status === 'ACCEPTED'))
    return mine.sort((a, b) => b.id - a.id)[0] ?? null
  }, [snap, vid])

  const task = useMemo(() => (assignment && snap?.tasks.find((t) => t.id === assignment.task_id)) || null, [snap, assignment])

  const history = useMemo(() => {
    if (!snap || vid == null) return []
    return snap.assignments
      .filter((a) => a.volunteer_id === vid && a.status === 'DONE')
      .map((a) => ({ assignment: a, task: snap.tasks.find((t) => t.id === a.task_id)! }))
      .filter((x) => x.task)
      .sort((a, b) => b.assignment.updated_at.localeCompare(a.assignment.updated_at))
  }, [snap, vid])

  const declinedIds = useMemo(() => {
    const out = new Set<number>()
    if (!snap || vid == null) return out
    for (const a of snap.assignments) {
      if (a.volunteer_id !== vid || a.status !== 'RELEASED' || !/declined/i.test(a.reason)) continue
      const t = snap.tasks.find((x) => x.id === a.task_id)
      if (t && t.id !== task?.id && ['OPEN', 'BLOCKED', 'ASSIGNED'].includes(t.status)) out.add(t.id)
    }
    return out
  }, [snap, vid, task])

  // ---- New offer → in-app banner (+ system notification when allowed) ----
  useEffect(() => {
    if (!assignment || assignment.status !== 'OFFERED' || seenOffers.current.has(assignment.id)) return
    seenOffers.current.add(assignment.id)
    setOffer(assignment)
    if (profile.notifications && 'Notification' in window && Notification.permission === 'granted' && task) {
      try { new Notification('You are needed nearby', { body: task.title, tag: `offer-${assignment.id}` }) } catch { /* unsupported context */ }
    }
  }, [assignment, task, profile.notifications])

  // ---- Demo: Jordan's offer arrives a few seconds after onboarding ----
  useEffect(() => {
    if (mode !== 'demo' || !profile.onboarded || SCENE) return
    if (snap?.assignments.some((a) => a.id === 1)) return
    const id = window.setTimeout(() => {
      const a = structuredClone(fixture.assignments.find((x) => x.id === 1)!)
      setSnap((s) => s && {
        ...s,
        assignments: [...s.assignments, { ...a, created_at: new Date().toISOString() }],
        tasks: s.tasks.map((t) => (t.id === 1 ? { ...t, status: 'ASSIGNED' } : t)),
      })
    }, OFFER_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [mode, profile.onboarded, snap?.assignments])

  // ---- Live: share this phone's GPS for volunteers who registered here ----
  useEffect(() => {
    if (mode !== 'live' || !profile.location || profile.vid == null || !('geolocation' in navigator)) return
    let last = 0
    const id = navigator.geolocation.watchPosition((p) => {
      if (Date.now() - last < 15000) return
      last = Date.now()
      post(`/volunteers/${profile.vid}/location`, { lon: p.coords.longitude, lat: p.coords.latitude }).catch(() => undefined)
    }, undefined, { enableHighAccuracy: true })
    return () => navigator.geolocation.clearWatch(id)
  }, [mode, profile.location, profile.vid])

  // ---- Demo: drive along the route (stands in for the replayer's VolunteerSim) ----
  useEffect(() => {
    if (!driving || mode !== 'demo' || !assignment?.route) return
    const coords = assignment.route.coordinates as LonLat[]
    const total = lineLength(coords)
    const start = me ? Math.min(total, meters(coords[0], [me.lon, me.lat]) > 5 ? progressOn(coords, [me.lon, me.lat]) : 0) : 0
    const t0 = performance.now()
    const mps = total / 45 // whole route in ~45 s
    const id = window.setInterval(() => {
      const d = Math.min(total, start + ((performance.now() - t0) / 1000) * mps)
      const p = along(coords, d).point
      setSnap((s) => s && { ...s, volunteers: s.volunteers.map((v) => (v.id === DEMO_VID ? { ...v, lon: p[0], lat: p[1] } : v)) })
      if (d >= total) { window.clearInterval(id); setDriving(false) }
    }, 200)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driving, mode, assignment?.id])

  // ---- Actions ----
  const register = useCallback(async () => {
    if (mode !== 'live') { setProfile({ onboarded: true, vid: DEMO_VID }); return }
    let lon = -82.4, lat = 35.6 // Swannanoa, if location is off or denied
    if (profile.location && 'geolocation' in navigator) {
      await new Promise<void>((res) => navigator.geolocation.getCurrentPosition(
        (p) => { lon = p.coords.longitude; lat = p.coords.latitude; res() }, () => res(), { timeout: 6000 }))
    }
    const v = await post<Volunteer>('/volunteers', {
      name: profile.name, skills: profile.skills, equipment: profile.equipment, vehicle: profile.vehicle,
      available: profile.hours === 'now', verify_safe: false, lon, lat,
    })
    setProfile({ onboarded: true, vid: v.id })
    await refresh()
  }, [mode, profile, refresh, setProfile])

  const signInAs = useCallback((id: number) => {
    const v = snap?.volunteers.find((x) => x.id === id)
    if (!v) return
    setProfile({
      name: v.name, skills: v.skills, equipment: v.equipment, vehicle: v.vehicle, vid: id,
      idMethod: 'org', onboarded: true, location: false,
    })
  }, [snap, setProfile])

  const patchDemo = (fn: (s: Snapshot) => Snapshot) => setSnap((s) => s && fn(s))
  const setTask = (s: Snapshot, id: number, status: Task['status']) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, status } : t)) })
  const setAsg = (s: Snapshot, id: number, p: Partial<Assignment>) => ({ ...s, assignments: s.assignments.map((a) => (a.id === id ? { ...a, ...p } : a)) })

  const accept = useCallback(async (aid: number) => {
    setOffer(null)
    if (mode === 'live') { await post(`/assignments/${aid}/accept`); await refresh(); return }
    patchDemo((s) => {
      const a = s.assignments.find((x) => x.id === aid)!
      return setTask(setAsg(s, aid, { status: 'ACCEPTED' }), a.task_id, 'EN_ROUTE')
    })
  }, [mode, refresh])

  const claim = useCallback(async (taskId: number) => {
    setOffer(null)
    if (mode === 'live') {
      if (vid == null) throw new Error('Sign in first')
      await post(`/tasks/${taskId}/claim`, { volunteer_id: vid }); await refresh(); return
    }
    const t = snap?.tasks.find((x) => x.id === taskId)
    if (!t || !me) throw new Error('404: task not found')
    if (!['OPEN', 'BLOCKED', 'ASSIGNED'].includes(t.status)) throw new Error('409: another volunteer already accepted this task')
    if (assignment) throw new Error('409: finish or decline your current task first')
    // Demo routing: reuse the scripted route for this task if there is one, else a straight line at ~30 mph.
    const prior = fixture.assignments.find((a) => a.task_id === taskId && a.volunteer_id === DEMO_VID && a.route)
    const d = meters([me.lon, me.lat], [t.lon, t.lat])
    const at = (now ?? new Date()).toISOString()
    const a: Assignment = {
      id: Date.now(), task_id: taskId, volunteer_id: DEMO_VID, status: 'ACCEPTED', reason: `${me.name} took the task directly`,
      route: prior?.route ?? { type: 'LineString', coordinates: [[me.lon, me.lat], [t.lon, t.lat]] },
      steps: prior?.steps, distance_m: prior?.distance_m ?? Math.round(d * 1.3), eta_s: prior?.eta_s ?? Math.round((d * 1.3) / 13.4),
      created_at: at, updated_at: at,
    }
    patchDemo((s) => ({
      ...setTask(s, taskId, 'EN_ROUTE'),
      assignments: [...s.assignments.map((x) => (x.task_id === taskId && x.status === 'OFFERED'
        ? { ...x, status: 'RELEASED' as const, reason: `withdrawn: ${me.name} took the task` } : x)), a],
    }))
  }, [mode, vid, snap, me, assignment, now, refresh])

  const decline = useCallback(async (aid: number) => {
    setOffer(null)
    if (mode === 'live') { await post(`/assignments/${aid}/decline`); await refresh(); return }
    patchDemo((s) => {
      const a = s.assignments.find((x) => x.id === aid)!
      return setTask(setAsg(s, aid, { status: 'RELEASED', reason: 'declined by volunteer' }), a.task_id, 'OPEN')
    })
  }, [mode, refresh])

  // One tap: "I did it". The backend's only check is that the volunteer's GPS is within ARRIVE_RADIUS_M of the task.
  const complete = useCallback(async (aid: number, note: string) => {
    const t = task!
    const d = me ? meters([me.lon, me.lat], [t.lon, t.lat]) : null
    if (mode === 'live') {
      await post(`/assignments/${aid}/complete`, { note })
      await refresh()
    } else {
      if (d == null || d > ARRIVE_RADIUS_M)
        throw new Error(`409: location check failed: ${d == null ? 'no GPS fix' : `${Math.round(d)} m away`}, must be within ${ARRIVE_RADIUS_M} m of the task`)
      patchDemo((s) => setTask(setAsg(s, aid, { status: 'DONE', updated_at: (now ?? new Date()).toISOString() }), t.id, 'COMPLETED'))
    }
    const c: Completion = { task: t, at: now ?? new Date(), distance_m: d == null ? null : Math.round(d), note }
    setLastCompletion(c)
    return c
  }, [mode, task, me, now, refresh])

  const setAvailable = useCallback(async (on: boolean) => {
    if (mode === 'live' && vid != null) { await post(`/volunteers/${vid}/availability`, { available: on }); await refresh(); return }
    patchDemo((s) => ({ ...s, volunteers: s.volunteers.map((v) => (v.id === vid ? { ...v, available: on } : v)) }))
  }, [mode, vid, refresh])

  const report = useCallback(async (text: string) => {
    if (mode === 'live' && vid != null) { await post(`/volunteers/${vid}/observations`, { text }); await refresh(); return }
    patchDemo((s) => ({
      ...s,
      observations: [{
        id: Date.now(), observed_at: (now ?? new Date()).toISOString(), source_type: 'volunteer', category: null, subtype: null,
        confidence: 1, incident_id: null, summary: text, reporter: me?.name ?? 'You', raw: null,
        point: me ? { type: 'Point', coordinates: [me.lon, me.lat] } : null,
      }, ...s.observations],
    }))
  }, [mode, vid, now, me, refresh])

  const signOut = useCallback(() => {
    try { localStorage.removeItem('fieldline.profile') } catch { /* ignore */ }
    setProfileState(EMPTY_PROFILE)
    seenOffers.current.clear()
    if (mode === 'demo') setSnap(initialDemo())
  }, [mode])

  const value: Ctx = {
    mode, socketUp, snap, now, profile, setProfile, me, assignment, task, history,
    offer, dismissOffer: () => setOffer(null), lastCompletion,
    register, signInAs, accept, claim, declinedIds, decline, complete, setAvailable, report,
    demoDrive: setDriving, driving, signOut,
  }
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

