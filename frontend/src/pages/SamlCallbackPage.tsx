import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/hooks/useAuth';
import { authApi } from '../services/api';
import AppLoadingScreen from '../components/common/AppLoadingScreen';

function SamlCallbackPage() {
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // The backend ACS endpoint already validated the SAML response and set the
    // session cookies; restore the session from them.
    authApi
      .refresh()
      .then((auth) => {
        applySession(auth);
        navigate('/workspace', { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to complete SAML sign in');
      });
  }, [applySession, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-red-100">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-center text-xl font-semibold text-gray-900 mb-2">SAML Authentication Failed</h2>
          <p className="text-center text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/auth', { replace: true })}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppLoadingScreen
      title="Completing SAML Sign In"
      subtitle="Restoring your session..."
    />
  );
}

export default SamlCallbackPage;
