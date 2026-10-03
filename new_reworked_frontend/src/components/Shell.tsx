import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ClipboardList, Map as MapIcon, Newspaper, UserRound, Navigation, X, WifiOff } from 'lucide-react'
import { useStore } from '../lib/store'
import { meters } from '../lib/geo'
import { miles, minutes } from '../lib/format'
import { TASK_KIND } from '../lib/vocab'

const TABS = [
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/feed', label: 'Feed', icon: Newspaper },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/profile', label: 'Profile', icon: UserRound },
]

/** Phone-sized viewport. On a desktop it is framed at 390 × 844 with a caption; on a phone it is the whole screen. */
export function Device({ children, caption, embed }: { children: ReactNode; caption?: ReactNode; embed?: boolean }) {
  if (embed) return <div className="device-screen is-embed">{children}</div>
  return (
    <div className="stage">
      <div className="device">
        <div className="device-screen">{children}</div>
      </div>
      {caption && <aside className="stage-caption">{caption}</aside>}
    </div>
  )
}

export function StatusBar() {
  const { now, mode, socketUp } = useStore()
  return (
    <div className="statusbar" aria-hidden>
      <span className="num">{now ? now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '') : '9:41'}</span>
      <span className="statusbar-mode">
        {mode === 'live' ? (socketUp ? 'LIVE' : 'RECONNECTING') : ''}
      </span>
      <span className="statusbar-icons"><i /><i /><i /><b /></span>
    </div>
  )
}

export function TabBar() {
  const { assignment } = useStore()
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          <span className="tab-icon">
            <Icon size={22} aria-hidden />
            {to === '/tasks' && assignment && <span className="tab-dot" aria-label="You have a task" />}
          </span>
          <span className="tab-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

/** "You are needed nearby": slides in from the top on any tab when a new offer arrives. */
export function OfferBanner() {
  const { offer, dismissOffer, snap, me } = useStore()
  const nav = useNavigate()
  const loc = useLocation()
  const t = offer && snap?.tasks.find((x) => x.id === offer.task_id)
  const [shown, setShown] = useState(false)
  useEffect(() => { setShown(!!t) }, [t])
  if (!offer || !t || loc.pathname.startsWith('/task/') || loc.pathname === '/lock') return null
  const K = TASK_KIND[t.type]
  const d = me ? meters([me.lon, me.lat], [t.lon, t.lat]) : null
  return (
    <div className={`offer-banner${shown ? ' is-in' : ''}`} role="alert">
      <button className="offer-main" onClick={() => { dismissOffer(); nav(`/task/${t.id}`) }}>
        <span className="offer-icon"><K.icon size={20} aria-hidden /></span>
        <span className="offer-text">
          <span className="offer-kicker"><Navigation size={12} strokeWidth={2.75} aria-hidden /> You are needed nearby</span>
          <span className="offer-title">{t.title}</span>
          <span className="offer-meta num">{minutes(offer.eta_s)} drive{d != null && ` · ${miles(d)}`} · tap to review</span>
        </span>
      </button>
      <button className="offer-close" aria-label="Dismiss, review later from Tasks" onClick={dismissOffer}><X size={18} aria-hidden /></button>
    </div>
  )
}

export function OfflineBanner() {
  const { mode, socketUp } = useStore()
  if (mode !== 'live' || socketUp) return null
  return <div className="conn-banner" role="status"><WifiOff size={14} aria-hidden /> Connection lost. Retrying; your last view stays on screen.</div>
}
