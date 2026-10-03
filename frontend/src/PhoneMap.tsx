import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
const fc = (features: any[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const pt = (c: number[], properties: any = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties })

/** The volunteer's map shows exactly three things: you, where you're going, and the way there. */
export default function PhoneMap({ me, dest, route }: { me: number[] | null; dest: number[] | null; route: GeoJSON.LineString | null }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const data = useRef({ me, dest, route })
  data.current = { me, dest, route }

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: (dest ?? me ?? [-82.55, 35.6]) as [number, number], zoom: 12, attributionControl: false, interactive: true })
    map.current = m
    m.on('load', () => {
      for (const id of ['route', 'dest', 'me']) m.addSource(id, { type: 'geojson', data: fc([]) })
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1d4ed8', 'line-width': 8 } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 5 } })
      m.addLayer({ id: 'dest', type: 'circle', source: 'dest', paint: { 'circle-radius': 9, 'circle-color': '#ef4444', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
      m.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 16, 'circle-color': '#3b82f6', 'circle-opacity': 0.2 } })
      m.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#3b82f6', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } })
      ready.current = true
      draw(true)
    })
    return () => m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const framed = useRef('')
  const draw = (force = false) => {
    const m = map.current, d = data.current
    if (!m || !ready.current) return
    ;(m.getSource('me') as GeoJSONSource).setData(fc(d.me ? [pt(d.me)] : []))
    ;(m.getSource('dest') as GeoJSONSource).setData(fc(d.dest ? [pt(d.dest)] : []))
    ;(m.getSource('route') as GeoJSONSource).setData(fc(d.route ? [{ type: 'Feature', geometry: d.route, properties: {} }] : []))
    const pts = d.route?.coordinates ?? [d.me, d.dest].filter(Boolean) as number[][]
    const sig = `${pts.length}:${pts[0]}:${pts[pts.length - 1]}`
    if (pts.length && (force || sig !== framed.current)) {
      framed.current = sig
      const b = pts.reduce((bb, c) => bb.extend(c as [number, number]), new maplibregl.LngLatBounds(pts[0] as [number, number], pts[0] as [number, number]))
      m.fitBounds(b, { padding: 36, maxZoom: 15, duration: force ? 0 : 800 })
    }
  }
  useEffect(() => draw(), [me?.[0], me?.[1], dest?.[0], dest?.[1], route])

  return <div ref={el} className="map" />
}
