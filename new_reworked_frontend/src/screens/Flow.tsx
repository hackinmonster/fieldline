import { Link } from 'react-router-dom'
import { ArrowRight, CornerDownLeft } from 'lucide-react'

const STEPS: { n: string; name: string; src: string; does: string; system: string }[] = [
  { n: '01', name: 'Onboard', src: '/onboard/skills?demo', does: 'Phone, ID, vehicle, skills, gear, permissions.', system: 'POST /volunteers' },
  { n: '02', name: 'Map / Feed', src: '/map?scene=browse', does: 'Sees closures, flooding, requests that fit.', system: 'GET /state, WebSocket' },
  { n: '03', name: 'Task matched', src: '/map?scene=offer', does: 'Banner: you are needed nearby.', system: 'PostGIS KNN → filters → road ETA' },
  { n: '04', name: 'Notification', src: '/lock?scene=offer', does: 'Same offer on a locked phone.', system: 'assignment OFFERED' },
  { n: '05', name: 'Review task', src: '/task/1?scene=offer', does: 'What, where, who asked, why you, safety.', system: 'task + incident sources' },
  { n: '06', name: 'Accept', src: '/active?scene=active', does: 'One tap; route starts drawing.', system: 'POST /assignments/:id/accept' },
  { n: '07', name: 'Navigate / perform', src: '/active?scene=arrived', does: 'Turns, reroute notice, checklist. At the door: Yes, I did it.', system: 'closure-aware routing' },
  { n: '08', name: 'Complete + verify', src: '/done?scene=done', does: 'One tap. The backend checks your GPS is within 200 m.', system: 'POST /assignments/:id/complete' },
  { n: '09', name: 'Back to map', src: '/map?scene=done', does: 'Next best match.', system: 'matcher.retry_unassigned' },
]

/** User-flow overview: every step rendered live at phone size, in order. */
export default function Flow() {
  return (
    <div className="flow-page">
      <header className="flow-head">
        <div className="cap-brand"><img src="/mark.svg" alt="" width={28} height={28} /> Fieldline</div>
        <h1 className="display-l">From sign-up to a finished delivery</h1>
        <p className="lede">Jordan Reyes, pickup truck, Sep 29 2024. A family in Charlotte texts that their parents on Bee Tree Rd have no water. Every frame below is the running app, staged at that step.</p>
        <nav className="flow-links"><Link to="/map">Open the app</Link><Link to="/kit">Components</Link></nav>
      </header>

      <ol className="flow-track">
        {STEPS.map((s, i) => (
          <li key={s.n} className="flow-step">
            <div className="flow-label">
              <span className="flow-n num">{s.n}</span>
              <span className="flow-name">{s.name}</span>
            </div>
            <div className="flow-frame">
              <iframe src={`${s.src}${s.src.includes('?') ? '&' : '?'}embed`} title={s.name} loading="lazy" tabIndex={-1} />
            </div>
            <p className="flow-does">{s.does}</p>
            <p className="flow-system mono">{s.system}</p>
            {i < STEPS.length - 1 && <ArrowRight className="flow-arrow" size={22} aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="flow-loop"><CornerDownLeft size={18} aria-hidden /> Step 09 loops back to step 02. Declining at step 05 sends the request to the next nearest volunteer who fits.</p>
    </div>
  )
}
