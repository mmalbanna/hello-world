import type { Person } from '../lib/types'
import { initials } from '../lib/photo'

export function Avatar({ person, size = 40, ring, loan, className = '', title }: { person: Pick<Person, 'name' | 'photo'>; size?: number; ring?: string; loan?: boolean; className?: string; title?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.36), boxShadow: ring ? `0 0 0 ${loan ? 2 : 3}px ${ring}` : undefined, outline: loan ? `2px dashed #f59e0b` : undefined, outlineOffset: loan ? 2 : undefined }
  return (
    <div title={title ?? person.name} className={`flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-slate-200 font-semibold text-slate-700 ${className}`} style={style}>
      {person.photo ? <img src={person.photo} alt={person.name} className="h-full w-full object-cover" draggable={false} /> : initials(person.name)}
    </div>
  )
}
