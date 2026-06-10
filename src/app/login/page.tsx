'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { db } from '@/lib/db';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await db.auth.sendMagicCode({ email });
      setStage('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await db.auth.signInWithMagicCode({ email, code });
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm px-6 pt-20 pb-10 rise-in">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent mb-3">
        Sign in
      </p>
      <h1 className="font-display font-semibold text-3xl tracking-tight mb-2">
        {stage === 'email' ? 'Who goes there?' : 'Check your inbox'}
      </h1>
      <p className="text-sm text-ink-soft mb-8">
        {stage === 'email'
          ? 'We’ll email you a one-time code — no password needed. Sign in to claim and edit your profile.'
          : `We sent a 6-digit code to ${email}.`}
      </p>

      {stage === 'email' ? (
        <form onSubmit={sendCode} className="space-y-3">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-card border border-line px-3 py-2.5 text-sm outline-none focus:border-accent placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-ink text-paper py-2.5 font-mono text-xs uppercase tracking-widest hover:bg-accent transition-colors disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <input
            type="text"
            inputMode="numeric"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            className="w-full bg-card border border-line px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] outline-none focus:border-accent placeholder:text-faint placeholder:tracking-[0.4em]"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-ink text-paper py-2.5 font-mono text-xs uppercase tracking-widest hover:bg-accent transition-colors disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage('email');
              setCode('');
              setError(null);
            }}
            className="w-full py-1 font-mono text-xs text-faint hover:text-ink transition-colors"
          >
            Use a different email
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-accent-deep">{error}</p>}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
