import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardLayout from './components/Layout/DashboardLayout';
import Dashboard from './pages/Dashboard';
import CampaignsList from './pages/Campaigns/CampaignsList';
import CampaignDetail from './pages/Campaigns/CampaignDetail';
import ProjectDetail from './pages/Projects/ProjectDetail';
import TaskDetail from './pages/Tasks/TaskDetail';
import UserManagement from './pages/Admin/UserManagement';
import UserDetail from './pages/Admin/UserDetail';
import DetailsSheet from './pages/DetailsSheet';
import Calendar from './pages/Calendar';
import TasksSheet from './pages/TasksSheet';
import Settings from './pages/Settings';

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
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
  );
}

export default App;
