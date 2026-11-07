import { lazy, useCallback } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../features/auth/hooks/useAuth';
import { getOrgSlugFromHost } from '../utils/tenantHost';
import { docsApi } from '../services/api';

const AuthPage = lazy(() => import('../pages/AuthPage'));
const OrgLoginPage = lazy(() => import('../pages/OrgLoginPage'));
const SsoCallbackPage = lazy(() => import('../pages/SsoCallbackPage'));
const SamlCallbackPage = lazy(() => import('../pages/SamlCallbackPage'));
const SamlAuthorizePage = lazy(() => import('../pages/SamlAuthorizePage'));
const LandingPage = lazy(() => import('../pages/LandingPage'));
const AdminLoginPage = lazy(() => import('../pages/AdminLoginPage'));
const TenantAdminPage = lazy(() => import('../pages/TenantAdminPage'));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage'));
const SettingsDashboardPage = lazy(() => import('../pages/SettingsDashboardPage'));
const VerifyEmailPage = lazy(() => import('../pages/VerifyEmailPage'));
const AcceptInvitePage = lazy(() => import('../pages/AcceptInvitePage'));
const WorkspaceHomePage = lazy(() => import('../pages/WorkspaceHomePage'));
const BuyPlanPage = lazy(() => import('../pages/BuyPlanPage'));
const EditorPage = lazy(() => import('../pages/EditorPage'));
const DocumentViewerPage = lazy(() => import('../pages/DocumentViewerPage'));

function EditorRoute({ token }: { token: string }) {
  const { docId = '' } = useParams();
  if (!docId) return <Navigate to="/workspace" replace />;
  return <EditorPage token={token} docId={docId} />;
}

function ReadOnlyDocumentRoute({ token, userName }: { token: string; userName: string }) {
  const { docId = '' } = useParams();
  if (!docId) return <Navigate to="/workspace" replace />;
  return <DocumentViewerPage token={token} docId={docId} userName={userName} />;
}

function AppRoutes() {
  const navigate = useNavigate();
  const {
    session,
    adminSession,
    applySession,
    applyAdminSession,
    handleAuthSuccess,
    handleUserUpdate,
    handleLogout,
  } = useAuth();

  const handleOpenDocument = useCallback((docId: string) => {
    navigate(`/editor/${docId}`);
  }, [navigate]);

  const handleOpenReadOnlyDocument = useCallback((docId: string) => {
    navigate(`/viewer/${docId}`);
  }, [navigate]);

  const handleCreateDocument = useCallback(
    async (title: string, content: string, workspaceId?: string | null) => {
      if (!session) return;
      const { doc } = await docsApi.create(session.accessToken, title, content, null, workspaceId ?? null);
      navigate(`/editor/${doc.id}`);
    },
    [navigate, session],
  );

  const handleOpenSecuritySettings = useCallback(() => {
    navigate('/settings?view=security');
  }, [navigate]);

  const handleOpenProfile = useCallback(() => {
    navigate('/settings?view=profile');
  }, [navigate]);

  const handleOpenSettingsDashboard = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  // On an organization's address (acme.docsync.com) the root and sign-in pages are that workspace's login.
  const orgSlug = getOrgSlugFromHost();

  return (
    <Routes>
      <Route
        path="/"
        element={
          session ? (
            <Navigate to="/workspace" replace />
          ) : orgSlug ? (
            <Navigate to="/auth" replace />
          ) : (
            <LandingPage
              onGetStarted={() => navigate('/auth')}
              onSignIn={() => navigate('/auth')}
            />
          )
        }
      />
      <Route
        path="/home"
        element={
          <LandingPage
            onGetStarted={() => navigate(session ? '/workspace' : '/auth')}
            onSignIn={() => navigate('/auth')}
            isSignedIn={Boolean(session)}
            userName={session?.user.name || 'Workspace User'}
            onOpenProfile={handleOpenProfile}
            onLogout={handleLogout}
            onOpenWorkspace={() => navigate('/workspace')}
          />
        }
      />
      <Route
        path="/auth"
        element={
          session ? <Navigate to="/workspace" replace /> : orgSlug ? <OrgLoginPage slug={orgSlug} onAuthSuccess={handleAuthSuccess} /> : <AuthPage onAuthSuccess={handleAuthSuccess} />
        }
      />
      <Route
        path="/auth/callback"
        element={<SsoCallbackPage />}
      />
      <Route
        path="/auth/saml/authorize"
        element={<SamlAuthorizePage />}
      />
      <Route
        path="/auth/saml/success"
        element={<SamlCallbackPage />}
      />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invites/:token" element={<AcceptInvitePage />} />
      <Route path="/security" element={<Navigate to="/settings?view=security" replace />} />
      <Route
        path="/admin/auth/callback"
        element={<SsoCallbackPage />}
      />
      <Route
        path="/workspace"
        element={
          session ? (
            <WorkspaceHomePage
              token={session.accessToken}
              userName={session.user.name}
              onOpenDocument={handleOpenDocument}
              onOpenReadOnlyDocument={handleOpenReadOnlyDocument}
              onCreateDocument={handleCreateDocument}
              onOpenProfile={handleOpenProfile}
              onOpenSecuritySettings={handleOpenSecuritySettings}
              onOpenSettingsDashboard={handleOpenSettingsDashboard}
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/home" replace />
          )
        }
      />
      <Route
        path="/admin"
        element={
          adminSession ? (
            <TenantAdminPage
              token={adminSession.accessToken}
              userName={adminSession.user.name}
              onAdminLogout={() => applyAdminSession(null)}
            />
          ) : (
            <AdminLoginPage onAuthSuccess={applyAdminSession} />
          )
        }
      />
      <Route
        path="/enterprise-security"
        element={
          session ? (
            <Navigate to="/settings" replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/settings"
        element={
          session ? (
            <SettingsDashboardPage
              token={session.accessToken}
              userName={session.user.name}
              user={session.user}
              onUserUpdate={handleUserUpdate}
              onLoggedOut={() => {
                applySession(null);
                navigate('/auth', { replace: true });
              }}
            />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/tenant-audit"
        element={
          session ? (
            <Navigate to="/settings" replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/billing"
        element={
          session ? (
            <Navigate to="/billing/upgrade" replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/billing/upgrade"
        element={
          session ? (
            <BuyPlanPage
              token={session.accessToken}
              userName={session.user.name}
            />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/editor/:docId"
        element={
          session ? <EditorRoute token={session.accessToken} /> : <Navigate to="/auth" replace />
        }
      />
      <Route
        path="/viewer/:docId"
        element={
          session ? <ReadOnlyDocumentRoute token={session.accessToken} userName={session.user.name} /> : <Navigate to="/auth" replace />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default AppRoutes;
