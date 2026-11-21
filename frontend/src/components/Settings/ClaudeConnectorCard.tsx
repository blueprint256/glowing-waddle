import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { ContentCopy as CopyIcon, Check as CheckIcon } from '@mui/icons-material';
import { connectedAppsAPI } from '../../services/api';

interface Connection {
  clientId: string;
  clientName: string;
  connectedAt: string;
  lastUsedAt?: string;
}

interface ConnectorState {
  connectorEnabled: boolean;
  mcpUrl: string | null;
  connections: Connection[];
}

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/**
 * Settings → Integrations: connect Claude through the MCP connector and manage connected apps.
 */
export default function ClaudeConnectorCard() {
  const [state, setState] = useState<ConnectorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await connectedAppsAPI.list();
      setState({
        connectorEnabled: res.data.connectorEnabled,
        mcpUrl: res.data.mcpUrl,
        connections: res.data.connections || []
      });
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not load the Claude connector status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copyUrl = async () => {
    if (!state?.mcpUrl) return;
    try {
      await navigator.clipboard.writeText(state.mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the field is selectable */
    }
  };

  const disconnect = async (clientId: string) => {
    try {
      setDisconnecting(clientId);
      await connectedAppsAPI.disconnect(clientId);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not disconnect');
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1 }}>
          <Typography variant="h6">Claude connector</Typography>
          {state && (
            <Chip
              size="small"
              label={state.connections.length ? 'Connected' : state.connectorEnabled ? 'Not connected' : 'Turned off'}
              color={state.connections.length ? 'success' : 'default'}
            />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Work on your campaigns, projects and tasks from a Claude chat. Claude acts as you, with exactly the same
          permissions you have here.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
          </Box>
        ) : error ? (
          <Alert severity="error" action={<Button size="small" onClick={load}>Retry</Button>}>{error}</Alert>
        ) : state && !state.connectorEnabled ? (
          <Alert severity="info">Your administrator has turned off the Claude connector for your account.</Alert>
        ) : state ? (
          <Stack spacing={2}>
            {state.mcpUrl ? (
              <>
                <TextField
                  label="Connector URL"
                  value={state.mcpUrl}
                  fullWidth
                  size="small"
                  InputProps={{
                    readOnly: true,
                    endAdornment: (
                      <Tooltip title={copied ? 'Copied' : 'Copy'}>
                        <IconButton onClick={copyUrl} edge="end" size="small" aria-label="Copy connector URL">
                          {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  In Claude, add a custom connector and paste this URL. Claude will open a page here asking you to
                  allow the connection.
                </Typography>
              </>
            ) : (
              <Alert severity="warning">
                The connector address isn't configured on the server yet (MCP_PUBLIC_URL). Ask your administrator.
              </Alert>
            )}

            {state.connections.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Connected apps</Typography>
                <Stack spacing={1}>
                  {state.connections.map((c) => (
                    <Box
                      key={c.clientId}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 2,
                        p: 1.5,
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-card)'
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{c.clientName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Connected {formatDate(c.connectedAt)} · Last used {formatDate(c.lastUsedAt)}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        onClick={() => disconnect(c.clientId)}
                        disabled={disconnecting === c.clientId}
                      >
                        {disconnecting === c.clientId ? 'Disconnecting…' : 'Disconnect'}
                      </Button>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  );
}
