import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Newspaper, PenLine } from 'lucide-react'
import { useStore } from '../lib/store'
import FeedPost from '../components/FeedPost'
import ReportSheet from '../components/ReportSheet'
import { Button, Empty, ScreenHeader, Skeleton } from '../components/ui'
import { meters, type LonLat } from '../lib/geo'
import { postKind } from '../lib/vocab'

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'need', label: 'Needs' },
  { id: 'road', label: 'Roads' },
  { id: 'hazard', label: 'Hazards' },
  { id: 'official', label: 'Official' },
]

export default function Feed() {
  const { snap, me, now } = useStore()
  const nav = useNavigate()
  const [tab, setTab] = useState('all')
  const [writing, setWriting] = useState(false)

  const posts = useMemo(() => {
    const all = (snap?.observations ?? []).filter((o) => o.summary || o.text || o.raw)
    return all
      .filter((o) => tab === 'all' ? true : tab === 'official' ? ['radio', 'ncdot', 'usgs'].includes(o.source_type) : postKind(o) === tab)
      .sort((a, b) => b.observed_at.localeCompare(a.observed_at))
  }, [snap, tab])

  const taskFor = (incident: number | null) => (incident == null ? null : snap?.tasks.find((t) => t.incident_id === incident) ?? null)

  return (
    <div className="feed">
      <ScreenHeader title="What people are seeing" sub="Reports from the response area · newest first"
        right={<Button variant="primary" icon={PenLine} onClick={() => setWriting(true)}>Post</Button>} />
      <div className="tabs-row" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="feed-list">
        {!snap && <><Skeleton /><Skeleton /><Skeleton /></>}
        {snap && posts.length === 0 && (
          <Empty icon={Newspaper} title="No posts in this view yet">Reports from residents, radio and NCDOT show up here within a minute of coming in.</Empty>
        )}
        {posts.map((o) => {
          const c = o.point?.coordinates as LonLat | undefined
          const linked = taskFor(o.incident_id)
          return (
            <FeedPost key={o.id} post={o} now={now} linkedTask={linked}
              distance_m={me && c ? meters([me.lon, me.lat], c) : null}
              onMap={c ? () => nav(`/map?lon=${c[0]}&lat=${c[1]}`) : undefined}
              onTask={linked ? () => nav(`/map?task=${linked.id}`) : undefined} />
          )
        })}
      </div>
      {writing && <ReportSheet onClose={() => setWriting(false)} />}
    </div>
  )
}
