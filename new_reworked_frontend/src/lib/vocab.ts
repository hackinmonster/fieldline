import {
  Droplets, HeartPulse, MessageCircle, MessageSquareText, Car, Eye, Home, Fuel, Cross, Package, Radio, TrafficCone, Waves, HandHelping, Building2,
  type LucideIcon,
} from 'lucide-react'
import type { SourceType, TaskType, Resource } from './types'

/** Skills the matcher understands (backend/app/intelligence/schemas.py), plus ones we collect for future matching. */
export const SKILLS: { id: string; label: string; hint: string; matched: boolean }[] = [
  { id: 'first_aid', label: 'First aid', hint: 'Red Cross, AHA or similar', matched: true },
  { id: 'cpr', label: 'CPR', hint: 'Current certification', matched: true },
  { id: 'medical', label: 'Medical professional', hint: 'RN, EMT, MD, PA', matched: true },
  { id: 'heavy_lifting', label: 'Can carry 40 lb', hint: 'Water cases, generators', matched: true },
  { id: 'chainsaw', label: 'Chainsaw operator', hint: 'You have run one safely', matched: true },
  { id: 'spanish', label: 'Spanish', hint: 'Conversational or better', matched: true },
  { id: 'debris_cleanup', label: 'Debris and mud-out', hint: 'Drywall, flooring, yard debris', matched: false },
  { id: 'food_service', label: 'Food handling', hint: 'ServSafe or kitchen work', matched: false },
  { id: 'childcare', label: 'Childcare', hint: 'Background-checked', matched: false },
  { id: 'asl', label: 'ASL', hint: 'American Sign Language', matched: false },
]

export const EQUIPMENT: { id: string; label: string; matched: boolean }[] = [
  { id: 'water_jugs', label: 'Water jugs or cans', matched: true },
  { id: 'cooler', label: 'Cooler', matched: true },
  { id: 'generator', label: 'Generator', matched: true },
  { id: 'chainsaw', label: 'Chainsaw', matched: true },
  { id: 'ladder', label: 'Extension ladder', matched: true },
  { id: 'tarps', label: 'Roof tarps', matched: false },
  { id: 'pump', label: 'Water pump', matched: false },
]

export const VEHICLES = [
  { id: 'none', label: 'None' },
  { id: 'sedan', label: 'Car' },
  { id: 'suv', label: 'SUV' },
  { id: 'minivan', label: 'Van' },
  { id: 'pickup', label: 'Pickup' },
]

export const labelOf = (id: string) =>
  SKILLS.find((s) => s.id === id)?.label ?? EQUIPMENT.find((e) => e.id === id)?.label ?? id.replace(/_/g, ' ')

export const TASK_KIND: Record<TaskType, { label: string; short: string; icon: LucideIcon }> = {
  DELIVER_SUPPLIES: { label: 'Supply delivery', short: 'Deliver', icon: Package },
  WELLNESS_CHECK: { label: 'Wellness check', short: 'Check on', icon: HeartPulse },
  TRANSPORT: { label: 'Transport', short: 'Ride', icon: Car },
  VERIFY_CONDITION: { label: 'Verify condition', short: 'Verify', icon: Eye },
}

export const SOURCE: Record<SourceType, { label: string; icon: LucideIcon; official: boolean }> = {
  // Same names and icons as the Command dashboard (frontend/src/api.ts SOURCES).
  social: { label: 'Social media', icon: MessageCircle, official: false },
  ngo: { label: 'NGO request', icon: Building2, official: false },
  shelter: { label: 'Shelter', icon: Home, official: false },
  resident: { label: 'SMS / hotline', icon: MessageSquareText, official: false },
  radio: { label: 'Public-safety radio', icon: Radio, official: true },
  volunteer: { label: 'Volunteer field report', icon: HandHelping, official: false },
  ncdot: { label: 'NCDOT road feed', icon: TrafficCone, official: true },
  usgs: { label: 'USGS river gauge', icon: Waves, official: true },
}

export const RESOURCE: Record<Resource['kind'], { label: string; icon: LucideIcon }> = {
  shelter: { label: 'Shelter', icon: Home },
  water: { label: 'Water & food', icon: Droplets },
  fuel: { label: 'Fuel', icon: Fuel },
  medical: { label: 'Medical', icon: Cross },
}

/** Feed grouping from the backend's observation category (NEED / HAZARD / INFRASTRUCTURE / STATUS). */
export type PostKind = 'need' | 'road' | 'hazard' | 'info'
export function postKind(o: { category: string | null; source_type: string }): PostKind {
  const c = (o.category ?? '').toUpperCase()
  if (c === 'NEED') return 'need'
  if (c === 'INFRASTRUCTURE' || o.source_type === 'ncdot') return 'road'
  if (c === 'HAZARD') return 'hazard'
  return 'info'
}

/** The backend ends a task at COMPLETED (older builds used VERIFIED). */
export const isDone = (t: { status: string }) => t.status === 'COMPLETED' || t.status === 'VERIFIED'

/** Urgency bands. Red is reserved for genuine life/health risk within hours. */
export function urgencyBand(u: number): { key: 'urgent' | 'soon' | 'routine'; label: string } {
  if (u >= 0.75) return { key: 'urgent', label: 'Urgent' }
  if (u >= 0.5) return { key: 'soon', label: 'Today' }
  return { key: 'routine', label: 'When able' }
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Needs a volunteer', ASSIGNED: 'Volunteer offered', EN_ROUTE: 'Volunteer en route', BLOCKED: 'Blocked by road',
  COMPLETED: 'Done', VERIFIED: 'Done', REJECTED: 'Reopened',
}
