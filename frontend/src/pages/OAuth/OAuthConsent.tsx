import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Link,
  Paper,
  Stack,
  Typography
} from '@mui/material';
import {
  CheckCircleOutline as CheckIcon,
  LinkOff as LinkOffIcon,
  Lock as LockIcon
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { oauthAPI } from '../../services/api';
import { clearReturnTo, setReturnTo } from '../../utils/returnTo';
import { UserRole } from '../../types';

interface ConsentRequest {
  requestId: string;
  status: 'pending' | 'approved' | 'denied' | 'used';
  clientName: string;
  redirectHost: string;
  connectorAllowed: boolean;
  user: { email: string; firstName: string; lastName: string; role: UserRole; accessMode?: string };
}

/**
 * Consent screen for connecting an AI assistant (Claude) through the MCP connector.
 * The backend's /oauth/authorize sends the browser here; after the decision we send it back to Claude.
 */
export default function OAuthConsent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('request_id') || '';
  const { isAuthenticated, isLoading, logout } = useAuthStore();

  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);

  // Not signed in: remember this page, sign in, come back.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setReturnTo(`/oauth/consent?request_id=${encodeURIComponent(requestId)}`);
      navigate('/login', { replace: true });
      return;
    }
    clearReturnTo();
    if (!requestId) {
      setError('This link is incomplete. Start the connection again from Claude.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    oauthAPI
      .getRequest(requestId)
      .then((res) => {
        if (!cancelled) setRequest(res.data.request);
      })
      .catch((e) => {
        if (!cancelled) setError(e.response?.data?.message || 'Could not load this connection request.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, requestId, navigate]);

  const decide = async (approve: boolean) => {
    try {
      setSubmitting(approve ? 'approve' : 'deny');
      setError('');
      const res = await oauthAPI.decide(requestId, approve);
      // Hand the browser back to Claude with the authorization code (or the refusal).
      window.location.assign(res.data.redirectUrl);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Something went wrong. Start the connection again from Claude.');
      setSubmitting(null);
    }
  };

  const switchAccount = async () => {
    setReturnTo(`/oauth/consent?request_id=${encodeURIComponent(requestId)}`);
    await logout();
    navigate('/login', { replace: true });
  };

  const appName = request?.clientName || 'Claude';
  const roleLabel = request?.user.role === UserRole.SYSTEM_ADMIN ? 'admin' : 'client';

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', bgcolor: 'var(--bg-shell)', py: 4 }}>
      <Container maxWidth="sm">
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 'var(--r-modal)', borderColor: 'var(--border)', bgcolor: 'var(--bg-raised)' }}>
          {loading || isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={24} sx={{ color: 'var(--text-muted)' }} />
            </Box>
          ) : !request ? (
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h5" fontWeight={600}>Connection request unavailable</Typography>
              <Alert severity="warning" sx={{ width: '100%' }}>{error || 'This request has expired.'}</Alert>
              <Button variant="outlined" onClick={() => navigate('/')}>Go to the app</Button>
            </Stack>
          ) : (
            <Stack spacing={3}>
              <Box>
                <Typography variant="overline" sx={{ color: 'var(--text-muted)', letterSpacing: 1 }}>
                  Connect an app
                </Typography>
                <Typography variant="h5" fontWeight={600} sx={{ mt: 0.5 }}>
                  Allow {appName} to access your Blueprint account?
                </Typography>
                <Typography variant="body2" sx={{ color: 'var(--text-muted)', mt: 1 }}>
                  Signed in as <strong>{request.user.firstName} {request.user.lastName}</strong> ({request.user.email}).{' '}
                  <Link component="button" type="button" onClick={switchAccount} underline="hover">
                    Not you?
                  </Link>
                </Typography>
              </Box>

              {!request.connectorAllowed ? (
                <>
                  <Alert severity="info" icon={<LinkOffIcon />}>
                    Your administrator has turned off the Claude connector for your account. Ask them to enable it, then
                    connect again from Claude.
                  </Alert>
                  <Button variant="contained" onClick={() => decide(false)} disabled={submitting !== null}>
                    Return to {appName}
                  </Button>
                </>
              ) : (
                <>
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>{appName} will be able to:</Typography>
                    <Stack spacing={1.25} sx={{ mt: 1 }}>
                      {[
                        'View your campaigns, posts, Planner and comments',
                        'Create and change campaigns, posts and comments for you',
                        `Act with your permissions as ${roleLabel === 'admin' ? 'an admin' : 'a client'} (no more than you can do in the app)`
                      ].map((item) => (
                        <Box key={item} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                          <CheckIcon fontSize="small" sx={{ color: 'var(--success)', mt: '2px' }} />
                          <Typography variant="body2">{item}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>

                  <Divider />

                  <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                    <LockIcon fontSize="small" sx={{ color: 'var(--text-muted)', mt: '2px' }} />
                    <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>
                      {appName} never sees your password. You can disconnect it at any time in Settings → Integrations.
                      You'll be returned to {request.redirectHost}.
                    </Typography>
                  </Box>

                  {error && <Alert severity="error">{error}</Alert>}

                  <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end">
                    <Button variant="outlined" onClick={() => decide(false)} disabled={submitting !== null}>
                      {submitting === 'deny' ? 'Cancelling…' : 'Cancel'}
                    </Button>
                    <Button variant="contained" onClick={() => decide(true)} disabled={submitting !== null}>
                      {submitting === 'approve' ? 'Connecting…' : `Allow ${appName}`}
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          )}
        </Paper>
      </Container>
    </Box>
  );
}
