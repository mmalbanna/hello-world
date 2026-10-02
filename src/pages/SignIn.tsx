import { useState, type FormEvent } from 'react'
import { useStore } from '../store/useStore'
import { Button, Field, Input } from '../components/ui'

export default function SignIn() {
  const { signIn, signUp, resetPassword, toast } = useStore()
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'in') await signIn(email, password)
      else if (mode === 'up') {
        if (!name.trim()) throw new Error('Enter your name as the team should see it.')
        await signUp(email, password, name)
      } else {
        await resetPassword(email)
        toast('Password reset email sent.', 'success')
        setMode('in')
      }
    } catch (ex) {
      const msg = (ex as { code?: string; message: string })
      const friendly: Record<string, string> = {
        'auth/invalid-credential': 'Wrong email or password.',
        'auth/user-not-found': 'No account with that email. Create one below.',
        'auth/wrong-password': 'Wrong password.',
        'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'That email address is not valid.',
        'auth/network-request-failed': 'No connection. Check your network and try again.',
        'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase Authentication yet.',
      }
      setErr(friendly[msg.code ?? ''] ?? msg.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Resource allocation</div>
        <h1 className="text-2xl font-bold text-brand">BIM Planner</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === 'in' && 'Sign in to see the team plan.'}
          {mode === 'up' && 'Create your account. An admin will grant you access after sign-up.'}
          {mode === 'reset' && 'We will email you a reset link.'}
        </p>
        <div className="mt-5 space-y-3">
          {mode === 'up' && (
            <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Raja" /></Field>
          )}
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required inputMode="email" /></Field>
          {mode !== 'reset' && (
            <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={6} /></Field>
          )}
        </div>
        {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        <Button type="submit" variant="primary" className="mt-5 w-full" busy={busy}>
          {mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
        </Button>
        <div className="mt-4 flex justify-between text-xs text-slate-600">
          {mode !== 'in' ? <button type="button" className="underline" onClick={() => setMode('in')}>Back to sign in</button> : <button type="button" className="underline" onClick={() => setMode('up')}>Create account</button>}
          {mode === 'in' && <button type="button" className="underline" onClick={() => setMode('reset')}>Forgot password?</button>}
        </div>
      </form>
    </div>
  )
}
