export type LonLat = [number, number]

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export function meters(a: LonLat, b: LonLat) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function bearing(a: LonLat, b: LonLat) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]))
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function lineLength(coords: LonLat[]) {
  let d = 0
  for (let i = 1; i < coords.length; i++) d += meters(coords[i - 1], coords[i])
  return d
}

/** Point `dist` meters along the line, plus the remaining tail of the line from there. */
export function along(coords: LonLat[], dist: number): { point: LonLat; rest: LonLat[]; heading: number } {
  let acc = 0
  for (let i = 1; i < coords.length; i++) {
    const seg = meters(coords[i - 1], coords[i])
    if (acc + seg >= dist) {
      const f = seg === 0 ? 0 : (dist - acc) / seg
      const p: LonLat = [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]
      return { point: p, rest: [p, ...coords.slice(i)], heading: bearing(coords[i - 1], coords[i]) }
    }
    acc += seg
  }
  const last = coords[coords.length - 1]
  return { point: last, rest: [last], heading: 0 }
}

/** Distance from the start of the line to the vertex nearest `p` (good enough for progress along a dense route). */
export function progressOn(coords: LonLat[], p: LonLat) {
  let best = 0, bestD = Infinity
  for (let i = 0; i < coords.length; i++) {
    const d = meters(coords[i], p)
    if (d < bestD) { bestD = d; best = i }
  }
  return lineLength(coords.slice(0, best + 1))
}

export function bounds(coords: LonLat[]): [LonLat, LonLat] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of coords) { w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y) }
  return [[w, s], [e, n]]
}
