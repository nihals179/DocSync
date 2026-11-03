import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ssoApi } from '../services/ssoApi';
import AppLoadingScreen from '../components/common/AppLoadingScreen';

function SamlAuthorizePage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initiateSamlLogin() {
      try {
        const email = searchParams.get('email');
        if (!email || !email.includes('@')) {
          setError('Valid email is required to initiate SAML login');
          return;
        }

        const { authorizationUrl } = await ssoApi.getSamlAuthorizationUrl(email);

        // Redirect to Identity Provider for SAML login
        window.location.href = authorizationUrl;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initiate SAML login');
      }
    }

    initiateSamlLogin();
  }, [searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-red-100">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-center text-xl font-semibold text-gray-900 mb-2">SAML Login Failed</h2>
          <p className="text-center text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.href = '/auth'}
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
      title="Redirecting to SAML Provider"
      subtitle="Please wait while we redirect you to your Identity Provider..."
    />
  );
}

export default SamlAuthorizePage;
