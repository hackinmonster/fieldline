export const API = '/api'

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.text()
    let detail = body
    try { detail = JSON.parse(body).detail ?? body } catch { /* plain text */ }
    throw new Error(`${r.status}: ${detail || r.statusText}`)
  }
  return r.json()
}

export async function get<T = any>(path: string, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController()
  const t = window.setTimeout(() => ctl.abort(), timeoutMs)
  try {
    return await handle<T>(await fetch(API + path, { signal: ctl.signal }))
  } finally {
    window.clearTimeout(t)
  }
}

export async function post<T = any>(path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData
  return handle<T>(await fetch(API + path, {
    method: 'POST',
    headers: form ? undefined : { 'content-type': 'application/json' },
    body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

export function openSocket(onMessage: (msg: { event: string; data: any }) => void, onStatus: (up: boolean) => void) {
  let ws: WebSocket | null = null
  let closed = false
  let retry: number | undefined
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => onStatus(true)
    ws.onmessage = (m) => onMessage(JSON.parse(m.data))
    ws.onclose = () => {
      onStatus(false)
      if (!closed) retry = window.setTimeout(connect, 1500)
    }
  }
  connect()
  return () => { closed = true; window.clearTimeout(retry); ws?.close() }
}
