import type { ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { StoreProvider, useStore } from './lib/store'
import { Device, OfferBanner, OfflineBanner, StatusBar, TabBar } from './components/Shell'
import Welcome from './screens/Welcome'
import Identity from './screens/Identity'
import Skills from './screens/Skills'
import Permissions from './screens/Permissions'
import MapScreen from './screens/MapScreen'
import Feed from './screens/Feed'
import Tasks from './screens/Tasks'
import Lock from './screens/Lock'
import TaskReview from './screens/TaskReview'
import Active from './screens/Active'
import Done from './screens/Done'
import Profile from './screens/Profile'
import Flow from './screens/Flow'
import Kit from './screens/Kit'

const SCREENS: { path: string; name: string; note: string }[] = [
  { path: '/welcome', name: 'Sign in', note: 'Phone number or roster sign-in. Shows what is happening right now before asking for anything.' },
  { path: '/onboard/identity', name: 'Identity', note: 'Driver license or an organization roster. Residents trust a verified name at the door.' },
  { path: '/onboard/skills', name: 'Skills & equipment', note: 'The same fields the matcher filters on. The count of requests you qualify for updates as you tap.' },
  { path: '/onboard/permissions', name: 'Location & alerts', note: 'Location powers matching and evidence checks. Alerts are how offers reach you.' },
  { path: '/map', name: 'Disaster map', note: 'Home. Your best match as a field tag, NCDOT closures, gauges, the shelters reports mention. Swipe up for every request.' },
  { path: '/feed', name: 'Situation feed', note: 'Reports from residents, radio, NCDOT, USGS and volunteers. Every post can open its spot on the map.' },
  { path: '/tasks', name: 'Matched tasks', note: 'Your offer, then requests ranked by fit, urgency and distance, with the reason each one does or does not fit.' },
  { path: '/lock', name: 'Notification', note: 'What the offer looks like on a locked phone.' },
  { path: '/active', name: 'Active task', note: 'Next maneuver, route around closures, checklist, contact. At the address, one tap: Yes, I did it. The backend checks your GPS is within 200 m.' },
  { path: '/profile', name: 'Profile', note: 'Capability tag, verification, availability, history.' },
]

function Caption() {
  const loc = useLocation()
  const { mode } = useStore()
  const cur = SCREENS.find((s) => loc.pathname.startsWith(s.path)) ??
    (loc.pathname.startsWith('/task/') ? { name: 'Task invitation', note: 'Everything needed to say yes or no: what, where, why you, safety, time.' } :
      loc.pathname === '/done' ? { name: 'Completion', note: 'The receipt: what was done, where, when.' } : null)
  return (
    <>
      <div className="cap-brand"><img src="/mark.svg" alt="" width={28} height={28} /> Fieldline</div>
      <p className="cap-lede">Volunteer app for the Helene coordination backend. Buncombe County, NC, Sep 29 2024.</p>
      <p className="cap-mode">{mode === 'live' ? 'Connected to the backend.' : mode === 'demo' ? 'Backend not reachable: running on the bundled demo snapshot (real NCDOT closures and USGS gauges, scripted requests).' : 'Connecting…'}</p>
      {cur && <div className="cap-now"><div className="cap-now-name">{cur.name}</div><p>{cur.note}</p></div>}
      <nav className="cap-nav" aria-label="Jump to screen">
        {SCREENS.map((s) => <Link key={s.path} to={s.path} className={loc.pathname.startsWith(s.path) ? 'is-on' : ''}>{s.name}</Link>)}
        <Link to="/task/10">Task invitation</Link>
        <Link to="/done">Completion</Link>
        <span className="cap-sep" />
        <a href="/map?scene=offer">Stage: offer arrives</a>
        <a href="/active?scene=active">Stage: driving</a>
        <a href="/active?scene=arrived">Stage: at the door</a>
        <span className="cap-sep" />
        <Link to="/flow">User flow</Link>
        <Link to="/kit">Components</Link>
      </nav>
    </>
  )
}

function Gate({ children }: { children: ReactNode }) {
  const { profile } = useStore()
  return profile.onboarded ? <>{children}</> : <Navigate to="/welcome" replace />
}

const EMBED = new URLSearchParams(location.search).has('embed')

function Phone() {
  const loc = useLocation()
  const tabs = ['/map', '/feed', '/tasks', '/profile'].some((p) => loc.pathname.startsWith(p))
  return (
    <Device caption={EMBED ? undefined : <Caption />} embed={EMBED}>
      {loc.pathname !== '/lock' && <StatusBar />}
      <OfflineBanner />
      <OfferBanner />
      <div className={`screen${tabs ? ' has-tabs' : ''}`}>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/onboard/identity" element={<Identity />} />
          <Route path="/onboard/skills" element={<Skills />} />
          <Route path="/onboard/permissions" element={<Permissions />} />
          <Route path="/map" element={<Gate><MapScreen /></Gate>} />
          <Route path="/feed" element={<Gate><Feed /></Gate>} />
          <Route path="/tasks" element={<Gate><Tasks /></Gate>} />
          <Route path="/profile" element={<Gate><Profile /></Gate>} />
          <Route path="/lock" element={<Gate><Lock /></Gate>} />
          <Route path="/task/:id" element={<Gate><TaskReview /></Gate>} />
          <Route path="/active" element={<Gate><Active /></Gate>} />
          <Route path="/verify" element={<Navigate to="/active" replace />} />
          <Route path="/done" element={<Gate><Done /></Gate>} />
          <Route path="*" element={<Navigate to="/map" replace />} />
        </Routes>
      </div>
      {tabs && <TabBar />}
    </Device>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/flow" element={<Flow />} />
          <Route path="/kit" element={<Kit />} />
          <Route path="*" element={<Phone />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  )
}
