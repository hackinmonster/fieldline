import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { get, type State } from './api'

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
export const STATUS_COLOR: Record<string, string> = {
  OPEN: '#f5a524', ASSIGNED: '#4c8dff', EN_ROUTE: '#22d3ee', BLOCKED: '#ef4444',
  COMPLETED: '#a78bfa', VERIFIED: '#22c55e', REJECTED: '#ef4444',
}
const SOURCE_COLOR = ['match', ['get', 'source_type'],
  'resident', '#fbbf24', 'shelter', '#fbbf24', 'ngo', '#fbbf24', 'volunteer', '#34d399',
  'radio', '#f472b6', 'ncdot', '#f87171', 'usgs', '#60a5fa', '#9ca3af'] as any

const fc = (features: any[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const pt = (lon: number, lat: number, properties: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })

type Props = {
  state: State | null
  onSelectTask?: (id: number) => void
  focusVolunteerId?: number
  showContext?: boolean
  compact?: boolean
  ghostRoute?: GeoJSON.LineString | null   // route abandoned by the latest reroute
}

export default function MapView({ state, onSelectTask, focusVolunteerId, showContext = true, compact, ghostRoute }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: [-82.52, 35.59], zoom: compact ? 12 : 10.6, attributionControl: { compact: true } })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    m.on('load', async () => {
      const empty = fc([])
      for (const id of ['tracts', 'storm', 'closures', 'observations', 'incidents', 'ghost', 'routes', 'tasks', 'volunteers', 'sensors'])
        m.addSource(id, { type: 'geojson', data: empty })

      if (showContext) {
        m.addLayer({ id: 'tracts-fill', type: 'fill', source: 'tracts', paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'pct_65plus'], 10, '#0b1220', 35, '#3b2a5a'], 'fill-opacity': 0.35 } })
        m.addLayer({ id: 'tracts-line', type: 'line', source: 'tracts', paint: { 'line-color': '#334155', 'line-width': 0.4 } })
        m.addLayer({ id: 'storm-line', type: 'line', source: 'storm', filter: ['==', '$type', 'LineString'],
          paint: { 'line-color': '#a855f7', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.6 } })
      }
      m.addLayer({ id: 'closures', type: 'line', source: 'closures', paint: { 'line-color': '#ef4444', 'line-width': 4, 'line-opacity': 0.9 } })
      m.addLayer({ id: 'ghost', type: 'line', source: 'ghost',
        paint: { 'line-color': '#f87171', 'line-width': 3, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.8 } })
      m.addLayer({ id: 'routes-old', type: 'line', source: 'routes', filter: ['in', ['get', 'status'], ['literal', ['SUPERSEDED', 'RELEASED']]],
        paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [1, 2], 'line-opacity': 0.6 } })
      m.addLayer({ id: 'routes', type: 'line', source: 'routes', filter: ['in', ['get', 'status'], ['literal', ['OFFERED', 'ACCEPTED']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['match', ['get', 'status'], 'ACCEPTED', '#22d3ee', '#4c8dff'], 'line-width': 5, 'line-opacity': 0.85 } })
      m.addLayer({ id: 'observations', type: 'circle', source: 'observations', paint: {
        'circle-radius': 3.5, 'circle-color': SOURCE_COLOR, 'circle-opacity': 0.75, 'circle-stroke-width': 0 } })
      m.addLayer({ id: 'incidents', type: 'circle', source: 'incidents', paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'n_obs'], 1, 12, 6, 22],
        'circle-color': 'transparent', 'circle-stroke-width': 2,
        'circle-stroke-color': ['case', ['==', ['get', 'status'], 'RESOLVED'], '#22c55e', '#f5a524'], 'circle-stroke-opacity': 0.8 } })
      m.addLayer({ id: 'sensors', type: 'circle', source: 'sensors', paint: {
        'circle-radius': 8, 'circle-color': ['case', ['>=', ['get', 'stage_ft'], ['get', 'flood_stage_ft']], '#2563eb', '#1e3a5f'],
        'circle-stroke-color': '#93c5fd', 'circle-stroke-width': 2 } })
      m.addLayer({ id: 'sensor-labels', type: 'symbol', source: 'sensors', layout: {
        'text-field': ['concat', ['to-string', ['get', 'stage_label']], ' ft'], 'text-size': 11, 'text-offset': [0, 1.5] },
        paint: { 'text-color': '#93c5fd', 'text-halo-color': '#000', 'text-halo-width': 1 } })
      m.addLayer({ id: 'tasks', type: 'circle', source: 'tasks', paint: {
        'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
      m.addLayer({ id: 'task-labels', type: 'symbol', source: 'tasks', layout: {
        'text-field': ['concat', '#', ['to-string', ['get', 'id']], ' ', ['get', 'type']], 'text-size': 11, 'text-offset': [0, 1.6], 'text-anchor': 'top' },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 } })
      m.addLayer({ id: 'volunteers', type: 'circle', source: 'volunteers', paint: {
        'circle-radius': ['case', ['get', 'focus'], 9, 6],
        'circle-color': ['case', ['get', 'busy'], '#22d3ee', ['get', 'available'], '#34d399', '#6b7280'],
        'circle-stroke-color': ['case', ['get', 'focus'], '#fff', '#0f172a'], 'circle-stroke-width': 2 } })
      m.addLayer({ id: 'volunteer-labels', type: 'symbol', source: 'volunteers', minzoom: 11.5, layout: {
        'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': '#a7f3d0', 'text-halo-color': '#000', 'text-halo-width': 1 } })

      m.on('click', 'tasks', (e: MapLayerMouseEvent) => onSelectTask?.(e.features![0].properties!.id))
      for (const l of ['tasks', 'incidents', 'volunteers', 'observations', 'sensors', 'closures']) {
        m.on('mouseenter', l, () => (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', l, () => (m.getCanvas().style.cursor = ''))
      }
      const popup = (layer: string, html: (p: any) => string) =>
        m.on('click', layer, (e: MapLayerMouseEvent) => new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(html(e.features![0].properties)).addTo(m))
      popup('observations', (p) => `<b>${p.source_type}</b> · ${p.category ?? ''}/${p.subtype ?? ''}<br/>${p.summary ?? ''}`)
      popup('incidents', (p) => `<b>Incident #${p.id}</b> (${p.type}) · conf ${(+p.confidence).toFixed(2)}<br/>${p.summary}`)
      popup('volunteers', (p) => `<b>${p.name}</b><br/>${p.vehicle_desc}`)
      popup('sensors', (p) => `<b>${p.name}</b><br/>stage ${p.stage_label} ft (flood ${p.flood_stage_ft} ft)`)
      popup('closures', (p) => `<b>⛔ ${p.name ?? 'Road'}</b><br/>${p.closed_reason ?? ''}`)

      if (showContext) {
        get('/layers/tracts').then((d) => (m.getSource('tracts') as GeoJSONSource).setData(d))
        get('/layers/storm').then((d) => (m.getSource('storm') as GeoJSONSource).setData(d))
      }
      ready.current = true
      render()
    })
    return () => m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const render = () => {
    const m = map.current, s = stateRef.current
    if (!m || !ready.current || !s) return
    const set = (id: string, d: GeoJSON.FeatureCollection) => (m.getSource(id) as GeoJSONSource)?.setData(d)
    const busy = new Set(s.assignments.filter((a) => ['OFFERED', 'ACCEPTED'].includes(a.status)).map((a) => a.volunteer_id))
    set('closures', fc(s.closures.map((c) => ({ type: 'Feature', geometry: c.geometry, properties: { name: c.name, closed_reason: c.closed_reason } }))))
    set('observations', fc(s.observations.filter((o) => o.point).map((o) => ({ type: 'Feature', geometry: o.point, properties: o }))))
    set('incidents', fc(s.incidents.map((i) => pt(i.lon, i.lat, i))))
    set('tasks', fc(s.tasks.map((t) => pt(t.lon, t.lat, { ...t, color: STATUS_COLOR[t.status] ?? '#999', requirements: undefined }))))
    set('volunteers', fc(s.volunteers.filter((v) => v.lon != null).map((v) => pt(v.lon, v.lat, {
      ...v, busy: busy.has(v.id), focus: v.id === focusVolunteerId,
      vehicle_desc: v.vehicle ? `${v.vehicle.type} · ${v.vehicle.capacity_gal ?? 0} gal · ${v.vehicle.high_clearance ? 'high clearance' : 'standard'}` : 'no vehicle',
    }))))
    set('routes', fc(s.assignments.filter((a) => a.route && (focusVolunteerId == null || a.volunteer_id === focusVolunteerId))
      .map((a) => ({ type: 'Feature', geometry: a.route, properties: { status: a.status, id: a.id } }))))
    set('sensors', fc(s.sensors.map((x) => pt(x.lon, x.lat, { ...x, stage_label: x.stage_ft != null ? x.stage_ft.toFixed(1) : '—', stage_ft: x.stage_ft ?? 0 }))))
  }

  useEffect(render, [state, focusVolunteerId])

  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return
    ;(m.getSource('ghost') as GeoJSONSource)?.setData(fc(ghostRoute ? [{ type: 'Feature', geometry: ghostRoute, properties: {} }] : []))
  }, [ghostRoute])

  // Volunteer app: frame the active route when it appears/changes; otherwise follow the volunteer.
  const framed = useRef<string>('')
  useEffect(() => {
    if (focusVolunteerId == null || !state || !map.current) return
    const a = state.assignments.find((x) => x.volunteer_id === focusVolunteerId && ['OFFERED', 'ACCEPTED'].includes(x.status))
    const coords = a?.route?.coordinates
    if (coords?.length) {
      const sig = `${a!.id}:${coords.length}`
      if (framed.current !== sig) {
        framed.current = sig
        const b = coords.reduce((bb, c) => bb.extend(c as [number, number]), new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]))
        map.current.fitBounds(b, { padding: 40, duration: 800 })
      }
      return
    }
    const v = state.volunteers.find((x) => x.id === focusVolunteerId)
    if (v?.lon != null) map.current.easeTo({ center: [v.lon, v.lat], duration: 600 })
  }, [state?.volunteers, state?.assignments, focusVolunteerId])

  return <div ref={el} className="map" />
}
