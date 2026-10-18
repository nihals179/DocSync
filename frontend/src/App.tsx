import { Suspense, useEffect, useState } from 'react';

import AppLoadingScreen from './components/common/AppLoadingScreen';
import { AuthProvider, useAuth } from './features/auth/context/AuthContext';
import AppRoutes from './routes/AppRoutes';
import { NETWORK_ACTIVITY_EVENT } from './services/api';

// ─── App shell ────────────────────────────────────────────────────────────────
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { authReady } = useAuth();
  const [isGlobalNetworkLoading, setIsGlobalNetworkLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleNetworkActivity = (event: Event) => {
      const customEvent = event as CustomEvent<{ activeRequests?: number; isLoading?: boolean }>;
      const activeRequests = Number(customEvent.detail?.activeRequests || 0);
      setIsGlobalNetworkLoading(activeRequests > 0);
    };

    window.addEventListener(NETWORK_ACTIVITY_EVENT, handleNetworkActivity as EventListener);
    return () => {
      window.removeEventListener(NETWORK_ACTIVITY_EVENT, handleNetworkActivity as EventListener);
    };
  }, []);

  return (
    <>
      <Suspense
        fallback={(
          <AppLoadingScreen title="Loading DocSync" subtitle="Preparing your workspace and editor modules..." />
        )}
      >
        <AppRoutes />
      </Suspense>
      {!authReady && (
        <AppLoadingScreen
          title="Restoring your secure session"
          subtitle="Syncing credentials and workspace state..."
        />
      )}
      {authReady && isGlobalNetworkLoading && (
        <AppLoadingScreen
          title="Loading data"
          subtitle="Fetching the latest information..."
        />
      )}
    </>
  );
}

export default App;
