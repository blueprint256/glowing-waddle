import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from './store/authStore';
import DashboardLayout from './components/Layout/DashboardLayout';
import { getReturnTo } from './utils/returnTo';
import { UserRole } from './types';

// Route-level code splitting: each page is its own chunk, fetched on first visit.
// (Settings, DetailsSheet and Calendar are the heaviest — they no longer load at login.)
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CampaignsList = lazy(() => import('./pages/Campaigns/CampaignsList'));
const CampaignDetail = lazy(() => import('./pages/Campaigns/CampaignDetail'));
const ProjectDetail = lazy(() => import('./pages/Projects/ProjectDetail'));
const TaskDetail = lazy(() => import('./pages/Tasks/TaskDetail'));
const UserManagement = lazy(() => import('./pages/Admin/UserManagement'));
const OutreachPage = lazy(() => import('./pages/Admin/OutreachPage'));
const InboxPage = lazy(() => import('./pages/Inbox/InboxPage'));
const UserDetail = lazy(() => import('./pages/Admin/UserDetail'));
const DetailsSheet = lazy(() => import('./pages/DetailsSheet'));
const Calendar = lazy(() => import('./pages/Calendar'));
const TasksSheet = lazy(() => import('./pages/TasksSheet'));
const Settings = lazy(() => import('./pages/Settings'));
const OAuthConsent = lazy(() => import('./pages/OAuth/OAuthConsent'));
const LibraryPage = lazy(() => import('./pages/Library/LibraryPage'));
const LibraryItemPage = lazy(() => import('./pages/Library/LibraryItemPage'));
const PublishingPage = lazy(() => import('./pages/Publishing/PublishingPage'));
const BluePage = lazy(() => import('./pages/Blue/BluePage'));

function PageFallback() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
      <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
    </Box>
  );
}

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100dvh">
        <CircularProgress />
      </Box>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

/** Admin pages: the server enforces this too; this just avoids showing a broken page to other users. */
function AdminRoute({ children }: { children: JSX.Element }) {
  const { user } = useAuthStore();
  return user?.role === UserRole.SYSTEM_ADMIN ? children : <Navigate to="/" replace />;
}

function App() {
  const { checkAuth } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  // A 401 from any API call means the session ended: re-check once, which sends the user to login.
  useEffect(() => {
    let checking = false;
    const onExpired = () => {
      if (checking || !useAuthStore.getState().isAuthenticated) return;
      checking = true;
      checkAuth().finally(() => {
        checking = false;
      });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [checkAuth]);

  useEffect(() => {
    checkAuth().then(() => {
      // Signed in via a full-page redirect (e.g. Google) while connecting Claude: resume the consent screen.
      const returnTo = getReturnTo();
      if (useAuthStore.getState().isAuthenticated && returnTo && `${location.pathname}${location.search}` !== returnTo) {
        navigate(returnTo, { replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      {/* Claude connector consent screen (handles its own sign-in redirect) */}
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      {/* Unknown addresses go home instead of showing an empty page */}
      <Route path="*" element={<Navigate to="/" replace />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="campaigns" element={<CampaignsList />} />
        <Route path="campaigns/:id" element={<CampaignDetail />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="details-sheet" element={<DetailsSheet />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="tasks-sheet" element={<TasksSheet />} />
        <Route path="settings" element={<Settings />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="library/:id" element={<LibraryItemPage />} />
        <Route path="publishing" element={<PublishingPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="blue" element={<BluePage />} />
        <Route path="admin/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
        <Route path="admin/users/:id" element={<AdminRoute><UserDetail /></AdminRoute>} />
        <Route path="admin/outreach" element={<AdminRoute><OutreachPage /></AdminRoute>} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default App;
