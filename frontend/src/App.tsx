import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuthStore } from './store/authStore';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './components/Layout/DashboardLayout';
import Dashboard from './pages/Dashboard';
import CampaignsList from './pages/Campaigns/CampaignsList';
import CampaignDetail from './pages/Campaigns/CampaignDetail';
import ProjectDetail from './pages/Projects/ProjectDetail';
import TaskDetail from './pages/Tasks/TaskDetail';
import UserManagement from './pages/Admin/UserManagement';
import DetailsSheet from './pages/DetailsSheet';

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
        <Route path="admin/users" element={<UserManagement />} />
      </Route>
    </Routes>
  );
}

export default App;
