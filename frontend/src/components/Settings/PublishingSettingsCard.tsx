import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Link,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { ExpandMore as ExpandIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import { publishingAPI } from '../../services/publishing';
import { canvaAPI } from '../../services/canva';

interface ProviderRow {
  id: string;
  name: string;
  platforms: string[];
  enabled: boolean;
  clientId: string;
  secretHint: string;
  hasSecret: boolean;
  options: Record<string, any>;
  optionFields: { key: string; label: string; type: 'boolean' | 'text'; help?: string }[];
  callbackUrl: string;
  developerPortal: string;
  approvalNote: string;
}

interface Draft {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  options: Record<string, any>;
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TextField size="small" label={label} value={value} fullWidth InputProps={{ readOnly: true }} />
      <Tooltip title="Copy">
        <IconButton onClick={() => navigator.clipboard?.writeText(value)}>
          <CopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/**
 * Settings → Integrations (System Admin): switch on each publishing platform by pasting the keys of the
 * developer app it approved, plus the Canva app keys. Nothing else needs to change in the code.
 */
export default function PublishingSettingsCard() {
  const [enabled, setEnabled] = useState(true);
  const [testMode, setTestMode] = useState(true);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [canva, setCanva] = useState<any>(null);
  const [canvaId, setCanvaId] = useState('');
  const [canvaSecret, setCanvaSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apply = (s: any) => {
    setEnabled(s.enabled);
    setTestMode(s.testMode);
    setProviders(s.providers);
    const d: Record<string, Draft> = {};
    for (const p of s.providers as ProviderRow[]) d[p.id] = { enabled: p.enabled, clientId: p.clientId, clientSecret: '', options: { ...p.options } };
    setDrafts(d);
  };

  useEffect(() => {
    Promise.all([publishingAPI.settings(), canvaAPI.settings()])
      .then(([s, c]) => {
        apply(s);
        setCanva(c);
        setCanvaId(c.clientId || '');
      })
      .catch((e) => setMessage({ type: 'error', text: e?.response?.data?.message || 'Could not load publishing settings' }))
      .finally(() => setLoading(false));
  }, []);

  const save = async (key: string, body: Record<string, unknown>) => {
    setSaving(key);
    setMessage(null);
    try {
      apply(await publishingAPI.saveSettings(body));
      setMessage({ type: 'success', text: 'Saved' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.response?.data?.message || 'Could not save' });
    } finally {
      setSaving(null);
    }
  };

  const saveProvider = (id: string) => {
    const d = drafts[id];
    save(id, { providers: { [id]: { enabled: d.enabled, clientId: d.clientId, ...(d.clientSecret ? { clientSecret: d.clientSecret } : {}), options: d.options } } });
  };

  const saveCanva = async () => {
    setSaving('canva');
    setMessage(null);
    try {
      const c = await canvaAPI.saveSettings({ clientId: canvaId, ...(canvaSecret ? { clientSecret: canvaSecret } : {}) });
      setCanva(c);
      setCanvaSecret('');
      setMessage({ type: 'success', text: 'Canva settings saved' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.response?.data?.message || 'Could not save Canva settings' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Publishing & Canva (admin)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Each platform is switched on by pasting the keys of the developer app you registered with it, once it’s approved. Until
          then, users can still schedule “post by hand” reminders, and test accounts let you try the whole flow.
        </Typography>

        {loading ? (
          <CircularProgress size={22} />
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2 }}>
              <FormControlLabel
                control={<Switch checked={enabled} disabled={saving === 'global'} onChange={(e) => save('global', { enabled: e.target.checked })} />}
                label={enabled ? 'Publishing is on' : 'Publishing is off for everyone'}
              />
              <FormControlLabel
                control={<Switch checked={testMode} disabled={saving === 'global'} onChange={(e) => save('global', { testMode: e.target.checked })} />}
                label="Test accounts (simulate posting)"
              />
            </Box>

            {providers.map((p) => {
              const d = drafts[p.id];
              if (!d) return null;
              return (
                <Accordion key={p.id} disableGutters variant="outlined" sx={{ mb: 1 }}>
                  <AccordionSummary expandIcon={<ExpandIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                      <Chip size="small" label={p.enabled ? 'On' : p.hasSecret ? 'Keys saved, off' : 'Not set up'} color={p.enabled ? 'success' : 'default'} />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Alert severity="info" sx={{ py: 0 }}>
                      {p.approvalNote}{' '}
                      <Link href={p.developerPortal} target="_blank" rel="noopener">
                        Open the developer portal
                      </Link>
                    </Alert>
                    <CopyField label="Redirect / callback URL to register with the platform" value={p.callbackUrl} />
                    <TextField size="small" label={p.id === 'tiktok' ? 'Client key' : p.id === 'meta' ? 'App ID' : 'Client ID'} value={d.clientId} onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, clientId: e.target.value } })} />
                    <TextField
                      size="small"
                      type="password"
                      label={p.id === 'meta' ? 'App secret' : 'Client secret'}
                      placeholder={p.hasSecret ? `Saved (${p.secretHint}). Type to replace.` : ''}
                      value={d.clientSecret}
                      onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, clientSecret: e.target.value } })}
                      InputLabelProps={{ shrink: true }}
                      autoComplete="new-password"
                    />
                    {p.optionFields.map((f) =>
                      f.type === 'boolean' ? (
                        <FormControlLabel
                          key={f.key}
                          control={<Switch checked={Boolean(d.options[f.key])} onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, options: { ...d.options, [f.key]: e.target.checked } } })} />}
                          label={f.label}
                        />
                      ) : (
                        <TextField
                          key={f.key}
                          size="small"
                          label={f.label}
                          helperText={f.help}
                          value={d.options[f.key] || ''}
                          onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, options: { ...d.options, [f.key]: e.target.value } } })}
                        />
                      )
                    )}
                    <FormControlLabel
                      control={<Switch checked={d.enabled} onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, enabled: e.target.checked } })} />}
                      label={`Let users connect ${p.platforms.join(' & ')} accounts`}
                    />
                    <Box>
                      <Button variant="contained" size="small" onClick={() => saveProvider(p.id)} disabled={saving === p.id}>
                        {saving === p.id ? 'Saving…' : `Save ${p.name}`}
                      </Button>
                    </Box>
                  </AccordionDetails>
                </Accordion>
              );
            })}

            {canva && (
              <Accordion disableGutters variant="outlined" sx={{ mb: 1 }}>
                <AccordionSummary expandIcon={<ExpandIcon />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>Canva (Edit in Canva)</Typography>
                    <Chip size="small" label={canva.ready ? (canva.source === 'env' ? 'On (server settings)' : 'On') : 'Not set up'} color={canva.ready ? 'success' : 'default'} />
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Alert severity="info" sx={{ py: 0 }}>
                    Create a Canva Connect integration, add the scopes asset:read/write, design:meta:read, design:content:read/write and profile:read, register the
                    URLs below, and turn on Return navigation. It works for your own Canva team while in draft; Canva reviews it before other users can connect.{' '}
                    <Link href={canva.developerPortal} target="_blank" rel="noopener">
                      Open Canva’s developer portal
                    </Link>
                  </Alert>
                  <CopyField label="Redirect URL" value={canva.callbackUrl} />
                  <CopyField label="Return navigation URL" value={canva.returnUrl} />
                  <TextField size="small" label="Client ID" value={canvaId} onChange={(e) => setCanvaId(e.target.value)} />
                  <TextField
                    size="small"
                    type="password"
                    label="Client secret"
                    placeholder={canva.secretHint ? `Saved (${canva.secretHint}). Type to replace.` : ''}
                    value={canvaSecret}
                    onChange={(e) => setCanvaSecret(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    autoComplete="new-password"
                  />
                  <Box>
                    <Button variant="contained" size="small" onClick={saveCanva} disabled={saving === 'canva'}>
                      {saving === 'canva' ? 'Saving…' : 'Save Canva'}
                    </Button>
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}

            {message && (
              <Alert severity={message.type} sx={{ mt: 1 }} onClose={() => setMessage(null)}>
                {message.text}
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
