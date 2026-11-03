interface SsoLoginFormProps {
  onSsoStart?: () => void;
}

function SsoLoginForm({ onSsoStart }: SsoLoginFormProps) {
  function startIndividualLogin(provider: 'google' | 'microsoft') {
    onSsoStart?.();
    window.location.href = `/api/auth/sso/login/${provider}`;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Personal account sign-in</p>
      <button type="button" onClick={() => startIndividualLogin('google')} className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
        Continue with Google
      </button>
      <button type="button" onClick={() => startIndividualLogin('microsoft')} className="w-full rounded-lg bg-gray-800 px-4 py-2 font-medium text-white hover:bg-gray-700">
        Continue with Microsoft
      </button>
    </div>
  );
}

export default SsoLoginForm;
