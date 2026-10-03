import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Navigation, Search, ShieldCheck, X } from 'lucide-react'
import fixtureJson from '../data/fixture.json'
import type { Snapshot, Task } from '../lib/types'
import { Alert, Button, Chip, Empty, Skeleton, Steps, Toggle, UrgencyChip } from '../components/ui'
import TaskCard from '../components/TaskCard'
import FeedPost from '../components/FeedPost'
import { clusterBadge, gaugePill, mePuck, resourcePin, taskTag, volunteerDot } from '../components/markers'
import { TASK_STATUS_LABEL } from '../lib/vocab'

const fx = fixtureJson as unknown as Snapshot
const now = new Date(fx.clock.sim_now)
const task = (id: number) => fx.tasks.find((t) => t.id === id)!

function Html({ el }: { el: HTMLElement }) {
  return <span className="kit-marker" dangerouslySetInnerHTML={{ __html: el.outerHTML }} />
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="kit-group">
      <h2 className="kit-title">{title}</h2>
      {note && <p className="kit-note">{note}</p>}
      <div className="kit-row">{children}</div>
    </section>
  )
}

function Spec({ label, children }: { label: string; children: ReactNode }) {
  return <figure className="kit-spec"><div className="kit-spec-body">{children}</div><figcaption>{label}</figcaption></figure>
}

const COLORS = [
  ['--ink', 'Text, brand'], ['--ink-2', 'Secondary text'], ['--ink-3', 'Tertiary text'], ['--canvas', 'App background'], ['--surface', 'Cards, sheets'],
  ['--line', 'Dividers'], ['--route', 'Navigation, primary action'], ['--caution', 'Warnings, closures'], ['--danger', 'Urgent only'],
  ['--done', 'Done'], ['--water', 'Flood overlay'],
]

/** Component sheet: every reusable piece and its variants, rendered from the same code as the app. */
export default function Kit() {
  const [on, setOn] = useState(true)
  // Picked from the scenario fixture by role: urgent hero, 'today', 'when able', a ride, and one shown as done.
  const t1 = task(10), t2 = task(2), t3 = task(8), t5 = task(6), t10 = { ...task(5), status: 'COMPLETED' } as Task
  return (
    <div className="kit">
      <header className="flow-head">
        <div className="cap-brand"><img src="/mark.svg" alt="" width={28} height={28} /> Fieldline components</div>
        <p className="lede">Rendered from the app’s own components. Design rules live in <span className="mono">DESIGN.md</span>.</p>
        <nav className="flow-links"><Link to="/map">Open the app</Link><Link to="/flow">User flow</Link></nav>
      </header>

      <Group title="Color roles">
        {COLORS.map(([v, role]) => (
          <Spec key={v} label={`${v} · ${role}`}><span className="kit-swatch" style={{ background: `var(${v})` }} /></Spec>
        ))}
      </Group>

      <Group title="Type" note="Barlow Condensed for numbers and labels, Atkinson Hyperlegible Next for reading, JetBrains Mono for codes.">
        <div className="kit-type">
          <div className="display-xl">21 min</div>
          <div className="display-l">Drinking water for two residents</div>
          <div className="title-l">Turn left onto Bee Tree Rd</div>
          <p className="body-text">Deliver at least 10 gallons of drinking water to 1144 Bee Tree Rd. Well pump has been out since Friday.</p>
          <div className="mono">35.6319° N, 82.4128° W · 4821</div>
        </div>
      </Group>

      <Group title="Buttons" note="One primary per view. Large size for actions taken outdoors.">
        <Spec label="primary / lg"><Button variant="primary" size="lg" icon={Check}>Accept and navigate</Button></Spec>
        <Spec label="secondary"><Button>Decline</Button></Spec>
        <Spec label="quiet"><Button variant="quiet">Can’t finish</Button></Spec>
        <Spec label="danger"><Button variant="danger">Decline</Button></Spec>
        <Spec label="busy"><Button variant="primary" busy>Checking photo…</Button></Spec>
        <Spec label="disabled"><Button variant="primary" disabled>Submit for verification</Button></Spec>
        <Spec label="focus"><Button className="is-focus">Keyboard focus</Button></Spec>
      </Group>

      <Group title="Status chips" note="Color is always paired with an icon and a word.">
        <Spec label="urgency: urgent"><UrgencyChip urgency={0.86} /></Spec>
        <Spec label="urgency: today"><UrgencyChip urgency={0.6} /></Spec>
        <Spec label="urgency: when able"><UrgencyChip urgency={0.3} /></Spec>
        <Spec label="solid"><UrgencyChip urgency={0.86} solid /></Spec>
        <Spec label="done"><Chip tone="done" icon={ShieldCheck}>Done</Chip></Spec>
        <Spec label="route"><Chip tone="route" icon={Navigation}>Offered to you</Chip></Spec>
      </Group>

      <Group title="Task status">
        {Object.entries(TASK_STATUS_LABEL).map(([k, v]) => (
          <Spec key={k} label={k}><span className={`task-status-pill s-${k.toLowerCase()}`}>{v}</span></Spec>
        ))}
      </Group>

      <Group title="Map markers" note="Field tag = request. Fill is urgency, blue ring = you qualify, blue fill = offered to you.">
        <Spec label="tag · urgent"><Html el={taskTag(t1, { selected: false, mine: false, fits: false })} /></Spec>
        <Spec label="tag · today"><Html el={taskTag(t2, { selected: false, mine: false, fits: false })} /></Spec>
        <Spec label="tag · when able"><Html el={taskTag(t3, { selected: false, mine: false, fits: false })} /></Spec>
        <Spec label="tag · fits you"><Html el={taskTag(t5, { selected: false, mine: false, fits: true })} /></Spec>
        <Spec label="tag · selected"><Html el={taskTag(t2, { selected: true, mine: false, fits: true })} /></Spec>
        <Spec label="tag · offered to you"><Html el={taskTag(t1, { selected: false, mine: true, fits: true })} /></Spec>
        <Spec label="tag · done"><Html el={taskTag(t10, { selected: false, mine: false, fits: false })} /></Spec>
        <Spec label="cluster"><Html el={clusterBadge(6, 2)} /></Spec>
        <Spec label="cluster · none urgent"><Html el={clusterBadge(3, 0)} /></Spec>
        <Spec label="shelter"><Html el={resourcePin(fx.resources![1])} /></Spec>
        <Spec label="shelter · limited"><Html el={resourcePin(fx.resources![0])} /></Spec>
        <Spec label="gauge · flooding"><Html el={gaugePill(fx.sensors[1], false)} /></Spec>
        <Spec label="gauge · offline"><Html el={gaugePill(fx.sensors[0], true)} /></Spec>
        <Spec label="volunteer · free / busy / off"><span className="kit-inline"><Html el={volunteerDot(false, true)} /><Html el={volunteerDot(true, true)} /><Html el={volunteerDot(false, false)} /></span></Spec>
        <Spec label="you"><Html el={mePuck()} /></Spec>
        <Spec label="closure / route"><span className="kit-lines"><i className="sw-closure" /><i className="sw-route" /></span></Spec>
      </Group>

      <Group title="Task cards">
        <div className="kit-col">
          <TaskCard task={t1} distance_m={9300} fits />
          <TaskCard task={t3} distance_m={2100} fits={false} gaps={['Needs cleared for hazard checks']} />
          <TaskCard task={{ ...t1, status: 'ASSIGNED' } as Task} distance_m={9300} mine />
          <TaskCard task={t10} distance_m={9000} />
          <TaskCard task={t1} distance_m={9300} fits variant="feature" />
        </div>
      </Group>

      <Group title="Feed posts">
        <div className="kit-col">
          {['radio', 'resident', 'social', 'ngo', 'ncdot', 'usgs'].map((src) => fx.observations.find((o) => o.source_type === src)).filter((o) => !!o).map((o) => (
            <FeedPost key={o!.id} post={o!} now={now} distance_m={4200} onMap={() => undefined}
              linkedTask={o!.incident_id ? fx.tasks.find((t) => t.incident_id === o!.incident_id) ?? null : null} onTask={() => undefined} />
          ))}
        </div>
      </Group>

      <Group title="Alerts">
        <div className="kit-col">
          <Alert tone="route" title="Demo data">The backend is not reachable. Showing the saved snapshot.</Alert>
          <Alert tone="caution" title="Rerouted">Riverwood Rd bridge is washed out. New route adds 4 min.</Alert>
          <Alert tone="caution" title="Not marked done yet">Location check failed: 2300 m away, must be within 200 m of the task.</Alert>
          <Alert tone="done" title="Done">25 m from the address.</Alert>
        </div>
      </Group>

      <Group title="Notification">
        <div className="kit-col">
          <div className="offer-banner is-in is-static" role="presentation">
            <span className="offer-main"><span className="offer-icon"><Navigation size={20} /></span>
              <span className="offer-text"><span className="offer-kicker">You are needed nearby</span><span className="offer-title">{t1.title}</span><span className="offer-meta num">21 min drive · 5.8 mi · tap to review</span></span></span>
            <span className="offer-close"><X size={18} /></span>
          </div>
        </div>
      </Group>

      <Group title="Completion (location check)" note="No photos or codes. The volunteer taps once; the backend checks their GPS is within 200 m of the task.">
        <Spec label="GPS · within limit">
          <div className="gps-meter is-near kit-w"><div className="gps-row"><span className="gps-label">Your location</span><span className="gps-value num">25 m away</span></div>
            <div className="gps-bar"><span className="gps-fill" style={{ width: '4%' }} /><span className="gps-limit" style={{ left: '25%' }}><b>200 m</b></span></div></div>
        </Spec>
        <Spec label="GPS · too far">
          <div className="gps-meter kit-w"><div className="gps-row"><span className="gps-label">Your location</span><span className="gps-value num">1.4 mi away</span></div>
            <div className="gps-bar"><span className="gps-fill" style={{ width: '100%' }} /><span className="gps-limit" style={{ left: '25%' }}><b>200 m</b></span></div></div>
        </Spec>
        <Spec label="button · at the address"><Button variant="primary" size="lg" icon={Check}>Yes, I did it</Button></Spec>
        <Spec label="button · too far"><Button variant="primary" size="lg" icon={Check} disabled>Yes, I did it</Button></Spec>
      </Group>

      <Group title="Controls and states">
        <Spec label="toggle"><div className="kit-w"><Toggle checked={on} onChange={setOn} label="Available for offers" sub="Dispatch can offer you requests that fit." /></div></Spec>
        <Spec label="steps"><Steps at={2} total={3} /></Spec>
        <Spec label="field · error">
          <label className="field kit-w"><span className="field-label">Mobile number</span><input defaultValue="828 555" aria-invalid /><span className="field-error">Enter a 10-digit US number.</span></label>
        </Spec>
        <Spec label="loading"><div className="kit-w"><Skeleton /></div></Spec>
        <Spec label="empty"><div className="kit-w"><Empty icon={Search} title="Nothing matches this filter">Clear it to see every request.</Empty></div></Spec>
      </Group>
    </div>
  )
}
