import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { get, mins, SOURCES, vehicleDesc, type Candidate, type State } from './api'

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
export const STATUS_COLOR: Record<string, string> = {
  NONE: '#64748b', OPEN: '#f5a524', ASSIGNED: '#4c8dff', EN_ROUTE: '#22d3ee', BLOCKED: '#ef4444',
  COMPLETED: '#22c55e',
}

export type LayerId = 'incidents' | 'social' | 'ngo' | 'resident' | 'radio' | 'roads' | 'weather' | 'gauges' | 'vulnerability' | 'volunteers'
export const LAYERS: { id: LayerId; label: string; color: string; kind: 'dot' | 'bar' | 'area'; group: string; sources?: string[] }[] = [
  { id: 'incidents', label: 'Incidents (AI-synthesized)', color: '#f5a524', kind: 'dot', group: 'Operational picture' },
  { id: 'volunteers', label: 'Volunteers', color: '#34d399', kind: 'dot', group: 'Operational picture' },
  { id: 'social', label: 'Social media posts', color: SOURCES.social.color, kind: 'dot', group: 'Incoming reports', sources: ['social'] },
  { id: 'ngo', label: 'NGO & shelter requests', color: SOURCES.ngo.color, kind: 'dot', group: 'Incoming reports', sources: ['ngo', 'shelter'] },
  { id: 'resident', label: 'SMS / hotline', color: SOURCES.resident.color, kind: 'dot', group: 'Incoming reports', sources: ['resident', 'volunteer'] },
  { id: 'radio', label: 'Public-safety radio', color: SOURCES.radio.color, kind: 'dot', group: 'Incoming reports', sources: ['radio'] },
  { id: 'roads', label: 'Road closures (NCDOT + radio)', color: '#ef4444', kind: 'bar', group: 'Conditions' },
  { id: 'weather', label: 'Helene track (NHC)', color: '#a855f7', kind: 'bar', group: 'Conditions' },
  { id: 'gauges', label: 'River gauges (USGS)', color: '#60a5fa', kind: 'dot', group: 'Conditions' },
  { id: 'vulnerability', label: 'Age 65+ share (Census)', color: '#6d4aa8', kind: 'area', group: 'Conditions' },
]
const OBS_LAYER_OF: Record<string, LayerId> = Object.fromEntries(LAYERS.flatMap((l) => (l.sources ?? []).map((s) => [s, l.id])))

const fc = (features: any[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const pt = (lon: number, lat: number, properties: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })
const line = (a: number[], b: number[], properties: any = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [a, b] }, properties })
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Map layer ids each toggle controls. */
const LAYER_MAP: Record<LayerId, string[]> = {
  incidents: ['incidents', 'incident-labels'],
  volunteers: ['volunteers'],
  social: ['obs-social'], ngo: ['obs-ngo'], resident: ['obs-resident'], radio: ['obs-radio'],
  roads: ['closures'],
  weather: ['storm-line', 'storm-points', 'storm-labels'],
  gauges: ['sensors', 'sensor-labels'],
  vulnerability: ['tracts-fill', 'tracts-line'],
}

type Props = {
  state: State | null
  layers: Record<LayerId, boolean>
  selectedIncidentId: number | null
  onSelectIncident: (id: number | null) => void
  candidates: Candidate[] | null
  stage: number            // candidate reveal: 0 none · 1 scan · 2 filter · 3 rank · 4 chosen
  storyTaskId: number | null
  focusVolunteerId?: number | null
}

export default function CommandMap(props: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: [-82.53, 35.62], zoom: 10.2, attributionControl: { compact: true } })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    m.on('load', () => {
      for (const id of ['tracts', 'storm', 'closures', 'observations', 'evidence', 'incidents', 'spokes', 'route', 'volunteers', 'candidates', 'sensors'])
        m.addSource(id, { type: 'geojson', data: fc([]) })

      // ---- context ----
      m.addLayer({ id: 'tracts-fill', type: 'fill', source: 'tracts', paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'pct_65plus'], 10, '#0b1220', 35, '#6d4aa8'], 'fill-opacity': 0.45 } })
      m.addLayer({ id: 'tracts-line', type: 'line', source: 'tracts', paint: { 'line-color': '#334155', 'line-width': 0.4 } })
      m.addLayer({ id: 'storm-line', type: 'line', source: 'storm', filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#a855f7', 'line-width': 3, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 } })
      m.addLayer({ id: 'storm-points', type: 'circle', source: 'storm', filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#a855f7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } })
      m.addLayer({ id: 'storm-labels', type: 'symbol', source: 'storm', filter: ['==', '$type', 'Point'], layout: {
        'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0.8, 0], 'text-anchor': 'left' },
        paint: { 'text-color': '#d8b4fe', 'text-halo-color': '#000', 'text-halo-width': 1 } })
      m.addLayer({ id: 'closures', type: 'line', source: 'closures', paint: { 'line-color': '#ef4444', 'line-width': 3.5, 'line-opacity': 0.9 } })
      m.addLayer({ id: 'sensors', type: 'circle', source: 'sensors', paint: {
        'circle-radius': 8, 'circle-color': ['case', ['>=', ['get', 'stage_ft'], ['get', 'flood_stage_ft']], '#2563eb', '#1e3a5f'],
        'circle-stroke-color': '#93c5fd', 'circle-stroke-width': 2 } })
      m.addLayer({ id: 'sensor-labels', type: 'symbol', source: 'sensors', layout: {
        'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top' },
        paint: { 'text-color': '#93c5fd', 'text-halo-color': '#000', 'text-halo-width': 1 } })

      // ---- incoming reports: one layer per source family; `sel` = belongs to selected incident (always shown) ----
      m.addLayer({ id: 'evidence', type: 'line', source: 'evidence',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } })
      for (const l of LAYERS.filter((x) => x.sources)) {
        m.addLayer({ id: `obs-${l.id}`, type: 'circle', source: 'observations', filter: ['==', ['get', 'layer'], l.id], paint: {
          'circle-radius': 5.5, 'circle-color': l.color, 'circle-stroke-color': '#0b0f17', 'circle-stroke-width': 1.5 } })
      }
      m.addSource('evidence-pts', { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'evidence-pts', type: 'circle', source: 'evidence-pts', paint: {
        'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })

      // ---- incidents ----
      m.addLayer({ id: 'incidents', type: 'circle', source: 'incidents', paint: {
        'circle-radius': ['case', ['get', 'selected'], 15, ['interpolate', ['linear'], ['get', 'priority'], 0, 7, 100, 12]],
        'circle-color': ['get', 'color'], 'circle-opacity': ['case', ['get', 'dim'], 0.35, 0.95],
        'circle-stroke-color': ['case', ['get', 'selected'], '#fff', '#0b0f17'], 'circle-stroke-width': ['case', ['get', 'selected'], 3, 2] } })
      m.addLayer({ id: 'incident-labels', type: 'symbol', source: 'incidents', minzoom: 11, layout: {
        'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-max-width': 14 },
        paint: { 'text-color': '#fde68a', 'text-halo-color': '#000', 'text-halo-width': 1.2, 'text-opacity': ['case', ['get', 'dim'], 0.4, 1] } })

      // ---- volunteers (ambient layer) ----
      m.addLayer({ id: 'volunteers', type: 'circle', source: 'volunteers', paint: {
        'circle-radius': 5, 'circle-color': '#34d399', 'circle-opacity': 0.8, 'circle-stroke-color': '#0b0f17', 'circle-stroke-width': 1.5 } })

      // ---- dispatch story: spokes, route, candidates ----
      m.addLayer({ id: 'spokes', type: 'line', source: 'spokes', paint: {
        'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.8 } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': ['match', ['get', 'status'], 'OFFERED', '#4c8dff', '#22d3ee'], 'line-width': 5,
        'line-opacity': ['match', ['get', 'status'], 'OFFERED', 0.55, 0.9] } })
      m.addLayer({ id: 'candidates-halo', type: 'circle', source: 'candidates', filter: ['==', ['get', 'role'], 'chosen'], paint: {
        'circle-radius': 18, 'circle-color': '#22c55e', 'circle-opacity': 0.25 } })
      m.addLayer({ id: 'candidates', type: 'circle', source: 'candidates', paint: {
        'circle-radius': ['match', ['get', 'role'], 'chosen', 10, 'alternative', 8, 'scan', 8, 'far', 4, 6],
        'circle-color': ['match', ['get', 'role'], 'chosen', '#22c55e', 'alternative', '#4c8dff', 'scan', '#e5e7eb', '#475569'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': ['match', ['get', 'role'], 'chosen', 3, 1.5] } })
      m.addLayer({ id: 'candidate-labels', type: 'symbol', source: 'candidates', layout: {
        'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': false },
        paint: { 'text-color': ['match', ['get', 'role'], 'chosen', '#86efac', 'alternative', '#93c5fd', '#94a3b8'],
          'text-halo-color': '#000', 'text-halo-width': 1.2 } })

      // ---- interaction ----
      for (const l of ['incidents', 'candidates', 'volunteers', 'evidence-pts', ...LAYERS.filter((x) => x.sources).map((x) => `obs-${x.id}`), 'sensors', 'closures', 'storm-points', 'tracts-fill']) {
        m.on('mouseenter', l, () => (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', l, () => (m.getCanvas().style.cursor = ''))
      }
      const popup = (layer: string, html: (p: any) => string) =>
        m.on('click', layer, (e: MapLayerMouseEvent) => {
          if (layer !== 'tracts-fill' || !m.queryRenderedFeatures(e.point).some((f) => f.layer.id !== 'tracts-fill' && f.layer.id !== 'tracts-line' && f.source !== 'carto'))
            new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(e.lngLat).setHTML(html(e.features![0].properties)).addTo(m)
        })
      m.on('click', 'incidents', (e: MapLayerMouseEvent) => propsRef.current.onSelectIncident(e.features![0].properties!.id))
      popup('candidates', (p) => profileHtml(JSON.parse(p.json)))
      popup('volunteers', (p) => profileHtml(JSON.parse(p.json)))
      const obsHtml = (p: any) => {
        const s = SOURCES[p.source_type] ?? { icon: '•', label: p.source_type }
        return `<div class="pop-src">${s.icon} ${esc(s.label)}${p.reporter ? ` · ${esc(p.reporter)}` : ''}</div>
          <div class="pop-text">${esc(p.text || p.summary)}</div>
          ${p.text && p.summary ? `<div class="pop-ai">🧠 ${esc(p.summary)}</div>` : ''}`
      }
      popup('evidence-pts', obsHtml)
      for (const l of LAYERS.filter((x) => x.sources)) popup(`obs-${l.id}`, obsHtml)
      popup('sensors', (p) => `<b>🌊 ${esc(p.name)}</b><br/>stage ${esc(p.label)} (NWS flood stage ${p.flood_stage_ft} ft)`)
      popup('closures', (p) => `<b>⛔ ${esc(p.name ?? 'Road')}</b><br/>${esc(p.closed_reason)}`)
      popup('storm-points', (p) => `<b>Helene</b> · ${esc(p.label)}<br/>${p.wind_kt} kt winds`)
      popup('tracts-fill', (p) => `<b>Census tract</b><br/>${(+p.pct_65plus).toFixed(0)}% age 65+ · ${(+p.pct_no_vehicle).toFixed(0)}% no vehicle<br/><span class="muted">feeds task priority</span>`)

      get('/layers/tracts').then((d) => (m.getSource('tracts') as GeoJSONSource).setData(d))
      get('/layers/storm').then((d) => {
        d.features.forEach((f: any) => {
          const t = new Date(f.properties.at)
          f.properties.label = `${t.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric' })} · ${f.properties.category ?? ''}`
        })
        ;(m.getSource('storm') as GeoJSONSource).setData(d)
      })
      ready.current = true
      render()
      applyVisibility()
    })
    return () => m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyVisibility = () => {
    const m = map.current
    if (!m || !ready.current) return
    for (const [id, layers] of Object.entries(LAYER_MAP))
      for (const l of layers) if (m.getLayer(l)) m.setLayoutProperty(l, 'visibility', propsRef.current.layers[id as LayerId] ? 'visible' : 'none')
  }

  const render = () => {
    const m = map.current, p = propsRef.current, s = p.state
    if (!m || !ready.current || !s) return
    const set = (id: string, d: GeoJSON.FeatureCollection) => (m.getSource(id) as GeoJSONSource)?.setData(d)
    const sel = s.incidents.find((i) => i.id === p.selectedIncidentId) ?? null
    const taskOf = new Map<number, any>()
    for (const t of s.tasks) if (!taskOf.has(t.incident_id)) taskOf.set(t.incident_id, t)

    set('closures', fc(s.closures.map((c) => ({ type: 'Feature', geometry: c.geometry, properties: { name: c.name, closed_reason: c.closed_reason } }))))
    set('sensors', fc(s.sensors.map((x) => pt(x.lon, x.lat, { ...x, label: x.stage_ft != null ? `${x.stage_ft.toFixed(1)} ft` : 'offline', stage_ft: x.stage_ft ?? 0 }))))

    // Ambient report dots: only those with a source family layer. Reports of the selected incident are drawn separately.
    const obs = s.observations.filter((o) => o.point && OBS_LAYER_OF[o.source_type])
    set('observations', fc(obs.filter((o) => !sel || o.incident_id !== sel.id).map((o) => ({ type: 'Feature', geometry: o.point, properties: { ...o, layer: OBS_LAYER_OF[o.source_type] } }))))
    const mine = sel ? s.observations.filter((o) => o.point && o.incident_id === sel.id) : []
    set('evidence-pts', fc(mine.map((o) => ({ type: 'Feature', geometry: o.point, properties: { ...o, color: SOURCES[o.source_type]?.color ?? '#9ca3af' } }))))
    set('evidence', fc(mine.map((o) => line(o.point!.coordinates, [sel!.lon, sel!.lat], { color: SOURCES[o.source_type]?.color ?? '#9ca3af' }))))

    set('incidents', fc(s.incidents.map((i) => {
      const t = taskOf.get(i.id)
      return pt(i.lon, i.lat, {
        id: i.id, priority: i.priority ?? 0, selected: i.id === p.selectedIncidentId, dim: !!sel && i.id !== sel.id,
        color: STATUS_COLOR[t ? t.status : 'NONE'], label: t ? t.title : i.type?.replace(/_/g, ' '),
      })
    })))

    // Live positions override the positions recorded at match time.
    const live = new Map(s.volunteers.map((v) => [v.id, v]))
    set('volunteers', fc(s.volunteers.filter((v) => v.lon != null && !(p.candidates && p.stage > 0)).map((v) => pt(v.lon, v.lat, { json: JSON.stringify(v) }))))

    const cands = p.stage > 0 && p.candidates ? p.candidates : []
    const roleAt = (c: Candidate) => {
      if (p.stage === 1) return 'scan'
      if (c.role === 'chosen') return p.stage >= 4 ? 'chosen' : 'alternative'
      if (c.role === 'alternative') return p.stage >= 3 ? 'alternative' : 'scan'
      if (c.role === 'farther') return p.stage >= 2 ? 'far' : 'scan'
      return 'out'
    }
    const label = (c: Candidate, role: string) => {
      if (role === 'scan' || role === 'far') return role === 'scan' ? c.name.split(' ')[0] : ''

      if (role === 'out') return p.stage >= 2 ? `✗ ${c.name.split(' ')[0]}: ${(c.reasons ?? [])[0] ?? ''}` : ''
      if (role === 'alternative') return p.stage >= 3 ? `${c.name.split(' ')[0]} · ${mins(c.eta_s)}` : c.name.split(' ')[0]
      return `✓ ${c.name} · ${mins(c.eta_s)}`
    }
    const cfeat = cands.map((c) => {
      const v = live.get(c.id)
      const lon = v?.lon ?? c.lon, lat = v?.lat ?? c.lat
      const role = roleAt(c)
      return pt(lon, lat, { role, label: label(c, role), json: JSON.stringify({ ...c, ...(v ? { vehicle: v.vehicle, skills: v.skills, equipment: v.equipment } : {}) }) })
    })
    set('candidates', fc(cfeat))
    const story = s.assignments.filter((a) => a.task_id === p.storyTaskId && a.route).slice(-1)
    const showRoute = p.stage >= 4 && story.length > 0 && ['OFFERED', 'ACCEPTED', 'DONE'].includes(story[0].status)
    set('spokes', fc(sel && p.stage > 0 && p.stage < 4 ? cfeat.filter((f) => !['out', 'far'].includes(f.properties.role)).map((f) =>
      line(f.geometry.coordinates, [sel.lon, sel.lat], { color: f.properties.role === 'alternative' ? '#4c8dff' : '#94a3b8', width: 1.2 })) : []))
    set('route', fc(showRoute ? [{ type: 'Feature', geometry: story[0].route, properties: { status: story[0].status } }] : []))
  }

  useEffect(render, [props.state, props.selectedIncidentId, props.candidates, props.stage, props.storyTaskId])
  useEffect(applyVisibility, [props.layers])

  // Camera: incident → candidates → route.
  const cam = useRef('')
  useEffect(() => {
    const m = map.current, s = props.state
    if (!m || !s) return
    const sel = s.incidents.find((i) => i.id === props.selectedIncidentId)
    let key = 'none', fit: number[][] | null = null
    const story = s.assignments.filter((a) => a.task_id === props.storyTaskId).slice(-1)[0]
    if (sel && story?.status === 'ACCEPTED' && story.route) {
      key = `route:${story.id}`; fit = story.route.coordinates
    } else if (sel && props.stage >= 1 && props.candidates?.length) {
      key = `cands:${sel.id}:${props.candidates.length}`
      fit = [[sel.lon, sel.lat], ...props.candidates.filter((c) => c.role === 'chosen' || c.role === 'alternative' || c.dist_m < 15000).map((c) => [c.lon, c.lat])]
    } else if (sel) {
      key = `inc:${sel.id}`
      const pts = s.observations.filter((o) => o.incident_id === sel.id && o.point).map((o) => o.point!.coordinates)
      fit = [[sel.lon, sel.lat], ...pts]
    }
    if (key === cam.current) return
    cam.current = key
    if (!fit) return
    const b = fit.reduce((bb, c) => bb.extend(c as [number, number]), new maplibregl.LngLatBounds(fit[0] as [number, number], fit[0] as [number, number]))
    m.fitBounds(b, { padding: { top: 80, bottom: 80, left: 300, right: 80 }, maxZoom: 14, duration: 1200 })
  }, [props.state, props.selectedIncidentId, props.stage, props.candidates, props.storyTaskId])

  return <div ref={el} className="map" />
}

function profileHtml(c: any) {
  const verdict = c.role === 'chosen' ? `<div class="pop-verdict ok">✓ Selected — fastest capable volunteer (${mins(c.eta_s)} by road${c.mode === 'walk' ? ', on foot' : ''})</div>`
    : c.role === 'alternative' ? `<div class="pop-verdict alt">#${c.rank} candidate · ${mins(c.eta_s)} by road</div>`
    : c.reasons?.length ? `<div class="pop-verdict bad">✗ ${c.reasons.map(esc).join('<br/>✗ ')}</div>` : ''
  const chips = (xs: string[] | null | undefined) => (xs?.length ? xs.map((x) => `<span class="chip">${esc(x.replace(/_/g, ' '))}</span>`).join('') : '<span class="muted">none</span>')
  return `<div class="profile">
    <div class="profile-head"><div class="avatar">${esc(c.name.split(' ').map((w: string) => w[0]).join(''))}</div>
      <div><b>${esc(c.name)}</b><div class="muted">${c.dist_m != null ? `${(c.dist_m / 1000).toFixed(1)} km away` : 'Volunteer'}${c.verify_safe ? ' · verify-safe' : ''}</div></div></div>
    <div class="profile-row"><span>Vehicle</span><div>${esc(vehicleDesc(c.vehicle))}</div></div>
    <div class="profile-row"><span>Skills</span><div>${chips(c.skills)}</div></div>
    <div class="profile-row"><span>Equipment</span><div>${chips(c.equipment)}</div></div>
    ${verdict}</div>`
}
