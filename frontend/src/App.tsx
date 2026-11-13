import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from './store/authStore';
import DashboardLayout from './components/Layout/DashboardLayout';
import { AccessMode, hasPartAccess } from './types';

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
const UserDetail = lazy(() => import('./pages/Admin/UserDetail'));
const DetailsSheet = lazy(() => import('./pages/DetailsSheet'));
const Calendar = lazy(() => import('./pages/Calendar'));
const TasksSheet = lazy(() => import('./pages/TasksSheet'));
const Settings = lazy(() => import('./pages/Settings'));
// Part two: Content Hub
const HubProjects = lazy(() => import('./pages/ContentHub/HubProjects'));
const HubProjectDetail = lazy(() => import('./pages/ContentHub/HubProjectDetail'));
const HubUpload = lazy(() => import('./pages/ContentHub/HubUpload'));

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

/**
 * Keeps a user inside the part(s) a System Admin enabled for them. The API enforces the same
 * rule (403 ACCESS_RESTRICTED); this just sends people somewhere useful instead of an error.
 */
function RequirePart({ part }: { part: AccessMode.PART_ONE | AccessMode.PART_TWO }) {
  const { user } = useAuthStore();
  if (hasPartAccess(user, part)) return <Outlet />;
  return <Navigate to={part === AccessMode.PART_ONE ? '/hub' : '/'} replace />;
}

function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      {/* Public guest upload: the one-time link token is the credential (no login) */}
      <Route path="/upload" element={<HubUpload />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        {/* Part one: full campaign suite */}
        <Route element={<RequirePart part={AccessMode.PART_ONE} />}>
          <Route index element={<Dashboard />} />
          <Route path="campaigns" element={<CampaignsList />} />
          <Route path="campaigns/:id" element={<CampaignDetail />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="details-sheet" element={<DetailsSheet />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="tasks-sheet" element={<TasksSheet />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Part two: Content Hub */}
        <Route element={<RequirePart part={AccessMode.PART_TWO} />}>
          <Route path="hub" element={<HubProjects />} />
          <Route path="hub/projects/:projectId" element={<HubProjectDetail />} />
        </Route>

        <Route path="admin/users" element={<UserManagement />} />
        <Route path="admin/users/:id" element={<UserDetail />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default App;
