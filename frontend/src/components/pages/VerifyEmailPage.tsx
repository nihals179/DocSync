import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { authApi } from '../../lib/api';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setStatus('loading');
    authApi
      .verifyEmail(token)
      .then((result) => {
        if (cancelled) return;
        setStatus('success');
        setMessage(result.message);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Verification failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Email Verification</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Confirm your account</h1>
        <p className="mt-2 text-sm text-slate-600">
          {token
            ? 'We are validating your verification link.'
            : 'A verification token is required to activate your account.'}
        </p>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          {status === 'loading' && 'Verifying your email...'}
          {status === 'success' && message}
          {status === 'error' && message}
          {status === 'idle' && !token && 'Open the verification link from your email and try again.'}
        </div>

        <div className="mt-6 flex gap-3">
          <Link
            to="/auth"
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white"
          >
            Go To Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
