import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Snapshot, Task, Volunteer } from '../lib/types'
import { bounds, type LonLat } from '../lib/geo'
import { qualifies } from '../lib/match'
import { isDone } from '../lib/vocab'
import { clusterBadge, gaugePill, mePuck, resourcePin, taskTag, updateTaskTag, volunteerDot } from './markers'

const STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const C = { route: '#1D5FBF', caution: '#E8740C', water: '#5B8FC9', ink: '#14212E', white: '#FFFFFF' }
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export type Layers = { tasks: boolean; resources: boolean; closures: boolean; volunteers: boolean; gauges: boolean; reports: boolean }
export const ALL_LAYERS: Layers = { tasks: true, resources: true, closures: true, volunteers: true, gauges: true, reports: false }

export type RouteDraw = { line: GeoJSON.LineString; kind: 'active' | 'offer' | 'preview' } | null

export type MapHandle = {
  recenter: () => void
  fit: (coords: LonLat[], opts?: { bottom?: number; top?: number }) => void
  flyTo: (c: LonLat, zoom?: number) => void
}

type Props = {
  snap: Snapshot | null
  me: Volunteer | null
  layers?: Layers
  selectedTaskId?: number | null
  mineTaskId?: number | null
  route?: RouteDraw
  follow?: { heading: number } | null
  padBottom?: number
  filter?: (t: Task) => boolean
  onSelectTask?: (id: number) => void
  onSelectResource?: (id: number) => void
  initial?: { center: LonLat; zoom: number }
  interactive?: boolean
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const point = (c: LonLat, properties: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties })

const MapCanvas = forwardRef<MapHandle, Props>(function MapCanvas(props, ref) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const ready = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props
  const markers = useRef(new Map<string, Marker>())
  const meMarker = useRef<Marker | null>(null)
  const pending = useRef<(() => void)[]>([])
  // Camera moves requested before the style loads are replayed on load.
  const whenReady = (fn: (m: MlMap) => void) => {
    if (map.current && ready.current) fn(map.current)
    else pending.current.push(() => map.current && fn(map.current))
  }

  useImperativeHandle(ref, () => ({
    recenter: () => {
      const me = propsRef.current.me
      if (me) whenReady((m) => m.easeTo({ center: [me.lon, me.lat], zoom: Math.max(m.getZoom(), 12.5), duration: reduceMotion() ? 0 : 600 }))
    },
    fit: (coords, opts) => {
      if (coords.length === 0) return
      whenReady((m) => m.fitBounds(bounds(coords), {
        padding: { top: opts?.top ?? 150, left: 48, right: 88, bottom: (opts?.bottom ?? propsRef.current.padBottom ?? 0) + 24 },
        maxZoom: 14.5, duration: ready.current && !reduceMotion() ? 700 : 0,
      }))
    },
    flyTo: (c, zoom = 14) => whenReady((m) => m.easeTo({ center: c, zoom, duration: reduceMotion() ? 0 : 700 })),
  }), [])

  // ---- Create map once ----
  useEffect(() => {
    const p = propsRef.current
    const m = new maplibregl.Map({
      container: el.current!, style: STYLE,
      center: p.initial?.center ?? (p.me ? [p.me.lon, p.me.lat] : [-82.47, 35.6]),
      zoom: p.initial?.zoom ?? 11.4,
      attributionControl: { compact: true },
      interactive: p.interactive ?? true,
      pitchWithRotate: false,
      dragRotate: false,
    })
    map.current = m
    m.touchZoomRotate.disableRotation()

    m.on('load', () => {
      const empty = fc([])
      m.addSource('closures', { type: 'geojson', data: empty })
      m.addSource('route', { type: 'geojson', data: empty })
      m.addSource('reports', { type: 'geojson', data: empty })
      m.addSource('tasks', {
        type: 'geojson', data: empty, cluster: true, clusterRadius: 44, clusterMaxZoom: 13,
        clusterProperties: { urgent: ['+', ['case', ['>=', ['get', 'urgency'], 0.75], 1, 0]] },
      })

      m.addLayer({ id: 'closures-casing', type: 'line', source: 'closures', layout: { 'line-cap': 'round' },
        paint: { 'line-color': C.white, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 10] } })
      m.addLayer({ id: 'closures', type: 'line', source: 'closures', layout: { 'line-cap': 'butt' },
        paint: { 'line-color': C.caution, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 6], 'line-dasharray': [1.4, 0.7] } })
      m.addLayer({ id: 'closures-label', type: 'symbol', source: 'closures', minzoom: 12.5, layout: {
        'symbol-placement': 'line-center', 'text-field': 'CLOSED', 'text-size': 11, 'text-font': ['Open Sans Bold'] },
        paint: { 'text-color': '#9A4600', 'text-halo-color': C.white, 'text-halo-width': 2 } })

      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.white, 'line-width': ['match', ['get', 'kind'], 'preview', 6, 11] } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', filter: ['!=', ['get', 'kind'], 'preview'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.route, 'line-width': 6 } })
      m.addLayer({ id: 'route-preview', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'preview'], layout: { 'line-cap': 'round' },
        paint: { 'line-color': C.route, 'line-width': 3, 'line-dasharray': [0.1, 2] } })

      m.addLayer({ id: 'reports', type: 'circle', source: 'reports', paint: {
        'circle-radius': 5, 'circle-color': ['case', ['get', 'official'], C.ink, '#6E7C8A'],
        'circle-stroke-color': C.white, 'circle-stroke-width': 1.5 } })

      // Tasks are drawn as HTML markers; this invisible layer makes MapLibre load and cluster the source.
      m.addLayer({ id: 'tasks-hit', type: 'circle', source: 'tasks', paint: { 'circle-radius': 1, 'circle-opacity': 0 } })

      m.on('moveend', syncTaskMarkers)
      m.on('sourcedata', (e) => { if (e.sourceId === 'tasks' && e.isSourceLoaded) syncTaskMarkers() })
      ready.current = true
      draw()
      pending.current.splice(0).forEach((fn) => fn())
    })
    return () => { m.remove(); map.current = null; ready.current = false; markers.current.clear(); meMarker.current = null }
  }, [])

  // ---- Data → sources and non-clustered markers ----
  const draw = () => {
    const m = map.current, p = propsRef.current, s = p.snap
    if (!m || !ready.current || !s) return
    const L = p.layers ?? ALL_LAYERS
    const set = (id: string, d: GeoJSON.FeatureCollection) => (m.getSource(id) as GeoJSONSource | undefined)?.setData(d)

    set('closures', fc(L.closures ? s.closures.map((c) => ({ type: 'Feature', geometry: c.geometry, properties: { name: c.name } })) : []))
    set('route', fc(p.route ? [{ type: 'Feature', geometry: p.route.line, properties: { kind: p.route.kind } }] : []))
    set('reports', fc(L.reports ? s.observations.filter((o) => o.point).map((o) =>
      ({ type: 'Feature', geometry: o.point!, properties: { official: ['radio', 'ncdot', 'usgs'].includes(o.source_type) } })) : []))

    const tasks = L.tasks ? s.tasks.filter((t) => (p.filter ? p.filter(t) : !isDone(t)) || t.id === p.selectedTaskId || t.id === p.mineTaskId) : []
    set('tasks', fc(tasks.map((t) => point([t.lon, t.lat], { id: t.id, urgency: t.urgency }))))

    // Fixed markers: resources, gauges, volunteers.
    const want = new Set<string>()
    const put = (key: string, c: LonLat, make: () => HTMLElement, onClick?: () => void, anchor: maplibregl.PositionAnchor = 'center') => {
      want.add(key)
      const existing = markers.current.get(key)
      if (existing) { existing.setLngLat(c); return }
      const node = make()
      if (onClick) node.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
      markers.current.set(key, new maplibregl.Marker({ element: node, anchor }).setLngLat(c).addTo(m))
    }
    if (L.resources) for (const r of s.resources ?? []) put(`r${r.id}`, [r.lon, r.lat], () => resourcePin(r), () => propsRef.current.onSelectResource?.(r.id))
    if (L.gauges) for (const g of s.sensors) {
      const offline = !!g.at && new Date(s.clock.sim_now).getTime() - new Date(g.at).getTime() > 6 * 3600e3
      put(`g${g.site_id}`, [g.lon, g.lat], () => gaugePill(g, offline))
    }
    if (L.volunteers) {
      const busy = new Set(s.assignments.filter((a) => a.status === 'ACCEPTED' || a.status === 'OFFERED').map((a) => a.volunteer_id))
      for (const v of s.volunteers) if (v.id !== p.me?.id && v.lon != null) put(`v${v.id}`, [v.lon, v.lat], () => volunteerDot(busy.has(v.id), v.available))
    }
    for (const [key, mk] of markers.current) {
      if (/^[rgv]/.test(key) && !want.has(key)) { mk.remove(); markers.current.delete(key) }
    }

    // Me.
    if (p.me) {
      if (!meMarker.current) meMarker.current = new maplibregl.Marker({ element: mePuck(), rotationAlignment: 'map' }).setLngLat([p.me.lon, p.me.lat]).addTo(m)
      meMarker.current.setLngLat([p.me.lon, p.me.lat])
      meMarker.current.getElement().classList.toggle('is-nav', !!p.follow)
      meMarker.current.setRotation(p.follow?.heading ?? 0)
    }
    syncTaskMarkers()
  }

  // ---- Clustered task markers (HTML so they can carry icons and labels) ----
  const syncTaskMarkers = () => {
    const m = map.current, p = propsRef.current, s = p.snap
    if (!m || !ready.current || !s) return
    const src = m.getSource('tasks') as GeoJSONSource | undefined
    if (!src) return
    const feats = m.querySourceFeatures('tasks')
    const want = new Set<string>()
    for (const f of feats) {
      const props = f.properties as any
      const c = (f.geometry as GeoJSON.Point).coordinates as LonLat
      if (props.cluster) {
        const key = `c${props.cluster_id}`
        if (want.has(key)) continue
        want.add(key)
        if (!markers.current.has(key)) {
          const node = clusterBadge(props.point_count, props.urgent)
          node.addEventListener('click', async (e) => {
            e.stopPropagation()
            const z = await src.getClusterExpansionZoom(props.cluster_id)
            m.easeTo({ center: c, zoom: z + 0.3, duration: reduceMotion() ? 0 : 500 })
          })
          markers.current.set(key, new maplibregl.Marker({ element: node }).setLngLat(c).addTo(m))
        }
      } else {
        const key = `t${props.id}`
        if (want.has(key)) continue
        want.add(key)
        const t = s.tasks.find((x) => x.id === props.id)
        if (!t) continue
        const st = { selected: t.id === p.selectedTaskId, mine: t.id === p.mineTaskId, fits: !!p.me && qualifies(p.me, t) }
        const existing = markers.current.get(key)
        if (existing) { updateTaskTag(existing.getElement(), t, st); existing.getElement().style.zIndex = st.selected || st.mine ? '3' : ''; continue }
        const node = taskTag(t, st)
        node.addEventListener('click', (e) => { e.stopPropagation(); propsRef.current.onSelectTask?.(t.id) })
        if (st.selected || st.mine) node.style.zIndex = '3'
        markers.current.set(key, new maplibregl.Marker({ element: node, anchor: 'bottom' }).setLngLat(c).addTo(m))
      }
    }
    for (const [key, mk] of markers.current) {
      if (/^[ct]/.test(key) && !want.has(key)) { mk.remove(); markers.current.delete(key) }
    }
  }

  useEffect(draw, [props.snap, props.me, props.layers, props.selectedTaskId, props.mineTaskId, props.route, props.follow, props.filter])

  // Navigation follow mode.
  useEffect(() => {
    const m = map.current, me = props.me
    if (!m || !props.follow || !me) return
    m.easeTo({ center: [me.lon, me.lat], zoom: 15.2, pitch: 45, bearing: props.follow.heading,
      padding: { top: 0, bottom: props.padBottom ?? 0, left: 0, right: 0 }, duration: reduceMotion() ? 0 : 900 })
  }, [props.follow?.heading, props.me?.lon, props.me?.lat])

  useEffect(() => {
    const m = map.current
    if (m && !props.follow && m.getPitch() !== 0) m.easeTo({ pitch: 0, bearing: 0, duration: reduceMotion() ? 0 : 400 })
  }, [props.follow])

  return <div ref={el} className="map-canvas" role="application" aria-label="Disaster map" />
})

export default MapCanvas
