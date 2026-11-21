import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { Link as LinkIcon } from '@mui/icons-material';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import ClaudeConnectorCard from '../../components/Settings/ClaudeConnectorCard';
import PublishingSettingsCard from '../../components/Settings/PublishingSettingsCard';
import { MetaChip } from '../../components/ui/StatusChip';
import { useConfirm } from '../../components/ui/useConfirm';
import { formatDateTime } from '../../lib/dates';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * Settings → Integrations: Claude (the connector), Canva, and for admins the platform and Canva app
 * keys. Canva's sign-in comes back here with ?integration=canva&status=…
 */

const CANVA_ERRORS: Record<string, string> = {
  not_configured: 'Canva isn’t set up for this app yet. An admin adds the Canva app keys below.',
  expired: 'The Canva sign-in took too long. Try again.',
  access_denied: 'You didn’t allow access in Canva.',
  server_error: 'Something went wrong while connecting Canva. Try again.'
};

export default function IntegrationsSection() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const [params, setParams] = useSearchParams();
  const [canva, setCanva] = useState<{ connected: boolean; connectedAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await api.get('/integrations/status');
      const c = r.data.integrations?.canva || {};
      setCanva({ connected: Boolean(c.connected), connectedAt: c.connectedAt || null });
    } catch {
      setCanva({ connected: false, connectedAt: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Back from Canva's sign-in.
  useEffect(() => {
    if (params.get('integration') !== 'canva') return;
    const status = params.get('status');
    if (status === 'success') notify('Canva connected');
    else notify(CANVA_ERRORS[params.get('message') || ''] || 'Couldn’t connect Canva. Try again.', { tone: 'error' });
    const next = new URLSearchParams(params);
    ['integration', 'status', 'message'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
    load();
  }, [params, setParams, load]);

  const connectCanva = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${apiUrl}/integrations/canva`;
  };

  const disconnectCanva = async () => {
    const ok = await confirm({
      title: 'Disconnect Canva?',
      body: '“Edit in Canva” stops working until you connect again. Designs already brought back stay in the app.',
      action: 'Disconnect',
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post('/integrations/canva/disconnect');
      setCanva({ connected: false, connectedAt: null });
      notify('Canva disconnected');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t disconnect Canva.'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ClaudeConnectorCard />

      <Box component="section" aria-label="Canva" sx={{ p: 2, border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-panel)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Typography component="h3" sx={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)', flex: 1 }}>
            Canva
          </Typography>
          {canva && (
            <MetaChip
              size="xs"
              meta={
                canva.connected
                  ? { label: 'Connected', hint: '', bg: 'var(--st-published-bg)', fg: 'var(--st-published-fg)', dot: 'var(--st-published-dot)' }
                  : { label: 'Not connected', hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' }
              }
            />
          )}
        </Box>
        <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)', mb: 1.5 }}>
          Connect your Canva account to use “Edit in Canva” on post images and Library pictures. The edited design comes back as a new version.
          {canva?.connected && canva.connectedAt ? ` Connected ${formatDateTime(canva.connectedAt)}.` : ''}
        </Typography>
        {canva === null ? (
          <CircularProgress size={18} sx={{ color: 'var(--text-muted)' }} />
        ) : canva.connected ? (
          <Button color="error" onClick={disconnectCanva} disabled={busy}>
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        ) : (
          <Button variant="contained" startIcon={<LinkIcon />} onClick={connectCanva}>
            Connect Canva
          </Button>
        )}
      </Box>

      {isAdmin && <PublishingSettingsCard />}
      {confirmDialog}
    </Box>
  );
}
