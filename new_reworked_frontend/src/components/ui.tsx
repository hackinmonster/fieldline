import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Info, Loader2, OctagonAlert, type LucideIcon } from 'lucide-react'
import { urgencyBand } from '../lib/vocab'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  size?: 'md' | 'lg'
  icon?: LucideIcon
  busy?: boolean
  block?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, busy, block, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''} ${className}`}>
      {busy ? <Loader2 className="spin" size={18} aria-hidden /> : Icon && <Icon size={size === 'lg' ? 20 : 18} aria-hidden />}
      <span>{children}</span>
    </button>
  )
}

export function IconButton({ icon: Icon, label, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button {...rest} aria-label={label} title={label} className={`icon-btn ${className}`}>
      <Icon size={20} aria-hidden />
    </button>
  )
}

export type Tone = 'neutral' | 'route' | 'caution' | 'danger' | 'done'

export function Chip({ tone = 'neutral', icon: Icon, children, solid }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; solid?: boolean }) {
  return (
    <span className={`chip chip-${tone}${solid ? ' chip-solid' : ''}`}>
      {Icon && <Icon size={14} strokeWidth={2.5} aria-hidden />}
      {children}
    </span>
  )
}

export function UrgencyChip({ urgency, solid }: { urgency: number; solid?: boolean }) {
  const b = urgencyBand(urgency)
  const tone: Tone = b.key === 'urgent' ? 'danger' : b.key === 'soon' ? 'caution' : 'neutral'
  const icon = b.key === 'urgent' ? OctagonAlert : b.key === 'soon' ? AlertTriangle : Clock
  return <Chip tone={tone} icon={icon} solid={solid}>{b.label}</Chip>
}

export function Toggle({ checked, onChange, label, sub, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <label className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {sub && <span className="toggle-sub">{sub}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  )
}

export function Alert({ tone = 'route', title, children, action }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'danger' ? OctagonAlert : tone === 'caution' ? AlertTriangle : tone === 'done' ? CheckCircle2 : Info
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden className="alert-icon" />
      <div className="alert-body">
        <div className="alert-title">{title}</div>
        {children && <div className="alert-text">{children}</div>}
        {action && <div className="alert-action">{action}</div>}
      </div>
    </div>
  )
}

export function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={28} aria-hidden className="empty-icon" />
      <div className="empty-title">{title}</div>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 18}%` }} />)}
    </div>
  )
}

export function ScreenHeader({ title, back, right, sub }: { title: string; back?: string | true; right?: ReactNode; sub?: ReactNode }) {
  const nav = useNavigate()
  return (
    <header className="screen-head">
      {back && <IconButton icon={ArrowLeft} label="Back" onClick={() => (back === true ? nav(-1) : nav(back))} />}
      <div className="screen-head-text">
        <h1>{title}</h1>
        {sub && <div className="screen-head-sub">{sub}</div>}
      </div>
      {right}
    </header>
  )
}

export function Steps({ at, total }: { at: number; total: number }) {
  return (
    <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={at} aria-label={`Step ${at} of ${total}`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < at ? 'is-on' : ''} />)}
      <span className="steps-label">{at} of {total}</span>
    </div>
  )
}
