import { useState } from 'react';
import { ssoApi } from '../../services/ssoApi';

interface SsoLoginFormProps {
  onSsoStart?: () => void;
  onError?: (error: string) => void;
}

function SsoLoginForm({ onSsoStart, onError }: SsoLoginFormProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssoInfo, setSsoInfo] = useState<{ provider: string; authUrl: string } | null>(null);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setError(null);
  };

  const handleGetAuthUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (!email || !email.includes('@')) {
        throw new Error('Please enter a valid email address');
      }

      const { authorizationUrl } = await ssoApi.getAuthorizationUrl(email);
      setSsoInfo({ provider: 'SSO', authUrl: authorizationUrl });
      onSsoStart?.();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get authorization URL';
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueWithSso = () => {
    if (ssoInfo?.authUrl) {
      window.location.href = ssoInfo.authUrl;
    }
  };

  if (ssoInfo) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-900">
            You'll be redirected to {ssoInfo.provider} to complete your sign in.
          </p>
        </div>
        <button
          onClick={handleContinueWithSso}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          Continue to {ssoInfo.provider}
        </button>
        <button
          onClick={() => {
            setSsoInfo(null);
            setEmail('');
          }}
          className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleGetAuthUrl} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
          Work Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={handleEmailChange}
          placeholder="you@company.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
      </div>

      <button
        type="submit"
        disabled={isLoading || !email}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {isLoading ? 'Checking...' : 'Continue with SSO'}
      </button>
    </form>
  );
}

export default SsoLoginForm;
