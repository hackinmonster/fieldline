import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, ChevronUp, Layers as LayersIcon, LocateFixed, MessageSquarePlus, Search, TrafficCone, X } from 'lucide-react'
import { useStore } from '../lib/store'
import MapCanvas, { ALL_LAYERS, type Layers, type MapHandle, type RouteDraw } from '../components/MapCanvas'
import BottomSheet from '../components/BottomSheet'
import { Button, Chip, Empty, IconButton, Skeleton, UrgencyChip } from '../components/ui'
import ReportSheet from '../components/ReportSheet'
import { ledger, rank } from '../lib/match'
import { meters, type LonLat } from '../lib/geo'
import { ago, miles, minutes } from '../lib/format'
import { RESOURCE, TASK_KIND, isDone } from '../lib/vocab'
import type { Task } from '../lib/types'

// One resting height; dragging the sheet up hands off to the Tasks tab for the full list.
const SNAPS = [404, 700]

export default function MapScreen() {
  const { snap, me, assignment, task: myTask, now } = useStore()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const mapRef = useRef<MapHandle>(null)
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS)
  const [showLayers, setShowLayers] = useState(false)
  const [query, setQuery] = useState('')
  const [reporting, setReporting] = useState(false)
  const [resourceId, setResourceId] = useState<number | null>(null)

  const selectedId = params.get('task') ? Number(params.get('task')) : null
  const focusLon = params.get('lon'), focusLat = params.get('lat')
  const resource = resourceId != null ? snap?.resources?.find((r) => r.id === resourceId) ?? null : null

  const ranked = useMemo(() => rank(me, snap?.tasks ?? []).filter((r) => !isDone(r.task)), [me, snap])
  // The map shows exactly one task: one you were sent to (from search or the feed), else your own offer or task,
  // else the best match (fits you first, then urgency against distance).
  const best = ranked.find((r) => r.fits)?.task ?? ranked[0]?.task ?? null
  const shown = (selectedId != null ? snap?.tasks.find((t) => t.id === selectedId) : null) ?? myTask ?? best
  const isMine = !!shown && shown.id === myTask?.id
  const more = ranked.filter((r) => r.task.id !== shown?.id).length

  // Newest radio/NCDOT closure is the advisory pinned under the search bar.
  const advisory = useMemo(() => snap?.observations.find((o) => o.category === 'road' && (o.source_type === 'radio' || o.source_type === 'ncdot')), [snap])

  const route: RouteDraw = useMemo(() => {
    if (!shown) return null
    if (isMine && assignment?.route) return { line: assignment.route, kind: assignment.status === 'ACCEPTED' ? 'active' : 'offer' }
    if (me) return { line: { type: 'LineString', coordinates: [[me.lon, me.lat], [shown.lon, shown.lat]] }, kind: 'preview' }
    return null
  }, [shown, isMine, me, assignment])

  // Frame you and the one task above the sheet, whenever the shown task changes.
  useEffect(() => {
    if (!shown || !me || focusLon) return
    const coords = route && route.kind !== 'preview' ? route.line.coordinates as LonLat[] : [[me.lon, me.lat], [shown.lon, shown.lat]] as LonLat[]
    mapRef.current?.fit(coords, { bottom: SNAPS[0], top: 190 })
  }, [shown?.id, !!me, !!snap]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focusLon && focusLat) mapRef.current?.flyTo([Number(focusLon), Number(focusLat)], 14)
  }, [focusLon, focusLat, !!snap])

  const select = (id: number | null) => { setResourceId(null); setParams(id == null ? {} : { task: String(id) }) }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2 || !snap) return []
    const hits: { key: string; label: string; sub: string; go: () => void }[] = []
    for (const t of snap.tasks) if (!isDone(t) && `${t.title} ${t.description}`.toLowerCase().includes(q))
      hits.push({ key: `t${t.id}`, label: t.title, sub: TASK_KIND[t.type].label, go: () => select(t.id) })
    for (const r of snap.resources ?? []) if (`${r.name} ${r.detail}`.toLowerCase().includes(q))
      hits.push({ key: `r${r.id}`, label: r.name, sub: r.detail, go: () => { setResourceId(r.id); mapRef.current?.flyTo([r.lon, r.lat], 14) } })
    for (const c of snap.closures) if (c.name.toLowerCase().includes(q))
      hits.push({ key: `c${c.id}`, label: c.name, sub: 'Closed · NCDOT', go: () => mapRef.current?.fit(c.geometry.coordinates as LonLat[]) })
    return hits.slice(0, 6)
  }, [query, snap]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!snap) return <div className="map-loading"><Skeleton lines={4} /><p className="hint">Loading the map and current requests…</p></div>

  const eyebrow = isMine
    ? assignment?.status === 'ACCEPTED' ? 'Your task · in progress' : 'Offered to you'
    : selectedId != null && shown?.id !== best?.id ? 'Request' : 'Best match for you'

  return (
    <div className="map-screen">
      <MapCanvas ref={mapRef} snap={snap} me={me} layers={layers} selectedTaskId={shown?.id ?? null} mineTaskId={myTask?.id ?? null}
        route={route} filter={(t) => t.id === shown?.id} padBottom={SNAPS[0]}
        onSelectTask={() => undefined} onSelectResource={(id) => setResourceId(id)} />

      {/* Top: search, advisory */}
      <div className="map-top">
        <div className="search glass">
          <Search size={18} aria-hidden />
          <input aria-label="Search requests, roads and places" placeholder="Search roads, shelters, requests" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}
        </div>
        {results.length > 0 && (
          <ul className="search-results glass" role="listbox">
            {results.map((r) => (
              <li key={r.key}><button onClick={() => { r.go(); setQuery('') }}><b>{r.label}</b><span className="sub">{r.sub}</span></button></li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && results.length === 0 && <div className="search-results glass empty-line">Nothing matches “{query}”. Try a road name like “Bee Tree”.</div>}
        {advisory && (
          <button className="advisory" onClick={() => advisory.point && mapRef.current?.flyTo(advisory.point.coordinates as LonLat, 14.5)}>
            <TrafficCone size={16} aria-hidden />
            <span className="grow">{advisory.summary}</span>
            <span className="advisory-time">{ago(advisory.observed_at, now)}</span>
          </button>
        )}
      </div>

      {/* Right: controls */}
      <div className="map-controls" style={{ bottom: SNAPS[0] + 16 }}>
        <IconButton icon={LayersIcon} label="Layers and legend" className={`glass${showLayers ? ' is-on' : ''}`} onClick={() => setShowLayers(!showLayers)} />
        <IconButton icon={MessageSquarePlus} label="Report what you see" className="glass" onClick={() => setReporting(true)} />
        <IconButton icon={LocateFixed} label="Center on me" className="glass" onClick={() => mapRef.current?.recenter()} />
      </div>

      {showLayers && <LayerPanel layers={layers} setLayers={setLayers} onClose={() => setShowLayers(false)} />}

      <BottomSheet snaps={SNAPS} index={0} onIndex={(i) => { if (i > 0) nav('/tasks') }} label="Best match"
        header={resource ? null : <div className="sheet-head"><div className="eyebrow">{eyebrow}</div></div>}>
        {resource ? (
          <div className="sheet-pad">
            <div className="res-card">
              <span className="res-icon">{(() => { const I = RESOURCE[resource.kind].icon; return <I size={22} aria-hidden /> })()}</span>
              <div className="grow">
                <div className="eyebrow">{RESOURCE[resource.kind].label}</div>
                <h2 className="title-l">{resource.name}</h2>
                <p className="muted">{resource.detail}</p>
                <Chip tone={resource.status === 'open' ? 'done' : 'caution'}>{resource.status === 'open' ? 'Open' : 'Limited'}</Chip>
              </div>
              <IconButton icon={X} label="Close" onClick={() => setResourceId(null)} />
            </div>
          </div>
        ) : shown ? (
          <ShownTask task={shown} onClose={selectedId != null ? () => select(null) : undefined} />
        ) : (
          <Empty icon={Search} title="No open requests nearby">New requests appear here as they come in. You will get an alert when one fits you.</Empty>
        )}
        {!resource && (
          <button className="sheet-more" onClick={() => nav('/tasks')}>
            <ChevronUp size={18} aria-hidden />
            <span className="grow">{more ? <><b className="num">{more}</b> more request{more > 1 ? 's' : ''} nearby</> : 'All requests'}</span>
            <span className="sheet-more-hint">Swipe up</span>
          </button>
        )}
      </BottomSheet>

      {reporting && <ReportSheet onClose={() => setReporting(false)} />}
    </div>
  )
}

function ShownTask({ task: t, onClose }: { task: Task; onClose?: () => void }) {
  const { me, assignment, now } = useStore()
  const nav = useNavigate()
  const K = TASK_KIND[t.type]
  const mine = assignment?.task_id === t.id
  const dist = me ? meters([me.lon, me.lat], [t.lon, t.lat]) : null
  const lines = me ? ledger(me, t) : []
  const gaps = lines.filter((l) => !l.ok)
  return (
    <div className="selected">
      <div className="selected-head">
        <span className={`task-glyph lg u-${t.urgency >= 0.75 ? 'urgent' : t.urgency >= 0.5 ? 'soon' : 'routine'}`} aria-hidden><K.icon size={24} /></span>
        <div className="grow">
          <div className="eyebrow">{K.label} · reported {ago(t.created_at, now)}</div>
          <h2 className="title-l">{t.title}</h2>
        </div>
        {onClose && <IconButton icon={X} label="Back to best match" onClick={onClose} />}
      </div>
      <div className="selected-facts">
        <UrgencyChip urgency={t.urgency} solid />
        {dist != null && <span className="fact num"><b>{miles(dist)}</b> straight line</span>}
        {mine && assignment && <span className="fact num"><b>{minutes(assignment.eta_s)}</b> by road</span>}
      </div>
      {gaps.length === 0
        ? <p className="fit-line is-yes">{lines.length ? 'You meet every requirement' : 'No special requirements'}{t.requirements?.supplies?.length ? `. Bring: ${t.requirements.supplies.join(', ')}` : ''}.</p>
        : <p className="fit-line is-no">You are missing: {gaps.map((g) => g.label.toLowerCase()).join(', ')}.</p>}
      <Button variant="primary" size="lg" block icon={ArrowRight} onClick={() => nav(mine && assignment?.status === 'ACCEPTED' ? '/active' : `/task/${t.id}`)}>
        {mine ? (assignment?.status === 'ACCEPTED' ? 'Resume navigation' : 'Review offer') : 'Details'}
      </Button>
    </div>
  )
}

function LayerPanel({ layers, setLayers, onClose }: { layers: Layers; setLayers: (l: Layers) => void; onClose: () => void }) {
  const rows: { key: keyof Layers; label: string; swatch: string }[] = [
    { key: 'tasks', label: 'Requests', swatch: 'sw-tag' },
    { key: 'closures', label: 'Road closures (NCDOT, radio)', swatch: 'sw-closure' },
    { key: 'flood', label: 'Flooding reported', swatch: 'sw-flood' },
    { key: 'resources', label: 'Shelters, water, fuel, medical', swatch: 'sw-res' },
    { key: 'gauges', label: 'River gauges (USGS)', swatch: 'sw-gauge' },
    { key: 'volunteers', label: 'Other volunteers', swatch: 'sw-vol' },
    { key: 'reports', label: 'Raw reports', swatch: 'sw-report' },
  ]
  return (
    <div className="layer-panel glass" role="dialog" aria-label="Map layers">
      <div className="layer-head"><h2>Layers</h2><IconButton icon={X} label="Close layers" onClick={onClose} /></div>
      {rows.map((r) => (
        <label key={r.key} className="layer-row">
          <span className={`swatch ${r.swatch}`} aria-hidden />
          <span className="grow">{r.label}</span>
          <input type="checkbox" checked={layers[r.key]} onChange={(e) => setLayers({ ...layers, [r.key]: e.target.checked })} />
        </label>
      ))}
      <div className="legend-urgency">
        <span><i className="lg-u urgent" />Urgent</span><span><i className="lg-u soon" />Today</span><span><i className="lg-u routine" />When able</span><span><i className="lg-u fit" />Fits you</span>
      </div>
    </div>
  )
}
