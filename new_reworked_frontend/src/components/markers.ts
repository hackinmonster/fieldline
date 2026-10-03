import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Waves, type LucideIcon } from 'lucide-react'
import type { Resource, Sensor, Task } from '../lib/types'
import { RESOURCE, TASK_KIND, isDone, urgencyBand } from '../lib/vocab'

const svg = (icon: LucideIcon, size = 18, stroke = 2.25) =>
  renderToStaticMarkup(createElement(icon, { size, strokeWidth: stroke, 'aria-hidden': true }))

export type TaskMarkerState = { selected: boolean; mine: boolean; fits: boolean }

/** Field-tag marker: square tag, type glyph, notch pointing at the address. */
export function taskTag(t: Task, s: TaskMarkerState) {
  const el = document.createElement('button')
  updateTaskTag(el, t, s)
  return el
}

export function updateTaskTag(el: HTMLElement, t: Task, s: TaskMarkerState) {
  const band = urgencyBand(t.urgency).key
  const done = isDone(t)
  const cls = ['mk-tag', `u-${band}`]
  if (done) cls.push('is-done')
  if (s.mine) cls.push('is-mine')
  if (s.selected) cls.push('is-selected')
  if (s.fits && !done) cls.push('is-fit')
  el.className = cls.join(' ')
  el.setAttribute('aria-label', `${TASK_KIND[t.type].label}: ${t.title}`)
  const key = `${band}|${done}|${s.mine}|${s.selected}|${s.fits}|${t.title}`
  if (el.dataset.key === key) return
  el.dataset.key = key
  el.innerHTML =
    `<span class="mk-tag-body">${svg(TASK_KIND[t.type].icon, done ? 14 : 18)}` +
    (s.selected || s.mine ? `<span class="mk-tag-label">${escape(TASK_KIND[t.type].short)}</span>` : '') +
    `</span><span class="mk-tag-notch"></span>`
}

export function clusterBadge(count: number, urgent: number) {
  const el = document.createElement('button')
  el.className = 'mk-cluster'
  el.setAttribute('aria-label', `${count} requests here, ${urgent} urgent. Zoom in.`)
  el.innerHTML = `<span class="mk-cluster-n">${count}</span>` + (urgent ? `<span class="mk-cluster-urgent">${urgent}</span>` : '')
  return el
}

export function resourcePin(r: Resource) {
  const el = document.createElement('button')
  el.className = `mk-res is-${r.status}`
  el.setAttribute('aria-label', `${RESOURCE[r.kind].label}: ${r.name}`)
  el.innerHTML = svg(RESOURCE[r.kind].icon, 15, 2.25)
  return el
}

export function gaugePill(s: Sensor, offline: boolean) {
  const el = document.createElement('div')
  const flooding = s.stage_ft != null && s.stage_ft >= s.flood_stage_ft
  el.className = `mk-gauge${flooding ? ' is-flood' : ''}${offline ? ' is-offline' : ''}`
  el.innerHTML = `${svg(Waves, 13)}<span>${offline ? 'Gauge offline' : `${s.stage_ft?.toFixed(1)} ft`}</span>`
  el.title = `${s.name}: flood stage ${s.flood_stage_ft} ft`
  return el
}

export function volunteerDot(busy: boolean, available: boolean) {
  const el = document.createElement('div')
  el.className = `mk-vol${busy ? ' is-busy' : available ? '' : ' is-off'}`
  return el
}

export function mePuck() {
  const el = document.createElement('div')
  el.className = 'mk-me'
  el.innerHTML = '<span class="mk-me-cone"></span><span class="mk-me-dot"></span>'
  el.setAttribute('aria-label', 'Your location')
  return el
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
