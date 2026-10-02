import { useStore } from '../store/useStore'
import { PageHeader, Empty } from '../components/ui'
import { Timestamp } from 'firebase/firestore'
import { format } from 'date-fns'

function when(at: unknown) {
  if (at instanceof Timestamp) return format(at.toDate(), 'EEE d MMM, HH:mm')
  return 'saving…'
}

export default function ActivityPage() {
  const activity = useStore((s) => s.activity)
  return (
    <div>
      <PageHeader title="Activity" subtitle="Who changed what, newest first. Everyone sees the same log." />
      {!activity.length ? (
        <Empty title="No activity yet" text="Allocations, task and people changes will appear here." />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {activity.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="w-40 shrink-0 text-xs text-slate-500">{when(a.at)}</span>
              <span className="text-sm text-slate-800"><b>{a.byName}</b> {a.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
