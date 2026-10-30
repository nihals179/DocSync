import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { tenantsApi } from '../services/api';
import { useAuth } from '../features/auth/hooks/useAuth';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<{ email?: string; tenantId?: string } | null>(null);
  // Invite tokens are single-use: send the accept once per token, even when StrictMode
  // re-runs the effect or the session finishes restoring after the first render.
  const acceptedTokenRef = useRef<string | null>(null);
  const accessTokenRef = useRef(session?.accessToken);
  useEffect(() => {
    accessTokenRef.current = session?.accessToken;
  }, [session?.accessToken]);

  // Accept invite immediately (no authentication required)
  useEffect(() => {
    if (!token || acceptedTokenRef.current === token) {
      return;
    }
    acceptedTokenRef.current = token;

    const acceptInvite = async () => {
      try {
        setLoading(true);
        const accessToken = accessTokenRef.current;
        const response = accessToken
          ? await tenantsApi.acceptInvite(accessToken, token)
          : await tenantsApi.acceptInviteAnonymous(token);

        setInviteInfo({ email: response.email, tenantId: response.tenantId });
        setSuccess(true);
        setLoading(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to accept invite';
        console.error('Error accepting invite:', message, err);
        setError(message);
        setLoading(false);
      }
    };

    acceptInvite();
  }, [token]);

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <div className="mb-4 text-5xl">❌</div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Invalid Invitation</h1>
            <p className="text-slate-700 mb-6">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2.5 px-4 rounded-xl transition"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show success page after invitation is accepted
  if (success) {
    const nextAction = session?.accessToken
      ? { label: 'Go to Workspace', path: '/workspace' }
      : { label: 'Create Account & Access Workspace', path: `/auth?mode=register&email=${encodeURIComponent(inviteInfo?.email || '')}` };

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <div className="mb-4 text-5xl">✅</div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Invitation Accepted!</h1>
            <p className="text-slate-700 mb-2">
              Your invitation has been accepted successfully.
            </p>
            <p className="text-sm text-slate-600 mb-8">
              Invited email: <span className="font-semibold text-slate-900">{inviteInfo?.email}</span>
            </p>

            <div className="space-y-3 pt-6 border-t border-slate-200">
              <button
                onClick={() => navigate(nextAction.path, { replace: true })}
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-xl transition flex items-center justify-center gap-2"
              >
                <span>→</span>
                <span>{nextAction.label}</span>
              </button>

              {session?.accessToken && (
                <button
                  onClick={() => navigate('/auth', { replace: true })}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold py-2.5 px-4 rounded-xl transition"
                >
                  Sign In with Different Account
                </button>
              )}

              {!session?.accessToken && (
                <button
                  onClick={() => navigate('/auth', { replace: true })}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold py-2.5 px-4 rounded-xl transition"
                >
                  Sign In Instead
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Loading state - processing invitation
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-slate-200"></div>
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-cyan-600 animate-spin"></div>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Accepting Invite</h1>
            <p className="text-slate-700">Please wait while we process your invitation...</p>
          </div>
        </div>
      </div>
    );
  }

  // Fallback - should not reach here
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-md p-8 text-center">
          <div className="mb-4 text-5xl">❓</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Loading</h1>
          <p className="text-slate-700">Initializing invitation page...</p>
        </div>
      </div>
    </div>
  );
}
