import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Card, CardContent, CircularProgress, FormControlLabel, MenuItem, Switch, TextField, Typography } from '@mui/material';
import { libraryAPI } from '../../services/library';

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  grok: 'Grok (xAI)'
};

/** Suggestions only: any model that can read images works. Small, fast models keep costs low. */
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  grok: []
};

interface LibrarySettings {
  enabled: boolean;
  provider: string | null;
  model: string;
  monthlyAiLimit: number;
  semanticSearch: boolean;
  semanticAvailable: boolean;
  effectiveProvider: string | null;
  effectiveModel: string | null;
  problem: string | null;
  configuredProviders: string[];
}

/**
 * Settings › AI (System Admin): the Library (Aggregator) on/off for everyone, which AI reads
 * uploads, the monthly per-user AI allowance and search by meaning. Per-user access is in Admin → Users.
 */
export default function LibrarySettingsCard() {
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [limit, setLimit] = useState('500');
  const [semantic, setSemantic] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apply = (s: LibrarySettings) => {
    setSettings(s);
    setEnabled(s.enabled);
    setProvider(s.provider || '');
    setModel(s.model || '');
    setLimit(String(s.monthlyAiLimit));
    setSemantic(s.semanticSearch);
  };

  useEffect(() => {
    libraryAPI
      .settings()
      .then(apply)
      .catch((e) => setMessage({ type: 'error', text: e.response?.data?.message || 'Could not load Library settings' }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setMessage({ type: 'error', text: 'The monthly allowance must be a whole number (0 means unlimited).' });
      return;
    }
    try {
      setSaving(true);
      setMessage(null);
      apply(await libraryAPI.saveSettings({ enabled, provider: provider || null, model: model.trim(), monthlyAiLimit: parsed, semanticSearch: semantic }));
      setMessage({ type: 'success', text: 'Library settings saved' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.response?.data?.message || 'Could not save Library settings' });
    } finally {
      setSaving(false);
    }
  };

  const effectiveProvider = provider || settings?.effectiveProvider || '';

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Library (Aggregator)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The Library holds each user’s past and present work with full version history. An AI reads every upload once (describes
          it, reads text in images, dates it, tags it) so users, Blue and Claude can find it later. Only the owner (and System
          Admins, for support) can see a Library. To turn it off for one person, go to Admin → Users.
        </Typography>

        {loading ? (
          <CircularProgress size={22} />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}>
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={enabled ? 'The Library is on for everyone allowed to use it' : 'The Library is off for everyone'}
            />

            <TextField
              select
              label="AI that reads uploads"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel('');
              }}
              helperText="Uses the same API keys as the rest of the app. Leave on Automatic to follow Blue’s provider."
            >
              <MenuItem value="">Automatic</MenuItem>
              {(['anthropic', 'openai', 'grok'] as const).map((p) => (
                <MenuItem key={p} value={p} disabled={!settings?.configuredProviders.includes(p)}>
                  {PROVIDER_LABELS[p]}
                  {!settings?.configuredProviders.includes(p) ? ' (no key)' : ''}
                </MenuItem>
              ))}
            </TextField>

            <Autocomplete
              freeSolo
              options={MODEL_SUGGESTIONS[effectiveProvider] || []}
              value={model}
              onInputChange={(_e, value) => setModel(value)}
              renderInput={(params) => (
                <TextField {...params} label="Model" placeholder={settings?.effectiveModel || 'Type a model ID'} helperText="Must be able to read images. A small, fast model is plenty and keeps costs low." />
              )}
            />

            <TextField
              label="AI-read items per user per month"
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputProps={{ min: 0, step: 1 }}
              helperText="Uploads beyond this are still stored and searchable by name, folder and text; the AI reads them next month or when re-run. 0 = unlimited."
              sx={{ maxWidth: 360 }}
            />

            <FormControlLabel
              control={<Switch checked={semantic} onChange={(e) => setSemantic(e.target.checked)} disabled={!settings?.semanticAvailable} />}
              label={
                settings?.semanticAvailable
                  ? 'Search by meaning (uses OpenAI embeddings, very low cost)'
                  : 'Search by meaning needs an OpenAI API key (above)'
              }
            />

            {settings?.problem ? (
              <Alert severity="warning">{settings.problem}</Alert>
            ) : settings?.effectiveProvider ? (
              <Alert severity="info">
                Uploads are read by {PROVIDER_LABELS[settings.effectiveProvider] || settings.effectiveProvider} · {settings.effectiveModel}
              </Alert>
            ) : null}

            {message && <Alert severity={message.type}>{message.text}</Alert>}

            <Box>
              <Button variant="contained" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save Library settings'}
              </Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
