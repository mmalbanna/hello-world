import { useStore } from '../store/useStore'
import { setUserRole, removeUserProfile } from '../lib/repo'
import { PageHeader, Select, Button, confirmDialog } from '../components/ui'
import { ROLE_LABEL, type Role } from '../lib/types'

export default function Users() {
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.profile)
  const toast = useStore((s) => s.toast)

  const change = async (uid: string, role: Role) => {
    try { await setUserRole(uid, role); toast('Role updated', 'success') } catch (e) { toast((e as Error).message, 'error') }
  }
  const remove = async (uid: string, name: string) => {
    if (!confirmDialog(`Remove ${name}'s access? Their sign-in still exists in Firebase Authentication; delete it there too if needed.`)) return
    try { await removeUserProfile(uid) } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div>
      <PageHeader title="Access" subtitle="Everyone who created an account. New accounts start as viewers; make your team leads 'Team lead' so they can allocate." />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Role</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.uid}>
                <td className="px-4 py-2 font-medium">{u.displayName}{u.uid === me?.uid && <span className="ml-2 text-xs text-slate-400">(you)</span>}</td>
                <td className="px-4 py-2 text-slate-600">{u.email}</td>
                <td className="px-4 py-2">
                  <Select value={u.role} disabled={u.uid === me?.uid} onChange={(e) => change(u.uid, e.target.value as Role)} className="max-w-[240px]">
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>
                </td>
                <td className="px-4 py-2 text-right">
                  {u.uid !== me?.uid && <Button variant="ghost" className="text-red-600" onClick={() => remove(u.uid, u.displayName)}>Remove</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Tip: in People, enter each person's email so their own row is highlighted in the planner when they sign in.</p>
    </div>
  )
}
