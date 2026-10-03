import { useEffect, useMemo, useState } from 'react'
import MapView, { STATUS_COLOR } from '../MapView'
import { fmtTime, get, useLiveState, useSimClock, type Activity } from '../api'

const KIND_ICON: Record<string, string> = {
  extract: '🧠', incident_link: '🔗', task_created: '📋', task_proposal: '💭', validator_reject: '🛡',
  match: '🎯', accept: '✔', road: '🚧', adaptation: '⚠', reroute: '↻', reassign: '⇄', escalation: '🚨',
  verified: '✅', rejected: '✖', resolved: '🏁', sensor: '🌊', locate_failed: '❓', error: '💥',
}
const HIGHLIGHT = new Set(['task_created', 'match', 'reroute', 'reassign', 'escalation', 'verified', 'validator_reject', 'adaptation'])

export default function Command() {
  const { state } = useLiveState()
  const now = useSimClock(state?.clock)
  const [tab, setTab] = useState<'feed' | 'tasks'>('feed')
  const [selected, setSelected] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'decisions'>('decisions')

  const counts = useMemo(() => {
    const t = state?.tasks ?? []
    return {
      incidents: state?.incidents.filter((i) => i.status === 'OPEN').length ?? 0,
      active: t.filter((x) => !['VERIFIED'].includes(x.status)).length,
      verified: t.filter((x) => x.status === 'VERIFIED').length,
      closures: new Set(state?.closures.map((c) => c.name)).size,
      volunteers: state?.volunteers.filter((v) => v.available).length ?? 0,
    }
  }, [state])

  const ghost = useMemo(() => state?.activity.find((a) => a.kind === 'reroute' && a.data?.old_route)?.data.old_route ?? null, [state?.activity])
  const feed = (state?.activity ?? []).filter((a) => filter === 'all' || HIGHLIGHT.has(a.kind) || a.kind === 'extract' || a.kind === 'incident_link' || a.kind === 'road')

  return (
    <div className="command">
      <div className="map-wrap">
        <MapView state={state} onSelectTask={setSelected} ghostRoute={ghost} />
        <div className="legend">
          <span><i style={{ background: '#fbbf24' }} />Community report</span>
          <span><i style={{ background: '#f472b6' }} />Radio</span>
          <span><i style={{ background: '#60a5fa' }} />River gauge</span>
          <span><i className="bar" style={{ background: '#ef4444' }} />Closed road</span>
          <span><i style={{ background: '#34d399' }} />Volunteer</span>
          <span><i className="bar" style={{ background: '#22d3ee' }} />Active route</span>
          {ghost && <span><i className="bar" style={{ background: '#f87171' }} />Abandoned route</span>}
        </div>
      </div>
      <aside className="side">
        <header>
          <div>
            <h1>Helene Coordination</h1>
            <div className="sub">Buncombe County, NC · Command</div>
          </div>
          <div className="clock">
            <div className="clock-time">{now ? fmtTime(now) : '—'}</div>
            <div className="sub">{state?.clock.simulated ? `replay · ${state.clock.speed}×` : 'live'}</div>
          </div>
        </header>
        <div className="kpis">
          <div><b>{counts.incidents}</b><span>open incidents</span></div>
          <div><b>{counts.active}</b><span>active tasks</span></div>
          <div><b>{counts.verified}</b><span>verified</span></div>
          <div><b>{counts.closures}</b><span>closed roads</span></div>
          <div><b>{counts.volunteers}</b><span>volunteers</span></div>
        </div>
        <nav className="tabs">
          <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>Decision feed</button>
          <button className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>Tasks ({state?.tasks.length ?? 0})</button>
          {tab === 'feed' && (
            <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
              <option value="decisions">Key decisions</option>
              <option value="all">Everything</option>
            </select>
          )}
        </nav>
        <div className="scroll">
          {tab === 'feed' && feed.map((a, i) => <FeedItem key={`${a.at}-${i}`} a={a} onTask={setSelected} />)}
          {tab === 'tasks' && state?.tasks.map((t) => (
            <button key={t.id} className="task-row" onClick={() => setSelected(t.id)}>
              <span className="pill" style={{ background: STATUS_COLOR[t.status] }}>{t.status}</span>
              <span className="grow"><b>#{t.id}</b> {t.title}</span>
              <span className="prio">P{Math.round(t.priority ?? 0)}</span>
            </button>
          ))}
        </div>
      </aside>
      {selected != null && <TaskDrawer id={selected} onClose={() => setSelected(null)} version={state?.activity.length ?? 0} />}
    </div>
  )
}

function FeedItem({ a, onTask }: { a: Activity; onTask: (id: number) => void }) {
  return (
    <div className={`feed ${HIGHLIGHT.has(a.kind) ? 'hi' : ''} k-${a.kind}`} onClick={() => a.data?.task_id && onTask(a.data.task_id)}>
      <div className="feed-head"><span>{KIND_ICON[a.kind] ?? '•'} {a.kind.replace('_', ' ')}</span><span>{fmtTime(a.at)}</span></div>
      <div className="feed-msg">{a.message}</div>
    </div>
  )
}

function TaskDrawer({ id, onClose, version }: { id: number; onClose: () => void; version: number }) {
  const [d, setD] = useState<any>(null)
  useEffect(() => { get(`/tasks/${id}`).then(setD) }, [id, version])
  if (!d) return null
  const t = d.task
  return (
    <div className="drawer">
      <button className="x" onClick={onClose}>×</button>
      <div className="pill" style={{ background: STATUS_COLOR[t.status] }}>{t.status}</div>
      <h2>#{t.id} {t.title}</h2>
      <p className="muted">{t.type} · priority {Math.round(t.priority)} · urgency {t.urgency}</p>
      <p>{t.description}</p>
      <h3>Why this task exists</h3>
      <p className="reason">{t.proposal_reasoning}</p>
      <h3>Evidence chain ({d.observations.length} observations)</h3>
      {d.observations.map((o: any) => (
        <div key={o.id} className="mini"><b>{o.source_type}</b> · {o.category}/{o.subtype} · {fmtTime(o.observed_at)}<br />
          <span className="muted">{o.raw?.text || o.raw?.transcript || o.summary}</span></div>
      ))}
      {d.links.length > 0 && <><h3>Incident linking</h3>{d.links.map((l: any) => (
        <div key={l.id} className="mini"><b>{l.decision}</b> obs #{l.observation_id}: <span className="muted">{l.reasoning}</span></div>))}</>}
      <h3>Requirements</h3>
      <pre>{JSON.stringify(t.requirements, null, 1)}</pre>
      <h3>Assignments</h3>
      {d.assignments.map((a: any) => (
        <div key={a.id} className="mini"><b>#{a.id} {a.status}</b> volunteer {a.volunteer_id} · ETA {Math.round(a.eta_s / 60)} min<br /><span className="muted">{a.reason}</span></div>
      ))}
      <h3>Timeline</h3>
      {d.events.map((e: any, i: number) => (
        <div key={i} className="mini">{fmtTime(e.at)} · {e.from_status ?? '∅'} → <b>{e.to_status}</b><br /><span className="muted">{e.reason}</span></div>
      ))}
      {d.evidence.length > 0 && <><h3>Completion evidence</h3>{d.evidence.map((e: any) => (
        <div key={e.id} className="mini">
          {e.photo_path && <img src={`/api/uploads/${e.photo_path}`} className="evidence" />}
          <b className={e.verdict === 'VERIFIED' ? 'ok' : 'bad'}>{e.verdict}</b> — <span className="muted">{e.verdict_reasoning}</span>
        </div>))}</>}
    </div>
  )
}
