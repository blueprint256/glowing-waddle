import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from './store/authStore';
import DashboardLayout from './components/Layout/DashboardLayout';

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
        <Route path="admin/users" element={<UserManagement />} />
        <Route path="admin/users/:id" element={<UserDetail />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default App;
