import { useState } from 'react';
import { Link } from 'react-router-dom';

import { authApi, type AuthSuccess } from '../../lib/api';

type AuthTab = 'login' | 'signup';

type VerificationState = {
  email: string;
  verificationLinkPreview?: string;
};

interface AuthPageProps {
  onAuthSuccess: (auth: AuthSuccess) => Promise<void>;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function InputField({
  label,
  id,
  type,
  value,
  onChange,
  placeholder,
  error,
  autoComplete,
  rightEl,
}: {
  label: string;
  id: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
  rightEl?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`w-full rounded-xl border px-4 py-2.5 pr-10 text-sm text-slate-800 placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-cyan-500/50 ${
            error ? 'border-red-400 bg-red-50 focus:border-red-400' : 'border-slate-200 bg-white focus:border-cyan-400'
          }`}
        />
        {rightEl && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            {rightEl}
          </div>
        )}
      </div>
      {error && <p className="text-xs font-medium text-red-500">{error}</p>}
    </div>
  );
}

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [tab, setTab] = useState<AuthTab>('login');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [pendingTwoFactorToken, setPendingTwoFactorToken] = useState('');
  const [loginErrors, setLoginErrors] = useState<Record<string, string>>({});
  const [loginLoading, setLoginLoading] = useState(false);

  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [showSignupPwd, setShowSignupPwd] = useState(false);
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);
  const [signupErrors, setSignupErrors] = useState<Record<string, string>>({});
  const [signupLoading, setSignupLoading] = useState(false);

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [verificationState, setVerificationState] = useState<VerificationState | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [globalMessage, setGlobalMessage] = useState('');

  function validateEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validateLogin() {
    const errors: Record<string, string> = {};
    if (!loginEmail.trim()) errors.email = 'Email is required.';
    else if (!validateEmail(loginEmail)) errors.email = 'Enter a valid email.';
    if (!loginPassword) errors.password = 'Password is required.';
    setLoginErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validateSignup() {
    const errors: Record<string, string> = {};
    if (!signupName.trim()) errors.name = 'Full name is required.';
    if (!signupEmail.trim()) errors.email = 'Email is required.';
    else if (!validateEmail(signupEmail)) errors.email = 'Enter a valid email.';
    if (!signupPassword) errors.password = 'Password is required.';
    else if (signupPassword.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (!signupConfirm) errors.confirm = 'Please confirm your password.';
    else if (signupPassword !== signupConfirm) errors.confirm = 'Passwords do not match.';
    setSignupErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function resetMessages() {
    setGlobalError('');
    setGlobalMessage('');
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    resetMessages();
    if (!validateLogin()) return;
    setLoginLoading(true);
    try {
      const result = await authApi.login(loginEmail, loginPassword, rememberMe);
      if ('requiresTwoFactor' in result) {
        setPendingTwoFactorToken(result.tempToken);
        setGlobalMessage(result.message);
        return;
      }
      await onAuthSuccess(result);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleTwoFactorSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetMessages();
    setLoginLoading(true);
    try {
      const result = await authApi.loginWithTwoFactor(pendingTwoFactorToken, twoFactorCode);
      await onAuthSuccess(result);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Two-factor verification failed.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    resetMessages();
    if (!validateSignup()) return;
    setSignupLoading(true);
    try {
      const result = await authApi.register(signupName, signupEmail, signupPassword);
      setVerificationState({
        email: signupEmail,
        verificationLinkPreview: result.verificationLinkPreview,
      });
      setTab('login');
      setLoginEmail(signupEmail);
      setGlobalMessage(result.message);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    resetMessages();
    setLoginLoading(true);
    try {
      const result = await authApi.forgotPassword(forgotPasswordEmail);
      setGlobalMessage(result.resetLinkPreview ? `${result.message} Dev preview: ${result.resetLinkPreview}` : result.message);
      setForgotPasswordOpen(false);
      setForgotPasswordEmail('');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Unable to start password reset.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function resendVerification() {
    if (!verificationState?.email) return;
    resetMessages();
    try {
      const result = await authApi.resendVerification(verificationState.email);
      setVerificationState((prev) => (prev ? { ...prev, verificationLinkPreview: result.verificationLinkPreview } : prev));
      setGlobalMessage(result.verificationLinkPreview ? `${result.message} Dev preview: ${result.verificationLinkPreview}` : result.message);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to resend verification email.');
    }
  }

  function switchTab(next: AuthTab) {
    setTab(next);
    resetMessages();
    setForgotPasswordOpen(false);
    setLoginErrors({});
    setSignupErrors({});
    setPendingTwoFactorToken('');
    setTwoFactorCode('');
  }

  const passwordScore =
    (signupPassword.length >= 8 ? 1 : 0) +
    (/[A-Z]/.test(signupPassword) ? 1 : 0) +
    (/[0-9]/.test(signupPassword) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(signupPassword) ? 1 : 0);

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-slate-50 via-cyan-50/40 to-slate-100 px-4">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-cyan-200/25 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-slate-300/20 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="font-sans text-4xl font-extrabold tracking-tight text-slate-800">DocSynq</p>
          <p className="mt-1 text-base font-semibold text-cyan-700">Secure workspace authentication</p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-8 shadow-xl shadow-slate-200/60 backdrop-blur-sm">
          <div className="mb-8 flex rounded-xl bg-slate-100 p-1">
            {(['login', 'signup'] as AuthTab[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchTab(item)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all duration-200 ${
                  tab === item ? 'bg-white text-slate-800 shadow-sm shadow-slate-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {item === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          {verificationState && (
            <div className="mb-4 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">
              <p className="font-semibold">Verify your email before signing in</p>
              <p className="mt-1">A verification link was generated for {verificationState.email}.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" onClick={() => void resendVerification()} className="font-semibold text-cyan-700">
                  Resend verification
                </button>
                {verificationState.verificationLinkPreview && (
                  <a href={verificationState.verificationLinkPreview} className="font-semibold text-cyan-700">
                    Open dev verification link
                  </a>
                )}
              </div>
            </div>
          )}

          {globalMessage && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{globalMessage}</div>}
          {globalError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{globalError}</div>}

          {tab === 'login' && !pendingTwoFactorToken && !forgotPasswordOpen && (
            <form onSubmit={handleLogin} noValidate className="flex flex-col gap-5">
              <InputField
                label="Email"
                id="login-email"
                type="email"
                value={loginEmail}
                onChange={setLoginEmail}
                placeholder="you@example.com"
                autoComplete="email"
                error={loginErrors.email}
              />
              <InputField
                label="Password"
                id="login-password"
                type={showLoginPwd ? 'text' : 'password'}
                value={loginPassword}
                onChange={setLoginPassword}
                placeholder="Enter your password"
                autoComplete="current-password"
                error={loginErrors.password}
                rightEl={
                  <button
                    type="button"
                    onClick={() => setShowLoginPwd((value) => !value)}
                    className="text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label={showLoginPwd ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon visible={showLoginPwd} />
                  </button>
                }
              />

              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded accent-cyan-600"
                  />
                  Remember me
                </label>
                <button type="button" onClick={() => setForgotPasswordOpen(true)} className="text-sm font-semibold text-cyan-700 hover:underline">
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="mt-1 flex w-full items-center justify-center rounded-xl bg-cyan-700 py-2.5 text-sm font-bold text-white shadow-md shadow-cyan-200 transition-all hover:bg-cyan-600 disabled:opacity-60"
              >
                {loginLoading ? 'Signing in...' : 'Sign In'}
              </button>

              <p className="text-center text-sm text-slate-500">
                Don't have an account?{' '}
                <button type="button" onClick={() => switchTab('signup')} className="font-semibold text-cyan-700 hover:underline">
                  Create one
                </button>
              </p>
            </form>
          )}

          {tab === 'login' && pendingTwoFactorToken && (
            <form onSubmit={handleTwoFactorSubmit} className="flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-black text-slate-900">Two-factor verification</h2>
                <p className="mt-1 text-sm text-slate-600">Enter the 6-digit code from your authenticator app.</p>
              </div>
              <InputField
                label="Authentication code"
                id="two-factor-code"
                type="text"
                value={twoFactorCode}
                onChange={setTwoFactorCode}
                placeholder="123456"
                autoComplete="one-time-code"
              />
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full rounded-xl bg-cyan-700 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {loginLoading ? 'Verifying...' : 'Verify and continue'}
              </button>
              <button type="button" onClick={() => setPendingTwoFactorToken('')} className="text-sm font-semibold text-slate-500">
                Back to password sign in
              </button>
            </form>
          )}

          {tab === 'login' && forgotPasswordOpen && (
            <form onSubmit={handleForgotPassword} className="flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-black text-slate-900">Reset your password</h2>
                <p className="mt-1 text-sm text-slate-600">We will generate a secure reset link for your account.</p>
              </div>
              <InputField
                label="Email"
                id="forgot-password-email"
                type="email"
                value={forgotPasswordEmail}
                onChange={setForgotPasswordEmail}
                placeholder="you@example.com"
                autoComplete="email"
              />
              <button type="submit" disabled={loginLoading} className="w-full rounded-xl bg-cyan-700 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                {loginLoading ? 'Generating link...' : 'Send reset link'}
              </button>
              <button type="button" onClick={() => setForgotPasswordOpen(false)} className="text-sm font-semibold text-slate-500">
                Back to sign in
              </button>
            </form>
          )}

          {tab === 'signup' && (
            <form onSubmit={handleSignup} noValidate className="flex flex-col gap-5">
              <InputField
                label="Full Name"
                id="signup-name"
                type="text"
                value={signupName}
                onChange={setSignupName}
                placeholder="Jane Smith"
                autoComplete="name"
                error={signupErrors.name}
              />
              <InputField
                label="Email"
                id="signup-email"
                type="email"
                value={signupEmail}
                onChange={setSignupEmail}
                placeholder="you@example.com"
                autoComplete="email"
                error={signupErrors.email}
              />
              <InputField
                label="Password"
                id="signup-password"
                type={showSignupPwd ? 'text' : 'password'}
                value={signupPassword}
                onChange={setSignupPassword}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                error={signupErrors.password}
                rightEl={
                  <button
                    type="button"
                    onClick={() => setShowSignupPwd((value) => !value)}
                    className="text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label={showSignupPwd ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon visible={showSignupPwd} />
                  </button>
                }
              />
              <InputField
                label="Confirm Password"
                id="signup-confirm"
                type={showSignupConfirm ? 'text' : 'password'}
                value={signupConfirm}
                onChange={setSignupConfirm}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                error={signupErrors.confirm}
                rightEl={
                  <button
                    type="button"
                    onClick={() => setShowSignupConfirm((value) => !value)}
                    className="text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label={showSignupConfirm ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon visible={showSignupConfirm} />
                  </button>
                }
              />

              {signupPassword.length > 0 && (
                <div className="flex items-center gap-2">
                  {['weak', 'fair', 'good', 'strong'].map((level, index) => {
                    const filled = index < passwordScore;
                    const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];
                    return <div key={level} className={`h-1.5 flex-1 rounded-full ${filled ? colors[Math.max(passwordScore - 1, 0)] : 'bg-slate-200'}`} />;
                  })}
                  <span className="w-12 text-xs font-medium text-slate-500">{['Weak', 'Fair', 'Good', 'Strong'][Math.max(passwordScore - 1, 0)] ?? 'Weak'}</span>
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-600">
                <input type="checkbox" required className="mt-0.5 h-4 w-4 rounded accent-cyan-600" />
                <span>
                  I agree to the <span className="font-semibold text-cyan-700">Terms of Service</span> and <span className="font-semibold text-cyan-700">Privacy Policy</span>
                </span>
              </label>

              <button
                type="submit"
                disabled={signupLoading}
                className="mt-1 flex w-full items-center justify-center rounded-xl bg-cyan-700 py-2.5 text-sm font-bold text-white shadow-md shadow-cyan-200 transition-all hover:bg-cyan-600 disabled:opacity-60"
              >
                {signupLoading ? 'Creating account...' : 'Create Account'}
              </button>

              <p className="text-center text-sm text-slate-500">
                Already have an account?{' '}
                <button type="button" onClick={() => switchTab('login')} className="font-semibold text-cyan-700 hover:underline">
                  Sign in
                </button>
              </p>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Need help verifying or resetting? <Link to="/verify-email" className="font-semibold text-cyan-700">Open verification tools</Link>
        </p>
      </div>
    </div>
  );
}
