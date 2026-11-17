import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Box, Button, CircularProgress, MenuItem, TextField, Typography } from '@mui/material';
import { Upload as UploadIcon } from '@mui/icons-material';
import api from '../../services/api';
import { errorMessage, notify } from '../../store/toastStore';
import { BRAND_TONES, SECTORS } from './settingsShared';

/**
 * Settings → Brand: what AI needs to write like you (name, what you do, tone, audience, rules) and
 * your logos. Used in every caption, brief, plan and image.
 */

interface Brand {
  companyName: string;
  sector: string;
  about: string;
  productsServices: string;
  usp: string;
  brandTone: string;
  audienceProfile: string;
  globalRules: string;
  brandGuidelines: string;
  primaryLogoUrl: string;
  secondaryLogoUrl: string;
  tertiaryLogoUrl: string;
}

const EMPTY: Brand = {
  companyName: '',
  sector: '',
  about: '',
  productsServices: '',
  usp: '',
  brandTone: '',
  audienceProfile: '',
  globalRules: '',
  brandGuidelines: '',
  primaryLogoUrl: '',
  secondaryLogoUrl: '',
  tertiaryLogoUrl: ''
};

type LogoKind = 'primary' | 'secondary' | 'tertiary';
const LOGOS: { kind: LogoKind; label: string; hint: string }[] = [
  { kind: 'primary', label: 'Main logo', hint: 'Used by AI images as {primaryLogo} and shown on post previews.' },
  { kind: 'secondary', label: 'Second logo', hint: 'An alternate or one-colour version ({secondaryLogo}).' },
  { kind: 'tertiary', label: 'Icon', hint: 'A small mark or app icon ({tertiaryLogo}).' }
];

const TEXT_FIELDS: (keyof Brand)[] = ['companyName', 'sector', 'about', 'productsServices', 'usp', 'brandTone', 'audienceProfile', 'globalRules', 'brandGuidelines'];

export default function BrandSection() {
  const [saved, setSaved] = useState<Brand | null>(null);
  const [form, setForm] = useState<Brand>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<LogoKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/users/me/company-info')
      .then((r) => {
        const b = { ...EMPTY, ...Object.fromEntries(Object.entries(r.data.companyInfo || {}).map(([k, v]) => [k, v ?? ''])) } as Brand;
        setSaved(b);
        setForm(b);
      })
      .catch((e) => setError(errorMessage(e, 'Your brand details couldn’t load.')));
  }, []);

  const dirty = useMemo(() => Boolean(saved) && TEXT_FIELDS.some((k) => form[k] !== saved![k]), [form, saved]);

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (key: keyof Brand) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const body = Object.fromEntries(TEXT_FIELDS.map((k) => [k, form[k].trim()]));
      await api.patch('/users/me/company-info', body);
      const next = { ...form, ...body } as Brand;
      setSaved(next);
      setForm(next);
      notify('Brand saved');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save your brand.'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (kind: LogoKind, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return notify('Choose a picture (PNG, JPG, SVG or WebP).', { tone: 'error' });
    if (file.size > 5 * 1024 * 1024) return notify('That logo is over 5 MB. Choose a smaller file.', { tone: 'error' });
    setUploading(kind);
    try {
      const data = new FormData();
      data.append('logo', file);
      data.append('logoType', kind);
      const r = await api.post('/users/me/upload-logo', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      const key = `${kind}LogoUrl` as keyof Brand;
      setForm((f) => ({ ...f, [key]: r.data.logoUrl }));
      setSaved((s) => (s ? { ...s, [key]: r.data.logoUrl } : s));
      notify('Logo uploaded');
    } catch (err) {
      notify(errorMessage(err, 'Couldn’t upload the logo.'), { tone: 'error' });
    } finally {
      setUploading(null);
    }
  };

  const removeLogo = async (kind: LogoKind) => {
    const key = `${kind}LogoUrl` as keyof Brand;
    const before = form[key];
    try {
      await api.patch('/users/me/company-info', { [key]: '' });
      setForm((f) => ({ ...f, [key]: '' }));
      setSaved((s) => (s ? { ...s, [key]: '' } : s));
      notify('Logo removed', {
        undo: async () => {
          try {
            await api.patch('/users/me/company-info', { [key]: before });
            setForm((f) => ({ ...f, [key]: before }));
            setSaved((s) => (s ? { ...s, [key]: before } : s));
          } catch (e) {
            notify(errorMessage(e, 'Couldn’t put it back.'), { tone: 'error' });
          }
        }
      });
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t remove the logo.'), { tone: 'error' });
    }
  };

  if (error) return <Typography sx={{ color: 'var(--st-attention-fg)' }}>{error}</Typography>;
  if (!saved) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  const sectorOptions = form.sector && !SECTORS.includes(form.sector) ? [form.sector, ...SECTORS] : SECTORS;
  const toneOptions = form.brandTone && !BRAND_TONES.includes(form.brandTone) ? [form.brandTone, ...BRAND_TONES] : BRAND_TONES;

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 3, pb: dirty ? 8 : 0 }}
    >
      <Group title="About you" hint="The basics every caption and plan starts from.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
          <TextField label="Brand name" value={form.companyName} onChange={set('companyName')} fullWidth />
          <TextField select label="Industry" value={form.sector} onChange={set('sector')} fullWidth>
            <MenuItem value="">
              <em>Not set</em>
            </MenuItem>
            {sectorOptions.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <TextField label="What you do" value={form.about} onChange={set('about')} multiline minRows={3} fullWidth placeholder="A few sentences about the business, as you’d tell a new customer." />
        <TextField label="Products and services" value={form.productsServices} onChange={set('productsServices')} multiline minRows={2} fullWidth />
        <TextField label="What makes you different" value={form.usp} onChange={set('usp')} multiline minRows={2} fullWidth />
      </Group>

      <Group title="How you sound" hint="So AI writes the way you would.">
        <TextField select label="Tone of voice" value={form.brandTone} onChange={set('brandTone')} fullWidth sx={{ maxWidth: 320 }}>
          <MenuItem value="">
            <em>Not set</em>
          </MenuItem>
          {toneOptions.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Who you’re talking to" value={form.audienceProfile} onChange={set('audienceProfile')} multiline minRows={2} fullWidth placeholder="Age, interests, where they are, what they care about." />
        <TextField label="Always and never" value={form.globalRules} onChange={set('globalRules')} multiline minRows={3} fullWidth placeholder="e.g. Always say “Kampala”, never “KLA”. No slang. Emojis only at the end." />
        <TextField
          label="Brand guidelines"
          value={form.brandGuidelines}
          onChange={set('brandGuidelines')}
          multiline
          minRows={4}
          fullWidth
          placeholder="Colours, fonts, photo style, words to use and avoid…"
          helperText="AI images and captions follow these."
        />
      </Group>

      <Group title="Logos" hint="Logos are saved straight away.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
          {LOGOS.map((l) => {
            const url = form[`${l.kind}LogoUrl` as keyof Brand];
            return (
              <Box key={l.kind} sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{l.label}</Typography>
                <Box sx={{ height: 90, display: 'grid', placeItems: 'center', bgcolor: 'var(--bg-subtle)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
                  {url ? (
                    <Box component="img" src={url} alt={l.label} sx={{ maxWidth: '90%', maxHeight: 80, objectFit: 'contain' }} />
                  ) : (
                    <Typography sx={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No logo</Typography>
                  )}
                </Box>
                <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.hint}</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" variant="outlined" component="label" startIcon={uploading === l.kind ? <CircularProgress size={14} /> : <UploadIcon />} disabled={uploading !== null}>
                    {url ? 'Replace' : 'Upload'}
                    <input type="file" hidden accept="image/*" onChange={(e) => uploadLogo(l.kind, e)} />
                  </Button>
                  {url && (
                    <Button size="small" color="error" onClick={() => removeLogo(l.kind)} disabled={uploading !== null}>
                      Remove
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Group>

      {dirty && (
        <Box
          sx={{
            position: 'sticky', bottom: 12, zIndex: 2, display: 'flex', alignItems: 'center', gap: 1, p: 1.25, pl: 2,
            borderRadius: 'var(--r-panel)', border: '1px solid var(--border-strong)', bgcolor: 'var(--bg-panel)', boxShadow: '0 6px 24px rgba(0,0,0,.18)'
          }}
        >
          <Typography sx={{ flex: 1, fontSize: 14 }}>You have unsaved changes.</Typography>
          <Button onClick={() => setForm(saved)} disabled={saving}>
            Discard
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      )}
    </Box>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="fieldset" sx={{ border: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box component="legend" sx={{ p: 0, mb: 0.5 }}>
        <Typography component="h3" sx={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
          {title}
        </Typography>
        {hint && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>{hint}</Typography>}
      </Box>
      {children}
    </Box>
  );
}
