import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MapView from '../MapView'
import { get, post, useLiveState, type Task, type Volunteer as V, type Assignment } from '../api'

type Mine = { volunteer: V; assignment: Assignment | null; task: Task | null }

export default function Volunteer() {
  const [params, setParams] = useSearchParams()
  const vid = params.get('id') ? Number(params.get('id')) : null
  const { state, lastEvent } = useLiveState()
  const [mine, setMine] = useState<Mine | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [report, setReport] = useState('')
  const [lastReason, setLastReason] = useState<string | null>(null)

  useEffect(() => {
    if (vid == null) return
    get<Mine>(`/volunteers/${vid}`).then((m) => {
      setMine((prev) => {
        if (prev?.assignment && m.assignment && prev.assignment.id === m.assignment.id && prev.assignment.reason !== m.assignment.reason)
          setLastReason(m.assignment.reason)
        return m
      })
    })
  }, [vid, lastEvent])

  if (vid == null) {
    return (
      <div className="vol pick">
        <h1>Volunteer app</h1>
        <p className="muted">Choose who you are (demo login):</p>
        {state?.volunteers.map((v) => (
          <button key={v.id} className="task-row" onClick={() => setParams({ id: String(v.id) })}>
            <span className="grow"><b>{v.name}</b> · {v.vehicle ? v.vehicle.type : 'no vehicle'}</span>
          </button>
        ))}
      </div>
    )
  }

  const a = mine?.assignment, t = mine?.task, v = mine?.volunteer
  const act = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true); setMsg(null)
    try { const r = await fn(); if (ok) setMsg(typeof ok === 'string' ? ok : ''); return r } catch (e: any) { setMsg(e.message) } finally { setBusy(false) }
  }

  const complete = () => act(async () => {
    const fd = new FormData()
    if (photo) fd.append('photo', photo)
    fd.append('note', note)
    if (v?.lon != null) { fd.append('lon', String(v.lon)); fd.append('lat', String(v.lat)) }
    const r = await post(`/assignments/${a!.id}/complete`, fd)
    setMsg(r.verdict === 'VERIFIED' ? '✅ Verified — thank you!' : `✖ Not verified: ${r.reasoning}`)
    setPhoto(null); setNote('')
  })

  return (
    <div className="vol">
      <header className="vol-head">
        <div><b>{v?.name}</b><div className="sub">{v?.vehicle ? `${v.vehicle.type} · ${v.vehicle.capacity_gal ?? 0} gal` : 'no vehicle'}</div></div>
        <label className="toggle">
          <input type="checkbox" checked={!!v?.available} onChange={(e) => act(() => post(`/volunteers/${vid}/availability`, { available: e.target.checked }))} />
          {v?.available ? 'Available' : 'Off duty'}
        </label>
      </header>
      <div className="vol-map"><MapView state={state} focusVolunteerId={vid} showContext={false} compact /></div>

      <div className="vol-body">
        {!a && <div className="card muted">No assignment right now. You'll be notified when a nearby task matches your capabilities.</div>}

        {a && t && (
          <div className={`card ${a.status === 'OFFERED' ? 'offer' : ''}`}>
            <div className="sub">{a.status === 'OFFERED' ? 'NEW ASSIGNMENT' : 'ACTIVE ASSIGNMENT'} · ETA {Math.round(a.eta_s / 60)} min</div>
            <h2>{t.title}</h2>
            <p>{t.description}</p>
            {t.requirements?.supplies?.length > 0 && <p><b>Bring:</b> {t.requirements.supplies.join(', ')}</p>}
            {lastReason && a.status === 'ACCEPTED' && <div className="alert">↻ Route updated: {lastReason}</div>}
            {a.status === 'OFFERED' && (
              <div className="row">
                <button className="primary" disabled={busy} onClick={() => act(() => post(`/assignments/${a.id}/accept`))}>Accept</button>
                <button disabled={busy} onClick={() => act(() => post(`/assignments/${a.id}/decline`))}>Decline</button>
              </div>
            )}
            {a.status === 'ACCEPTED' && (
              <div className="complete">
                <h3>Complete task</h3>
                <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                <textarea placeholder="Note (what you did)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="primary" disabled={busy || !photo} onClick={complete}>{busy ? 'Verifying…' : 'Submit evidence'}</button>
              </div>
            )}
          </div>
        )}
        {msg && <div className="card">{msg}</div>}

        <div className="card">
          <h3>Report what you see</h3>
          <textarea placeholder="e.g. Tree down blocking Old Fort Rd near the church" value={report} onChange={(e) => setReport(e.target.value)} />
          <button disabled={busy || !report} onClick={() => act(async () => { await post(`/volunteers/${vid}/observations`, { text: report }); setReport('') }, 'Report sent — thanks.')}>Send report</button>
        </div>
      </div>
    </div>
  )
}
