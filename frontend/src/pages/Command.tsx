import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowLeft, BrainCircuit, Car, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Eye,
  FastForward, Flag, HeartPulse, Link2, ListChecks, Loader2, MapPin, MessageSquareQuote, Navigation, OctagonAlert, Package,
  Play, RefreshCw, RotateCcw, Search, ShieldCheck, Smartphone, Sparkles, Target, TrafficCone, Waves, X, type LucideIcon,
} from 'lucide-react'
import CommandMap, { LAYERS, STATUS_COLOR, type LayerId } from '../CommandMap'
import { fieldlineUrl, fmtTime, get, mins, post, SOURCES, useLiveState, useSimClock, type Activity, type Candidate, type State } from '../api'

// Same names and glyphs the volunteer sees in Fieldline.
const TASK_KIND: Record<string, { label: string; icon: LucideIcon }> = {
  DELIVER_SUPPLIES: { label: 'Supply delivery', icon: Package },
  WELLNESS_CHECK: { label: 'Wellness check', icon: HeartPulse },
  TRANSPORT: { label: 'Transport', icon: Car },
  VERIFY_CONDITION: { label: 'Verify condition', icon: Eye },
}
const STATUS_LABEL: Record<string, string> = {
  NONE: 'No task', OPEN: 'Needs a volunteer', ASSIGNED: 'Offered', EN_ROUTE: 'En route', BLOCKED: 'Blocked', COMPLETED: 'Done',
}

const KIND_ICON: Record<string, LucideIcon> = {
  extract: BrainCircuit, incident_link: Link2, task_created: ClipboardList, task_proposal: Sparkles, validator_reject: ShieldCheck,
  dispatch: Play, match: Target, accept: Check, arrived: MapPin, road: TrafficCone, escalation: OctagonAlert, completed: CheckCircle2,
  resolved: Flag, sensor: Waves, locate_failed: AlertTriangle, error: X,
}
const LOG_KINDS = new Set(['extract', 'incident_link', 'task_created', 'task_proposal', 'validator_reject', 'dispatch', 'match',
  'accept', 'arrived', 'escalation', 'completed', 'resolved', 'error', 'locate_failed'])

const DEFAULT_LAYERS = Object.fromEntries(LAYERS.map((l) => [l.id, l.id === 'incidents'])) as Record<LayerId, boolean>
const STAGE_MS = 1400

export default function Command() {
  const { state } = useLiveState()
  const now = useSimClock(state?.clock)
  const [layers, setLayers] = useState(DEFAULT_LAYERS)
  const [sel, setSel] = useState<number | null>(null)
  const [tab, setTab] = useState<'mission' | 'log'>('mission')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const task = useMemo(() => state?.tasks.find((t) => t.incident_id === sel) ?? null, [state?.tasks, sel])
  const decision = useMemo(() => state?.activity.find((a) => (a.kind === 'match' || a.kind === 'escalation') && task && a.data?.task_id === task.id) ?? null,
    [state?.activity, task])
  const candidates: Candidate[] | null = decision?.data?.candidates?.length ? decision.data.candidates : null

  // Candidate reveal (presentation pacing only — the decision itself is already made by the backend).
  const [stage, setStage] = useState(0)
  const revealed = useRef('')
  const dispatchedHere = useRef(false)
  const timers = useRef<number[]>([])
  const decisionKey = decision && candidates ? `${decision.at}:${decision.data.task_id}` : ''
  useEffect(() => {
    if (revealed.current === decisionKey) return
    revealed.current = decisionKey
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (!decisionKey) { setStage(0); return }
    if (!dispatchedHere.current) { setStage(4); return }
    dispatchedHere.current = false
    setStage(1)
    timers.current = [2, 3, 4].map((s, i) => window.setTimeout(() => setStage(s), STAGE_MS * (i + 1)))
  }, [decisionKey])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const dispatch = () => act(async () => {
    dispatchedHere.current = true
    await post(`/incidents/${sel}/dispatch`)
  })

  const demo = state?.demo
  const loading = demo && (demo.phase === 'loading' || demo.phase === 'ingesting')
  const speed = state?.clock.speed ?? 1

  return (
    <div className="command">
      <div className="map-wrap">
        <CommandMap state={state} layers={layers} selectedIncidentId={sel} onSelectIncident={(id) => { setSel(id); setTab('mission') }}
          candidates={candidates} stage={stage} storyTaskId={task?.id ?? null} />
        <LayerPanel state={state} layers={layers} setLayers={setLayers} />
        {stage > 0 && stage < 4 && (
          <div className="stage-banner" role="status">
            <Loader2 size={16} className="spin" aria-hidden />
            {['', 'Scanning volunteers near the incident', 'Applying hard requirements', 'Ranking by road travel time'][stage]}
          </div>
        )}
      </div>
      <aside className="side">
        <header className="side-head">
          <div className="brand">
            <img src="/mark.svg" alt="" width={32} height={32} />
            <div>
              <h1>Fieldline Command</h1>
              <div className="sub">Disaster response</div>
            </div>
          </div>
          <div className="clock">
            <div className="clock-time num">{now ? fmtTime(now) : '—'}</div>
            <div className="sub">{speed > 1 ? <span className="ff"><FastForward size={13} aria-hidden /> {speed}× while driving</span> : state?.clock.simulated ? 'Demo replay · Hurricane Helene' : 'Live'}</div>
          </div>
        </header>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'mission'} className={tab === 'mission' ? 'on' : ''} onClick={() => setTab('mission')}>{sel ? 'Incident' : 'Overview'}</button>
          <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>System log</button>
        </nav>
        <div className="scroll">
          {err && <div className="alert bad-card" role="alert"><OctagonAlert size={18} aria-hidden /><span>{err}</span></div>}
          {tab === 'log' && <Log activity={state?.activity ?? []} />}
          {tab === 'mission' && !sel && <Overview state={state} layers={layers} setLayers={setLayers} onSelect={setSel} />}
          {tab === 'mission' && sel && state && (
            <IncidentPanel key={sel} id={sel} state={state} task={task} decision={decision} candidates={candidates} stage={stage}
              now={now} busy={busy} onDispatch={dispatch} onBack={() => setSel(null)} />
          )}
        </div>
        <footer className="side-foot">
          {demo?.phase === 'ready' || demo?.phase === 'error' || demo?.phase === 'idle' ? (
            <>
              <button className="btn" disabled={busy || demo?.phase !== 'ready'} onClick={() => act(async () => { await post('/demo/rewind'); setSel(null) })}>
                <RotateCcw size={16} aria-hidden /> Rewind demo</button>
              <button className="btn" disabled={busy} onClick={() => { if (demo?.phase === 'idle' || confirm('Re-run full ingestion? (about 2–3 min of LLM processing)')) act(() => post('/demo/setup')) }}>
                {demo?.phase === 'idle' ? <><Play size={16} aria-hidden /> Load scenario</> : <><RefreshCw size={16} aria-hidden /> Reload scenario</>}</button>
              <a className="btn" href={fieldlineUrl(null)} target="fieldline"><Smartphone size={16} aria-hidden /> Volunteer app</a>
            </>
          ) : <span className="muted">{demo?.message}</span>}
          {loading && <div className="progress"><i style={{ width: `${(100 * demo!.done) / Math.max(1, demo!.total)}%` }} /></div>}
        </footer>
      </aside>
    </div>
  )
}

// ---------------- Map layer control ----------------
function LayerPanel({ state, layers, setLayers }: { state: State | null; layers: Record<LayerId, boolean>; setLayers: (f: (l: Record<LayerId, boolean>) => Record<LayerId, boolean>) => void }) {
  const [open, setOpen] = useState(true)
  const count = (id: LayerId) => {
    if (!state) return ''
    const l = LAYERS.find((x) => x.id === id)!
    if (l.sources) return state.observations.filter((o) => o.point && l.sources!.includes(o.source_type)).length
    return { incidents: state.incidents.length, volunteers: state.volunteers.length, roads: new Set(state.closures.map((c) => c.name)).size,
      gauges: state.sensors.length, weather: '', vulnerability: '', risk: '', landslides: 640, debris: '' }[id as string] ?? ''
  }
  let group = ''
  return (
    <div className="layers">
      <button className="layers-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        Data layers {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
      </button>
      {open && LAYERS.map((l) => {
        const head = l.group !== group ? (group = l.group) : null
        return (
          <div key={l.id}>
            {head && <div className="layers-group">{head}</div>}
            <label className="layer-row">
              <input type="checkbox" checked={layers[l.id]} onChange={(e) => setLayers((x) => ({ ...x, [l.id]: e.target.checked }))} />
              <i className={l.kind} style={{ background: l.color }} />
              <span className="grow">{l.label}</span>
              <span className="muted num">{count(l.id)}</span>
            </label>
          </div>
        )
      })}
    </div>
  )
}

// ---------------- Overview: ingestion → synthesized incidents ----------------
function Overview({ state, layers, setLayers, onSelect }: { state: State | null; layers: Record<LayerId, boolean>; setLayers: any; onSelect: (id: number) => void }) {
  if (!state) return <div className="card"><div className="skeleton"><span /><span /><span /></div></div>
  const d = state.demo
  const layerOf = (src: string) => LAYERS.find((l) => l.sources?.includes(src))?.id ?? (src === 'ncdot' ? 'roads' : src === 'usgs' ? 'gauges' : null)
  const order = ['social', 'ngo', 'shelter', 'resident', 'radio', 'ncdot', 'usgs']
  const taskOf = (id: number) => state.tasks.find((t) => t.incident_id === id)
  return (
    <>
      <section className="card">
        <div className="step-title"><span className="step-n">1</span> Ingestion: many sources, one stream</div>
        <div className="sources">
          {order.filter((s) => d.by_source[s]).map((s) => {
            const lid = layerOf(s) as LayerId | null
            const S = SOURCES[s]
            return (
              <button key={s} className={`src-chip ${lid && layers[lid] ? 'on' : ''}`} style={{ borderLeftColor: S.color }} aria-pressed={!!(lid && layers[lid])}
                onClick={() => lid && setLayers((x: any) => ({ ...x, [lid]: !x[lid] }))} title="Show on map">
                <S.icon size={16} aria-hidden style={{ color: S.color }} /><b className="num">{d.by_source[s]}</b><span className="muted">{S.label}</span>
              </button>
            )
          })}
          {!Object.keys(d.by_source).length && (
            <p className="muted empty-note">No data yet. Press <b>Load scenario</b> to replay the demo: Hurricane Helene in Buncombe County, NC (Sep 2024). It streams the real NCDOT closures and USGS gauge readings from that storm, plus community reports, through the live pipeline.</p>
          )}
        </div>
        {(d.phase === 'ingesting' || d.phase === 'loading') && <div className="muted ingest-msg"><Loader2 size={14} className="spin" aria-hidden /> {d.message}</div>}
      </section>
      <section className="card">
        <div className="step-title"><span className="step-n">2</span> AI synthesis: {state.incidents.length} incidents, {state.tasks.length} volunteer tasks</div>
        <div className="muted">Pick an incident to see how it was built and dispatch a volunteer.</div>
        <div className="inc-list">
          {state.incidents.map((i) => {
            const t = taskOf(i.id)
            const K = t ? TASK_KIND[t.type] : null
            const status = t ? t.status : 'NONE'
            return (
              <button key={i.id} className="inc-row" onClick={() => onSelect(i.id)}>
                <span className="inc-glyph" style={{ background: STATUS_COLOR[status] }} aria-hidden>{K ? <K.icon size={16} /> : <Waves size={16} />}</span>
                <span className="grow">
                  <b>{t ? t.title : i.type?.replace(/_/g, ' ')}</b>
                  <span className="muted block">{i.location_text}</span>
                </span>
                <span className="inc-meta">
                  <span className="src-icons">{(i.sources ?? []).map((s) => { const S = SOURCES[s]; return S ? <S.icon key={s} size={14} aria-label={S.label} style={{ color: S.color }} /> : null })}</span>
                  <span className={`status-tag s-${status.toLowerCase()}`}>{STATUS_LABEL[status] ?? status}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  )
}

// ---------------- Incident: synthesis + dispatch story ----------------
type Detail = { incident: any; observations: any[]; links: any[]; proposals: any[]; tasks: any[] }

function IncidentPanel({ id, state, task, decision, candidates, stage, now, busy, onDispatch, onBack }: {
  id: number; state: State; task: State['tasks'][number] | null; decision: Activity | null; candidates: Candidate[] | null
  stage: number; now: Date | null; busy: boolean; onDispatch: () => void; onBack: () => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  useEffect(() => { get<Detail>(`/incidents/${id}`).then(setD) }, [id, task?.id])
  const inc = state.incidents.find((i) => i.id === id)
  const assignment = task ? state.assignments.filter((a) => a.task_id === task.id).slice(-1)[0] : undefined
  const vol = assignment && state.volunteers.find((v) => v.id === assignment.volunteer_id)
  const arrived = task && state.activity.some((a) => a.kind === 'arrived' && a.data?.task_id === task.id)
  const proposal = d?.proposals.slice(-1)[0]
  const ready = state.demo.phase === 'ready'
  const matchRef = useRef<HTMLElement>(null)
  const missionRef = useRef<HTMLElement>(null)
  useEffect(() => { if (stage > 0) matchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [stage])
  useEffect(() => { missionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [assignment?.status, arrived])
  if (!inc) return null
  const K = task ? TASK_KIND[task.type] : null

  return (
    <div className="incident">
      <button className="back" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All incidents</button>
      <div className="eyebrow">{K ? K.label : 'Hazard report'} · incident #{inc.id}{task ? ` · priority ${Math.round(task.priority)}` : ''}</div>
      <h2>{task?.title ?? inc.type?.replace(/_/g, ' ')}</h2>
      <div className="where"><MapPin size={15} aria-hidden /> {inc.location_text}</div>

      <section className="card synth">
        <div className="step-title"><span className="step-n">1</span> {d?.observations.length ?? inc.n_obs} source{inc.n_obs === 1 ? '' : 's'} → AI synthesis → task</div>
        {d?.observations.map((o, i) => {
          const s = SOURCES[o.source_type]
          const Icon = s?.icon ?? MessageSquareQuote
          const link = d.links.find((l) => l.observation_id === o.id)
          const ex = o.extracted ?? {}
          return (
            <div key={o.id} className="src-card reveal" style={{ animationDelay: `${i * 450}ms`, borderLeftColor: s?.color ?? 'var(--line-strong)' }}>
              <div className="src-head">
                <span><Icon size={14} aria-hidden style={{ color: s?.color }} /> {s?.label ?? o.source_type}{o.raw?.reporter ? ` · ${o.raw.reporter}` : o.raw?.agency ? ` · ${o.raw.agency}` : ''}</span>
                <span className="num">{fmtTime(o.observed_at)}</span>
              </div>
              <div className="src-text">“{o.raw?.text || o.raw?.transcript || ex.summary}”</div>
              <div className="ai-line"><BrainCircuit size={14} aria-hidden /> <b>{o.category}</b>{o.subtype ? ` / ${o.subtype.replace(/_/g, ' ')}` : ''}
                {ex.needs?.length > 0 && <> · needs {ex.needs.join(', ').replace(/_/g, ' ')}</>}
                {ex.vulnerability_flags?.length > 0 && <> · {ex.vulnerability_flags.join(', ').replace(/_/g, ' ')}</>}
                {o.confidence != null && <> · confidence {(+o.confidence).toFixed(2)}</>}</div>
              {link && (
                <div className={`link-line ${link.decision}`} title={link.reasoning}>
                  <Link2 size={13} aria-hidden /> {link.decision === 'ATTACH' ? 'Merged into the same incident' : 'Opened a new incident'}: <span className="muted">{link.reasoning}</span>
                </div>
              )}
            </div>
          )
        })}
        {d && (
          <div className="reveal" style={{ animationDelay: `${d.observations.length * 450 + 200}ms` }}>
            <div className="arrow"><ArrowDown size={14} aria-hidden /> LLM proposes · code guardrails validate</div>
            {task ? (
              <div className="task-card">
                <div className="row-between">
                  <span className="pill" style={{ background: STATUS_COLOR[task.status] }}>{K?.label ?? task.type}</span>
                  <span className="muted num">urgency {task.urgency} · priority {Math.round(task.priority)}</span>
                </div>
                <b className="task-title">{task.title}</b>
                <div>{task.description}</div>
                <Reqs r={task.requirements} />
                <div className="reason"><Sparkles size={14} aria-hidden /> {task.proposal_reasoning}</div>
                {proposal?.validator_notes && <div className="muted"><ShieldCheck size={14} aria-hidden /> {proposal.validator_notes}</div>}
              </div>
            ) : (
              <div className="task-card none">
                <b>No volunteer task</b>
                <div className="reason"><Sparkles size={14} aria-hidden /> {proposal?.proposal?.reasoning ?? 'Hazard information only. It adjusts routing and priority but never invents a human need.'}</div>
                {proposal?.validator_notes && <div className="muted"><ShieldCheck size={14} aria-hidden /> {proposal.validator_notes}</div>}
              </div>
            )}
          </div>
        )}
      </section>

      {task && (
        <section className="card" ref={matchRef}>
          <div className="step-title"><span className="step-n">2</span> Match a volunteer</div>
          {!decision && (
            <button className="btn primary big" disabled={busy || !ready || !['OPEN', 'BLOCKED'].includes(task.status)} onClick={onDispatch}>
              {busy ? <Loader2 size={18} className="spin" aria-hidden /> : <Search size={18} aria-hidden />} {busy ? 'Matching…' : 'Find the best volunteer'}</button>
          )}
          {decision && candidates && <CandidateList candidates={candidates} stage={stage} />}
          {decision?.kind === 'escalation' && <div className="alert bad-card"><OctagonAlert size={18} aria-hidden /><span>{decision.message}</span></div>}
        </section>
      )}

      {task && stage >= 4 && assignment && vol && (
        <section className="card" ref={missionRef}>
          <div className="step-title"><span className="step-n">3</span> Mission</div>
          <Steps assignment={assignment} arrived={!!arrived} done={task.status === 'COMPLETED'} />
          {assignment.status === 'OFFERED' && (
            <>
              <div className="line-icon"><Smartphone size={16} aria-hidden /> Offer sent to <b>{vol.name}</b> in Fieldline. Waiting for them to accept.</div>
              <a className="btn primary big" href={fieldlineUrl(vol.id)} target="fieldline">Open {vol.name.split(' ')[0]}'s phone</a>
            </>
          )}
          {assignment.status === 'ACCEPTED' && <EnRoute a={assignment} name={vol.name} now={now} arrived={!!arrived} />}
          {assignment.status === 'RELEASED' && <div className="muted">{vol.name} declined; the system re-matched.</div>}
          {task.status === 'COMPLETED' && <div className="ok line-icon"><CheckCircle2 size={16} aria-hidden /> {vol.name} marked it done at the address. Incident resolved.</div>}
        </section>
      )}
    </div>
  )
}

function Reqs({ r }: { r: any }) {
  if (!r) return null
  const chips = [
    r.vehicle && 'vehicle', r.high_clearance && 'high clearance', r.min_capacity_gal > 0 && `≥ ${r.min_capacity_gal} gal cargo`,
    r.min_seats > 0 && `≥ ${r.min_seats} seats`, ...(r.skills ?? []).map((s: string) => `skill: ${s.replace(/_/g, ' ')}`),
    ...(r.equipment ?? []).map((s: string) => `has ${s.replace(/_/g, ' ')}`),
  ].filter(Boolean)
  return (
    <div className="reqs">
      {chips.length > 0 && <div><span className="muted">Hard requirements </span>{chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>}
      {r.supplies?.length > 0 && <div><span className="muted">Bring </span>{r.supplies.join(', ')}</div>}
    </div>
  )
}

function CandidateList({ candidates, stage }: { candidates: Candidate[]; stage: number }) {
  const out = candidates.filter((c) => c.role === 'skipped' || c.role === 'unreachable')
  const far = candidates.filter((c) => c.role === 'farther')
  const ranked = candidates.filter((c) => ['chosen', 'alternative'].includes(c.role)).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const chosen = ranked.find((c) => c.role === 'chosen')
  return (
    <div className="cands">
      <div className="cand-sum"><Search size={14} aria-hidden /> {candidates.length} available volunteers nearby <span className="muted">(click any on the map for their profile)</span></div>
      {stage >= 2 && out.length > 0 && (
        <div className="reveal">
          <div className="cand-group"><X size={13} aria-hidden /> {out.length} ruled out</div>
          {out.map((c) => <div key={c.id} className="cand out"><b>{c.name}</b> <span className="muted">{(c.dist_m / 1000).toFixed(1)} km · {(c.reasons ?? []).join('; ')}</span></div>)}
          {far.length > 0 && <div className="muted">+ {far.length} capable but farther away (not routed): {far.map((c) => c.name.split(' ')[0]).join(', ')}</div>}
        </div>
      )}
      {stage >= 3 && (
        <div className="reveal">
          <div className="cand-group"><ListChecks size={13} aria-hidden /> {ranked.length} can do it, ranked by road travel time</div>
          {ranked.map((c) => (
            <div key={c.id} className={`cand ${stage >= 4 && c.role === 'chosen' ? 'chosen' : 'alt'}`}>
              <b>#{c.rank} {c.name}</b> <span className="muted num">{mins(c.eta_s)}{c.mode === 'walk' ? ' on foot' : ''} · {(c.dist_m / 1000).toFixed(1)} km straight-line</span>
            </div>
          ))}
        </div>
      )}
      {stage >= 4 && chosen && <div className="chosen-banner reveal"><Target size={16} aria-hidden /> Selected <b>{chosen.name}</b>: fastest capable volunteer, {mins(chosen.eta_s)} by road.</div>}
    </div>
  )
}

function Steps({ assignment, arrived, done }: { assignment: any; arrived: boolean; done: boolean }) {
  const st = assignment.status
  const steps = [
    ['Offer sent', true],
    ['Accepted', ['ACCEPTED', 'DONE'].includes(st)],
    ['On scene', arrived || st === 'DONE'],
    ['Done', done],
  ] as const
  return <div className="steps">{steps.map(([l, ok], i) => <div key={l} className={`stp ${ok ? 'done' : ''}`}><span>{ok ? <Check size={13} strokeWidth={3} aria-hidden /> : i + 1}</span>{l}</div>)}</div>
}

function EnRoute({ a, name, now, arrived }: { a: any; name: string; now: Date | null; arrived: boolean }) {
  const elapsed = now ? (now.getTime() - new Date(a.updated_at).getTime()) / 1000 : 0
  const left = Math.max(0, a.eta_s - elapsed)
  const pct = arrived ? 100 : Math.min(100, (100 * elapsed) / Math.max(1, a.eta_s))
  return (
    <div className="enroute">
      {arrived ? <div className="line-icon"><MapPin size={16} aria-hidden /> <b>{name}</b> is on scene.</div>
        : <div className="line-icon"><Navigation size={16} aria-hidden /> <b>{name}</b> accepted and is on the way · <b className="num">{mins(left)}</b> left</div>}
      <div className="progress big"><i style={{ width: `${pct}%` }} /></div>
      <div className="muted">Live position from their phone's GPS in Fieldline.</div>
    </div>
  )
}

function Log({ activity }: { activity: Activity[] }) {
  const rows = activity.filter((a) => LOG_KINDS.has(a.kind))
  if (!rows.length) return <p className="muted empty-note">Nothing yet. Every decision the system makes shows up here.</p>
  return (
    <>
      {rows.map((a, i) => {
        const Icon = KIND_ICON[a.kind] ?? ChevronRight
        return (
          <div key={`${a.at}-${i}`} className={`feed k-${a.kind}`}>
            <div className="feed-head"><span><Icon size={13} aria-hidden /> {a.kind.replace('_', ' ')}</span><span className="num">{fmtTime(a.at)}</span></div>
            <div className="feed-msg">{a.message.replace(/^[^\p{L}\p{N}#]+/u, '')}</div>
          </div>
        )
      })}
    </>
  )
}
