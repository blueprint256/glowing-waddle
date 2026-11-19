import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Autocomplete, Box, Button, CircularProgress, IconButton, InputAdornment, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import api, { promptAPI, userAPI } from '../../services/api';
import BlueSettingsCard from '../../components/Settings/BlueSettingsCard';
import LibrarySettingsCard from '../../components/Settings/LibrarySettingsCard';
import { MetaChip } from '../../components/ui/StatusChip';
import { useConfirm } from '../../components/ui/useConfirm';
import { errorMessage, notify } from '../../store/toastStore';
import { LLM_MODELS, PROVIDERS, type ProviderId } from './settingsShared';

/**
 * Settings → AI (admins): the AI providers' keys, the model used by default, per-prompt models,
 * and the settings of Blue and the Library's AI reading.
 */

const PROVIDER_NAME: Record<string, string> = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name]));

export default function AISection() {
  const [configured, setConfigured] = useState<Record<ProviderId, boolean> | null>(null);
  const [defaultProvider, setDefaultProvider] = useState('openai');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [savingDefault, setSavingDefault] = useState(false);
  const [imageModels, setImageModels] = useState<{ id: string; label: string }[]>([]);
  const [imageModel, setImageModel] = useState('');
  const [editModel, setEditModel] = useState('');
  const [savingImage, setSavingImage] = useState(false);
  const [prompts, setPrompts] = useState<any[] | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get('/integrations/status');
      const i = r.data.integrations || {};
      setConfigured({ openai: Boolean(i.openai?.configured), anthropic: Boolean(i.anthropic?.configured), grok: Boolean(i.grok?.configured), gemini: Boolean(i.gemini?.configured) });
    } catch {
      setConfigured({ openai: false, anthropic: false, grok: false, gemini: false });
    }
  }, []);

  const loadPrompts = useCallback(async () => {
    try {
      const r = await promptAPI.getAll();
      setPrompts(r.data.prompts || []);
    } catch {
      setPrompts([]);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadPrompts();
    api
      .get('/integrations/llm/default')
      .then((r) => {
        setDefaultProvider(r.data.defaultProvider || 'openai');
        setDefaultModel(r.data.defaultModel || 'gpt-4o-mini');
      })
      .catch(() => undefined);
    api
      .get('/integrations/image-llm/default')
      .then((r) => {
        setImageModels(Array.isArray(r.data.models) ? r.data.models : []);
        setImageModel(r.data.defaultModel || '');
        setEditModel(r.data.editModel || '');
      })
      .catch(() => undefined);
  }, [loadStatus, loadPrompts]);

  const saveImageModel = async (model: string) => {
    setSavingImage(true);
    try {
      const r = await api.patch('/integrations/image-llm/default', { provider: 'openai', model });
      setImageModel(r.data.defaultModel || model);
      setEditModel(r.data.editModel || '');
      notify('Image model saved');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save the image model.'), { tone: 'error' });
    } finally {
      setSavingImage(false);
    }
  };

  const saveDefault = async () => {
    if (!defaultModel.trim()) return notify('Choose or type a model.', { tone: 'error' });
    setSavingDefault(true);
    try {
      await api.patch('/integrations/llm/default', { provider: defaultProvider, model: defaultModel.trim() });
      notify('Default model saved');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save the default model.'), { tone: 'error' });
    } finally {
      setSavingDefault(false);
    }
  };

  const updatePrompt = async (prompt: any, body: Record<string, unknown>, message: string) => {
    try {
      await promptAPI.update(prompt._id, body);
      notify(message);
      loadPrompts();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t update the prompt.'), { tone: 'error' });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Section title="AI providers" hint="Keys are encrypted. OpenAI is needed for AI images.">
        {configured === null ? (
          <CircularProgress size={18} sx={{ color: 'var(--text-muted)' }} />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
            {PROVIDERS.map((p) => (
              <ProviderKeyCard key={p.id} provider={p} configured={configured[p.id]} onChanged={loadStatus} confirm={confirm} />
            ))}
          </Box>
        )}
      </Section>

      <Section title="Default model" hint="Used by every AI feature unless a prompt below says otherwise.">
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField
            select
            label="Provider"
            value={defaultProvider}
            onChange={(e) => {
              setDefaultProvider(e.target.value);
              setDefaultModel(LLM_MODELS[e.target.value]?.[0] || '');
            }}
            sx={{ minWidth: 200 }}
          >
            {PROVIDERS.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
                {configured && !configured[p.id] ? ' (no key)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <Autocomplete
            freeSolo
            options={LLM_MODELS[defaultProvider] || []}
            value={defaultModel}
            onInputChange={(_, v) => setDefaultModel(v)}
            sx={{ minWidth: 280 }}
            renderInput={(params) => <TextField {...params} label="Model" helperText="Pick one or type any model name." />}
          />
          <Button variant="contained" onClick={saveDefault} disabled={savingDefault} sx={{ mt: 1 }}>
            {savingDefault ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      </Section>

      <Section title="Image model" hint="OpenAI makes every AI picture. GPT-Image-2.5 Flare is the fast default; changes to existing pictures use Sunburst, which edits more precisely.">
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            label="Makes pictures with"
            value={imageModels.some((m) => m.id === imageModel) ? imageModel : ''}
            onChange={(e) => saveImageModel(e.target.value)}
            disabled={savingImage || imageModels.length === 0}
            sx={{ minWidth: 320 }}
          >
            {imageModels.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.label}
              </MenuItem>
            ))}
          </TextField>
          {editModel && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>Changes pictures with {editModel}.</Typography>}
        </Box>
      </Section>

      <Section title="Model per prompt" hint="Only change these when a prompt needs a different model than the default.">
        {prompts === null ? (
          <CircularProgress size={18} sx={{ color: 'var(--text-muted)' }} />
        ) : prompts.length === 0 ? (
          <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>No prompts yet. Add them in Settings › Prompts.</Typography>
        ) : (
          <TableContainer sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Prompt</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {prompts.map((prompt) => {
                  const provider = prompt.llmProvider || defaultProvider;
                  const model = prompt.llmModel || defaultModel;
                  const overridden = Boolean(prompt.llmProvider || prompt.imageLLMProvider);
                  return (
                    <TableRow key={prompt._id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography sx={{ fontSize: 14 }}>{prompt.name}</Typography>
                          {!overridden && <MetaChip size="xs" meta={{ label: 'Default', hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' }} />}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={provider}
                          onChange={(e) => updatePrompt(prompt, { llmProvider: e.target.value, llmModel: LLM_MODELS[e.target.value]?.[0] }, `“${prompt.name}” now uses ${PROVIDER_NAME[e.target.value]}`)}
                          sx={{ minWidth: 150 }}
                        >
                          {PROVIDERS.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                              {p.name}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={(LLM_MODELS[provider] || []).includes(model) ? model : ''}
                          onChange={(e) => updatePrompt(prompt, { llmProvider: provider, llmModel: e.target.value }, `“${prompt.name}” now uses ${e.target.value}`)}
                          sx={{ minWidth: 200 }}
                          SelectProps={{ displayEmpty: true }}
                        >
                          {!(LLM_MODELS[provider] || []).includes(model) && (
                            <MenuItem value="" disabled>
                              {model}
                            </MenuItem>
                          )}
                          {(LLM_MODELS[provider] || []).map((m) => (
                            <MenuItem key={m} value={m}>
                              {m}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell align="right">
                        {overridden && (
                          <Button size="small" onClick={() => updatePrompt(prompt, { llmProvider: null, llmModel: null, imageLLMProvider: null, imageLLMModel: null }, `“${prompt.name}” uses the default again`)}>
                            Use default
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      <AllowanceDefaults />

      <BlueSettingsCard />
      <LibrarySettingsCard />
      {confirmDialog}
    </Box>
  );
}

function ProviderKeyCard({
  provider,
  configured,
  onChanged,
  confirm
}: {
  provider: (typeof PROVIDERS)[number];
  configured: boolean;
  onChanged: () => void;
  confirm: ReturnType<typeof useConfirm>[0];
}) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);

  const save = async () => {
    if (!key.trim()) return;
    setBusy('save');
    try {
      await api.patch(`/integrations/${provider.id}/key`, { apiKey: key.trim() });
      setKey('');
      setShow(false);
      notify(`${provider.name} key saved`);
      onChanged();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save the key.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.post(`/integrations/${provider.id}/test`);
      notify(r.data.modelCount ? `${provider.name} works (${r.data.modelCount} models available)` : `${provider.name} works`);
    } catch (e) {
      notify(errorMessage(e, 'The test failed. Check the key.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: `Remove the ${provider.name} key?`, body: 'AI features that use this provider stop working until a new key is added.', action: 'Remove', danger: true });
    if (!ok) return;
    setBusy('remove');
    try {
      await api.delete(`/integrations/${provider.id}/key`);
      notify(`${provider.name} key removed`);
      onChanged();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t remove the key.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-panel)' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: 'var(--text-strong)' }}>{provider.name}</Typography>
        <MetaChip
          size="xs"
          meta={
            configured
              ? { label: 'Key saved', hint: '', bg: 'var(--st-published-bg)', fg: 'var(--st-published-fg)', dot: 'var(--st-published-dot)' }
              : { label: 'No key', hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' }
          }
        />
      </Box>
      <TextField
        size="small"
        type={show ? 'text' : 'password'}
        label={configured ? 'Replace the key' : 'API key'}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={configured ? '••••••••••••' : provider.placeholder}
        helperText={provider.keyHint}
        autoComplete="off"
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" edge="end" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide the key' : 'Show the key'}>
                {show ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          )
        }}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button type="submit" size="small" variant="contained" disabled={!key.trim() || busy !== null}>
          {busy === 'save' ? 'Saving…' : 'Save key'}
        </Button>
        {configured && (
          <>
            <Button size="small" variant="outlined" onClick={test} disabled={busy !== null}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </Button>
            <Button size="small" color="error" onClick={remove} disabled={busy !== null}>
              Remove
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography component="h3" sx={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
        {title}
      </Typography>
      {hint && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', mb: 1.5 }}>{hint}</Typography>}
      {children}
    </Box>
  );
}

/** The monthly AI allowance every client account gets (each account can have its own in Admin › Users). */
function AllowanceDefaults() {
  const [saved, setSaved] = useState<{ aiImagesPerMonth: number; aiDesignsPerMonth?: number; blueMessagesPerMonth: number } | null>(null);
  const [images, setImages] = useState('');
  const [designs, setDesigns] = useState('');
  const [blue, setBlue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    userAPI
      .allowanceDefaults()
      .then((d) => {
        setSaved(d);
        setImages(String(d.aiImagesPerMonth));
        setDesigns(String(d.aiDesignsPerMonth ?? 12));
        setBlue(String(d.blueMessagesPerMonth));
      })
      .catch(() => setSaved(null));
  }, []);

  const valid = (v: string) => /^\d{1,6}$/.test(v.trim());
  const dirty = saved && (images !== String(saved.aiImagesPerMonth) || designs !== String(saved.aiDesignsPerMonth ?? 12) || blue !== String(saved.blueMessagesPerMonth));

  const save = async () => {
    if (!valid(images) || !valid(designs) || !valid(blue) || saving) return;
    setSaving(true);
    try {
      const d = await userAPI.saveAllowanceDefaults({ aiImagesPerMonth: Number(images), aiDesignsPerMonth: Number(designs), blueMessagesPerMonth: Number(blue) });
      setSaved(d);
      notify('Allowance saved');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save the allowance.'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Monthly AI allowance" hint="What each client account can use per month. 0 means no limit. Admins have no limit; any account can have its own in Admin › Users.">
      {saved === null ? (
        <CircularProgress size={18} sx={{ color: 'var(--text-muted)' }} />
      ) : (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}
        >
          <TextField label="AI images" value={images} onChange={(e) => setImages(e.target.value)} error={!valid(images)} inputProps={{ inputMode: 'numeric' }} sx={{ width: 160 }} />
          <TextField label="Designed posters" value={designs} onChange={(e) => setDesigns(e.target.value)} error={!valid(designs)} inputProps={{ inputMode: 'numeric' }} sx={{ width: 160 }} helperText="A set of options counts once" />
          <TextField label="Blue messages" value={blue} onChange={(e) => setBlue(e.target.value)} error={!valid(blue)} inputProps={{ inputMode: 'numeric' }} sx={{ width: 160 }} />
          <Button type="submit" variant="contained" disabled={!dirty || !valid(images) || !valid(designs) || !valid(blue) || saving} sx={{ mt: 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      )}
    </Section>
  );
}
