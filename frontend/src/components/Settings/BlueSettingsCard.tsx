import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import { blueAPI, type BlueSettings } from '../../services/blue';

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  grok: 'Grok (xAI)'
};

/** Model IDs offered as suggestions; any model ID that supports tool use can be typed in. */
const MODEL_SUGGESTIONS: Record<string, string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  grok: []
};

/**
 * Settings → LLM Settings (System Admin): which AI powers Blue, on/off for everyone, daily limit.
 * Per-user access is switched in Admin → Users.
 */
export default function BlueSettingsCard() {
  const [settings, setSettings] = useState<BlueSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState('');
  const [limit, setLimit] = useState('100');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apply = (s: BlueSettings) => {
    setSettings(s);
    setEnabled(s.enabled);
    setProvider(s.provider || '');
    setModel(s.model || '');
    setLimit(String(s.dailyMessageLimit));
  };

  useEffect(() => {
    blueAPI
      .getSettings()
      .then((res) => apply(res.data.settings))
      .catch((e) => setMessage({ type: 'error', text: e.response?.data?.message || 'Could not load Blue settings' }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 0) {
      setMessage({ type: 'error', text: 'Daily limit must be a whole number (0 means unlimited).' });
      return;
    }
    try {
      setSaving(true);
      setMessage(null);
      const res = await blueAPI.saveSettings({
        enabled,
        provider: (provider || null) as BlueSettings['provider'],
        model: model.trim(),
        dailyMessageLimit: parsedLimit
      });
      apply(res.data.settings);
      setMessage({ type: 'success', text: 'Blue settings saved' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.response?.data?.message || 'Could not save Blue settings' });
    } finally {
      setSaving(false);
    }
  };

  const effectiveProvider = provider || settings?.effectiveProvider || '';
  const suggestions = MODEL_SUGGESTIONS[effectiveProvider] || [];
  const defaultModel = effectiveProvider ? settings?.defaultModels?.[effectiveProvider] : undefined;

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Blue assistant
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Blue is the chat assistant built into the app. It runs on your organisation’s AI keys and acts with each user’s
          own permissions. Choose a model that supports tool use. To turn Blue off for one person, go to Admin → Users.
        </Typography>

        {loading ? (
          <CircularProgress size={22} />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 560 }}>
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={enabled ? 'Blue is on for everyone allowed to use it' : 'Blue is off for everyone'}
            />

            <TextField
              select
              label="AI provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel('');
              }}
              helperText={
                settings?.configuredProviders.length
                  ? 'Only providers with an API key (Settings → Integrations) can be used.'
                  : 'Add an Anthropic, OpenAI or Grok API key in Settings → Integrations first.'
              }
            >
              <MenuItem value="">
                Automatic{settings?.configuredProviders[0] ? ` (${PROVIDER_LABELS[settings.configuredProviders[0]]})` : ''}
              </MenuItem>
              {(['anthropic', 'openai', 'grok'] as const).map((p) => (
                <MenuItem key={p} value={p} disabled={!settings?.configuredProviders.includes(p)}>
                  {PROVIDER_LABELS[p]}
                  {!settings?.configuredProviders.includes(p) ? ' (no key)' : ''}
                </MenuItem>
              ))}
            </TextField>

            <Autocomplete
              freeSolo
              options={suggestions}
              value={model}
              onInputChange={(_e, value) => setModel(value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Model"
                  placeholder={defaultModel || 'Type a model ID'}
                  helperText={defaultModel ? `Leave empty to use ${defaultModel}.` : 'Type the provider’s model ID.'}
                />
              )}
            />

            <TextField
              label="Messages per user per day"
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputProps={{ min: 0, step: 1 }}
              helperText="Keeps AI costs predictable. 0 means unlimited."
              sx={{ maxWidth: 260 }}
            />

            {settings?.problem ? (
              <Alert severity="warning">{settings.problem}</Alert>
            ) : settings?.effectiveProvider ? (
              <Alert severity="info">
                Blue is using {PROVIDER_LABELS[settings.effectiveProvider] || settings.effectiveProvider} · {settings.effectiveModel}
              </Alert>
            ) : null}

            {message && <Alert severity={message.type}>{message.text}</Alert>}

            <Box>
              <Button variant="contained" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save Blue settings'}
              </Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
