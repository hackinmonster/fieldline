import { useState } from 'react'
import { CheckCircle2, MapPin, Send, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { Alert, Button, IconButton } from './ui'

const PROMPTS = [
  { id: 'need', label: 'Someone needs help', example: 'e.g. Neighbor at 22 Lytle Cove Rd is out of insulin and has no car' },
  { id: 'road', label: 'Road condition', example: 'e.g. Tree down across Old Fort Rd at the church, one lane open' },
  { id: 'resource', label: 'Supplies available', example: 'e.g. Fire station on Main has 40 cases of water, pick up until 5 PM' },
  { id: 'condition', label: 'Something else', example: 'e.g. Cell service back on Riceville Rd above the fire station' },
]

/** Volunteers as sensors: free text goes through the same AI ingestion path as resident and radio reports. */
export default function ReportSheet({ onClose }: { onClose: () => void }) {
  const { report, me } = useStore()
  const [kind, setKind] = useState(PROMPTS[0])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const send = async () => {
    if (text.trim().length < 12) { setErr('Add a few more words: what, and where exactly.'); return }
    setBusy(true); setErr(null)
    try { await report(text.trim()); setSent(true) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-label="Report what you see" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Report what you see</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        {sent ? (
          <div className="sent">
            <CheckCircle2 size={28} aria-hidden />
            <div><b>Report sent.</b><p className="muted">It will appear in the feed. If it describes a need, coordinators may turn it into a request.</p></div>
            <Button variant="primary" block onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <div className="segmented wrap" role="radiogroup" aria-label="What kind of report">
              {PROMPTS.map((p) => (
                <button key={p.id} role="radio" aria-checked={kind.id === p.id} className={kind.id === p.id ? 'is-on' : ''} onClick={() => setKind(p)}>{p.label}</button>
              ))}
            </div>
            <label className="field">
              <span className="field-label">What and where</span>
              <textarea rows={4} placeholder={kind.example} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!err} />
            </label>
            <p className="hint loc-hint"><MapPin size={14} aria-hidden /> {me ? 'Your current location is attached.' : 'No location attached. Include the address in the text.'}</p>
            {err && <Alert tone="danger" title="Not sent">{err}</Alert>}
            <Button variant="primary" size="lg" block icon={Send} busy={busy} onClick={send}>Send report</Button>
          </>
        )}
      </div>
    </div>
  )
}
