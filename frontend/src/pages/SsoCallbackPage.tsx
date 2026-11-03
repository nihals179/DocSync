import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../features/auth/hooks/useAuth';
import AppLoadingScreen from '../components/common/AppLoadingScreen';

function SsoCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { applySession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const exchangeStartedRef = useRef(false);

  useEffect(() => {
    // Authorization codes are single-use; never exchange the same code twice.
    if (exchangeStartedRef.current) return;
    exchangeStartedRef.current = true;

    async function handleCallback() {
      try {
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const errorParam = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');

        if (errorParam) {
          setError(errorDescription || 'SSO authentication failed');
          setIsProcessing(false);
          return;
        }

        if (!code || !state) {
          setError('Missing authentication parameters');
          setIsProcessing(false);
          return;
        }

        // Exchange code for session via backend
        const response = await fetch('/api/auth/sso/exchange-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code, state }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          setError(errorData.error || 'Failed to authenticate');
          setIsProcessing(false);
          return;
        }

        const data = await response.json();
        // Apply session (stores token in cookies)
        applySession(data);
        navigate('/workspace', { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        setIsProcessing(false);
      }
    }

    handleCallback();
  }, [searchParams, applySession, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-red-100">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-center text-xl font-semibold text-gray-900 mb-2">Authentication Failed</h2>
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
      title={isProcessing ? 'Completing Sign In' : 'Redirecting to workspace...'}
      subtitle="Processing your SSO authentication..."
    />
  );
}

export default SsoCallbackPage;
