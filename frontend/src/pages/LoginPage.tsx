import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  Divider,
  Link
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import { useAuthStore } from '../store/authStore';
import { getReturnTo } from '../utils/returnTo';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated, checkAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if returning from Google OAuth
    const authStatus = searchParams.get('auth');
    if (authStatus === 'success') {
      checkAuth().then(() => {
        navigate(getReturnTo() || '/');
      });
    }
  }, [searchParams, checkAuth, navigate]);

  useEffect(() => {
    // Already signed in (or just signed in): continue to where the user was going.
    if (isAuthenticated) navigate(getReturnTo() || '/', { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate(getReturnTo() || '/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${apiUrl}/auth/google`;
  };

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            Campaign Management
          </Typography>
          <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary">
            Sign in to your account
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 3 }}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              margin="normal"
              required
              autoFocus
            />
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              sx={{ mt: 3 }}
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>

            <Divider sx={{ my: 3 }}>OR</Divider>

            <Button
              fullWidth
              variant="outlined"
              size="large"
              startIcon={<GoogleIcon />}
              onClick={handleGoogleLogin}
              disabled={loading}
              sx={{
                borderColor: '#4285f4',
                color: '#4285f4',
                '&:hover': {
                  borderColor: '#357ae8',
                  backgroundColor: 'rgba(66, 133, 244, 0.04)'
                }
              }}
            >
              Sign in with Google
            </Button>

            {/* Demo logins are only shown when VITE_SHOW_DEMO_LOGINS=true (never on a shared or live app). */}
            {import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true' && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary">
                Demo credentials:
              </Typography>
              <Typography variant="caption" display="block">
                Admin: admin@example.com / password123
              </Typography>
              <Typography variant="caption" display="block">
                Hybrid: hybrid@example.com / password123
              </Typography>
              <Typography variant="caption" display="block">
                Marketer: marketer@example.com / password123
              </Typography>
            </Box>
            )}

            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Don't have an account?{' '}
                <Link component={RouterLink} to="/signup" underline="hover">
                  Sign up
                </Link>
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
}
