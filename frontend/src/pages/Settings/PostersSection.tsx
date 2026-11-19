import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Box, Button, CircularProgress, IconButton, MenuItem, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { Add as AddIcon, Close as RemoveIcon, LockOutlined as LockIcon, Upload as UploadIcon, WarningAmberRounded as WarnIcon } from '@mui/icons-material';
import {
  designAPI,
  kitFontFamily,
  loadCatalogFonts,
  type BrandKit,
  type ColorRole,
  type DesignCatalog,
  type KitColors,
  type KitFonts,
  type KitLogo,
  type KitRule,
  type LogoVariant,
  type LogoVariantKind
} from '../../services/design';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * Settings → Posters: what designed posters are made from. Logos (the club's, campaign logos like
 * End Polio Now), partner logos to pick per poster, colours, fonts, the contact line and the rules.
 * A brand pack (Rotary, Rotaract) brings its official colours, fonts and rules, which posters
 * then follow exactly. Logos and partners save as soon as they're added; the rest has a Save bar.
 */

const ROLES: { role: ColorRole; label: string; hint: string }[] = [
  { role: 'primary', label: 'Main colour', hint: 'Panels and fades' },
  { role: 'secondary', label: 'Second colour', hint: 'Grounds and depth' },
  { role: 'accent', label: 'Accent', hint: 'Dates, buttons, highlights' },
  { role: 'ink', label: 'Text', hint: 'Dark words' },
  { role: 'paper', label: 'Paper', hint: 'Light grounds, partner band' }
];

const VERSION_LABEL: Record<LogoVariantKind, string> = {
  color: 'Colour',
  reverse: 'White (for dark grounds)',
  'mono-light': 'One colour, white',
  'mono-dark': 'One colour, dark'
};

const UPLOAD_TYPES = 'image/png,image/svg+xml,image/webp,image/jpeg';
const MAX_MB = 15;

type Editable = Pick<BrandKit, 'colors' | 'fonts' | 'rules' | 'notes' | 'contact'>;
const editableOf = (k: BrandKit): Editable => ({ colors: k.colors, fonts: k.fonts, rules: k.rules, notes: k.notes || '', contact: k.contact || { social: '', web: '' } });

export default function PostersSection() {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [catalog, setCatalog] = useState<DesignCatalog | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([designAPI.kit(), designAPI.catalog()])
      .then(([k, c]) => {
        setKit(k);
        setForm(editableOf(k));
        setCatalog(c);
        loadCatalogFonts(c.fonts);
      })
      .catch((e) => setError(errorMessage(e, 'Your poster settings couldn’t load.')));
  }, []);

  const saved = useMemo(() => (kit ? editableOf(kit) : null), [kit]);
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Logos and partners change the kit straight away; the form keeps the user's unsaved edits.
  const took = (k: BrandKit, message?: string, warning?: string | null) => {
    setKit(k);
    if (warning) notify(warning, { tone: 'error', duration: 9000 });
    else if (message) notify(message);
  };
  const run = async (key: string, fn: () => Promise<void>, failure: string) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      notify(errorMessage(e, failure), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!form || !dirty || saving) return;
    setSaving(true);
    try {
      const k = await designAPI.saveKit({ ...form, rules: form.rules.filter((r) => r.text.trim()) });
      setKit(k);
      setForm(editableOf(k));
      notify('Poster settings saved');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save the poster settings.'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const choosePack = (id: string | null) =>
    run(
      'pack',
      async () => {
        const k = await designAPI.saveKit({ pack: id });
        setKit(k);
        setForm(editableOf(k));
        const pack = catalog?.packs.find((p) => p.id === id);
        notify(pack ? `Posters now follow ${pack.name}’s brand` : 'Your own colours and fonts from now on');
      },
      'Couldn’t change the brand pack.'
    );

  if (error) return <Typography sx={{ color: 'var(--st-attention-fg)' }}>{error}</Typography>;
  if (!kit || !form || !catalog) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  const pack = catalog.packs.find((p) => p.id === kit.pack) || null;
  const primary = kit.logos.find((l) => l.role === 'primary') || null;
  const campaigns = kit.logos.filter((l) => l.role === 'campaign');
  const palette = pack ? dedupe([...Object.values(pack.colors), ...pack.palette]) : null;

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 3.5, pb: dirty ? 8 : 0 }}
    >
      {/* Brand pack */}
      <Group title="Brand" hint="Rotary and Rotaract clubs: choose your brand and posters follow its official colours, fonts and logo rules.">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }} role="radiogroup" aria-label="Brand pack">
          {[{ id: null as string | null, name: 'My own brand', colors: null as KitColors | null }, ...catalog.packs.map((p) => ({ id: p.id as string | null, name: p.name, colors: p.colors as KitColors | null }))].map((p) => {
            const on = (kit.pack || null) === p.id;
            return (
              <Box
                key={p.id || 'own'}
                component="button"
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy === 'pack'}
                onClick={() => !on && choosePack(p.id)}
                sx={{
                  all: 'unset', cursor: on ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 'var(--r-ctl)',
                  border: on ? '2px solid var(--text-strong)' : '1px solid var(--border)', m: on ? 0 : '1px',
                  '&:focus-visible': { outline: '2px solid var(--focus, #3b82f6)', outlineOffset: 2 }
                }}
              >
                {p.colors && (
                  <Box sx={{ display: 'flex' }} aria-hidden>
                    {(['primary', 'secondary', 'accent'] as ColorRole[]).map((r) => (
                      <Box key={r} sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: p.colors![r].hex, ml: r === 'primary' ? 0 : '-4px', border: '1.5px solid var(--bg-raised)' }} />
                    ))}
                  </Box>
                )}
                <Typography sx={{ fontSize: 14, fontWeight: on ? 650 : 500, color: 'var(--text-strong)' }}>{p.name}</Typography>
              </Box>
            );
          })}
          {busy === 'pack' && <CircularProgress size={18} sx={{ alignSelf: 'center' }} />}
        </Box>
        {pack && (
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Colours come from {pack.name}’s palette and the fonts are fixed. Logos keep their official clear space and are never recoloured: where a logo wouldn’t stand out, posters use its white or dark version.
          </Typography>
        )}
      </Group>

      {/* Main logo */}
      <Group title="Your logo" hint="Upload the best file you have: an SVG, or a PNG at least 1,000 pixels wide. Logos save straight away.">
        <LogoCard
          logo={primary}
          role="primary"
          busy={busy}
          colors={kit.colors}
          onUpload={(file, logoId) => run(`upload:${logoId || 'primary'}`, async () => {
            const r = await designAPI.addLogo(file, { role: 'primary', name: 'Main logo', logoId });
            took(r.kit, logoId ? 'Version added' : 'Logo added', r.warning);
          }, 'Couldn’t add the logo.')}
          onRemoveVersion={(logo, v) => run(`version:${v.id}`, async () => took(await designAPI.updateLogo(logo.id, { removeVariant: v.id }), 'Version removed'), 'Couldn’t remove that version.')}
          onKind={(logo, v, kind) => run(`version:${v.id}`, async () => took(await designAPI.updateLogo(logo.id, { variantId: v.id, variant: kind })), 'Couldn’t change that version.')}
        />
      </Group>

      {/* Campaign logos */}
      <Group title="Campaign logos" hint="Logos like End Polio Now. They sit beside your logo, never in its place. Choose which go on every poster; for one poster you can add or leave them out.">
        {campaigns.map((l) => (
          <Box key={l.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, border: '1px solid var(--border)', borderRadius: 'var(--r-card)' }}>
            <LogoTile v={l.variants.find((v) => !v.derived) || l.variants[0]} colors={kit.colors} height={52} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{l.name}</Typography>
              <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', width: 'fit-content' }}>
                <Switch size="small" checked={Boolean(l.always)} disabled={busy !== null} onChange={(e) => run(`always:${l.id}`, async () => took(await designAPI.updateLogo(l.id, { always: e.target.checked })), 'Couldn’t change that.')} />
                On every poster
              </Box>
            </Box>
            <RemoveButton label={`Remove ${l.name}`} disabled={busy !== null} onConfirm={() => run(`remove:${l.id}`, async () => took(await designAPI.removeLogo(l.id), `${l.name} removed`), 'Couldn’t remove the logo.')} />
          </Box>
        ))}
        <AddWithName
          label="Campaign logo"
          placeholder="e.g. End Polio Now"
          busy={busy === 'upload:campaign'}
          disabled={busy !== null}
          onAdd={(file, name) => run('upload:campaign', async () => {
            const r = await designAPI.addLogo(file, { role: 'campaign', name });
            took(r.kit, `${name} added`, r.warning);
          }, 'Couldn’t add the logo.')}
        />
      </Group>

      {/* Partners */}
      <Group title="Partners and sponsors" hint="Add each partner’s logo once and tick it on any poster. Posters size them so each looks equally important, and never bigger than your logo.">
        {kit.partners.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.25 }}>
            {kit.partners.map((p) => {
              const usable = p.logo.onLight || (p.alts || []).some((a) => a.onLight);
              return (
                <Box key={p.id} sx={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 0.75, p: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-card)' }}>
                  <Box sx={{ height: 64, display: 'grid', placeItems: 'center', bgcolor: '#fff', borderRadius: 'calc(var(--r-card) - 2px)' }}>
                    <Box component="img" src={(p.logo.onLight ? p.logo : (p.alts || []).find((a) => a.onLight) || p.logo).url} alt="" sx={{ maxWidth: '85%', maxHeight: 48, objectFit: 'contain', ...(usable ? {} : { bgcolor: '#1f2430', p: 0.5 }) }} />
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', pr: 3.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
                    {p.name}
                  </Typography>
                  {(p.logo.lowRes || !p.logo.onLight) && (
                    <Typography sx={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 0.5, alignItems: 'flex-start', lineHeight: 1.3 }}>
                      {p.logo.lowRes && <WarnIcon sx={{ fontSize: 14, color: 'var(--warning-text, #b45309)', mt: '1px' }} />}
                      {p.logo.lowRes ? 'Small file: fine on social media, soft in print.' : 'White logo: shown in dark on the white band.'}
                    </Typography>
                  )}
                  <Box sx={{ position: 'absolute', right: 2, bottom: 2 }}>
                    <RemoveButton label={`Remove ${p.name}`} disabled={busy !== null} onConfirm={() => run(`partner:${p.id}`, async () => took(await designAPI.removePartner(p.id), `${p.name} removed`), 'Couldn’t remove the partner.')} />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
        <AddWithName
          label="Partner"
          placeholder="Partner’s name, e.g. Equity Bank"
          busy={busy === 'upload:partner'}
          disabled={busy !== null || kit.partners.length >= 60}
          onAdd={(file, name) => run('upload:partner', async () => {
            const r = await designAPI.addPartner(file, name);
            took(r.kit, `${name} added`, r.warning);
          }, 'Couldn’t add the partner.')}
        />
      </Group>

      {/* Colours */}
      <Group title="Colours" hint={pack ? `From ${pack.name}’s palette.` : 'Taken from your logo at first. Adjust them to your brand.'}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(5, minmax(0, 1fr))' }, gap: 1.5 }}>
          {ROLES.map(({ role, label, hint }) => (
            <ColorField
              key={role}
              label={label}
              hint={hint}
              value={form.colors[role]}
              palette={palette}
              onChange={(c) => setForm((f) => (f ? { ...f, colors: { ...f.colors, [role]: c } } : f))}
            />
          ))}
        </Box>
      </Group>

      {/* Fonts */}
      <Group title="Fonts" hint={pack ? `${pack.name}’s fonts (open-licence stand-ins for the official ones).` : 'Headlines, text, and an optional accent for a word or two.'}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
          {(
            [
              ['display', 'Headlines'],
              ['text', 'Text'],
              ['accent', 'Accent (optional)']
            ] as [keyof KitFonts, string][]
          ).map(([key, label]) => (
            <TextField
              key={key}
              select
              label={label}
              value={form.fonts[key] || ''}
              disabled={Boolean(pack)}
              onChange={(e) => setForm((f) => (f ? { ...f, fonts: { ...f.fonts, [key]: e.target.value || undefined } } : f))}
              InputProps={pack ? { endAdornment: <LockIcon sx={{ fontSize: 16, color: 'var(--text-faint)', mr: 3 }} /> } : undefined}
              SelectProps={{ renderValue: (v) => <span style={{ fontFamily: kitFontFamily(String(v), catalog.fonts), fontSize: 16 }}>{catalog.fonts.find((x) => x.id === v)?.family || 'None'}</span> }}
              fullWidth
            >
              {key === 'accent' && (
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
              )}
              {catalog.fonts.map((fnt) => (
                <MenuItem key={fnt.id} value={fnt.id} sx={{ display: 'block' }}>
                  <Box sx={{ fontFamily: kitFontFamily(fnt.id, catalog.fonts), fontSize: 18, lineHeight: 1.3 }}>{fnt.family}</Box>
                  {fnt.note && <Box sx={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: 340 }}>{fnt.note}</Box>}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </Box>
        <FontSample fonts={form.fonts} catalog={catalog} colors={form.colors} />
      </Group>

      {/* Contact */}
      <Group title="Contact line" hint="Shown at the foot of posters where the design has room.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          <TextField label="Social handle" placeholder="e.g. Rotaract Kampala East" value={form.contact.social} inputProps={{ maxLength: 60 }} onChange={(e) => setForm((f) => (f ? { ...f, contact: { ...f.contact, social: e.target.value } } : f))} />
          <TextField label="Website" placeholder="e.g. rotaractkampalaeast.org" value={form.contact.web} inputProps={{ maxLength: 60 }} onChange={(e) => setForm((f) => (f ? { ...f, contact: { ...f.contact, web: e.target.value } } : f))} />
        </Box>
      </Group>

      {/* Rules */}
      <Group title="Rules" hint="What posters must and mustn’t do. The art director follows them, and changes that break them are explained instead of made.">
        {pack && (
          <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.75 }} aria-label={`${pack.name}’s rules`}>
            {pack.rules.map((r) => (
              <Box component="li" key={r.id} sx={{ display: 'flex', gap: 1, fontSize: 13.5, color: 'var(--text-strong)' }}>
                <LockIcon sx={{ fontSize: 16, color: 'var(--text-faint)', mt: '2px', flexShrink: 0 }} titleAccess={`${pack.name} rule`} />
                {r.text}
              </Box>
            ))}
          </Box>
        )}
        <RulesEditor rules={form.rules} onChange={(rules) => setForm((f) => (f ? { ...f, rules } : f))} />
        <TextField
          label="Anything else a designer should know"
          value={form.notes}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => (f ? { ...f, notes: e.target.value } : f))}
          multiline
          minRows={2}
          inputProps={{ maxLength: 3000 }}
          placeholder="e.g. Our members wear yellow vests at projects; we prefer photos of people at work over posed groups."
          fullWidth
        />
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

// ---------------------------------------------------------------------------------------------------

function dedupe(colors: { name: string; hex: string }[]) {
  const seen = new Set<string>();
  return colors.filter((c) => {
    const k = c.hex.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A logo version on the ground it's made for. */
function LogoTile({ v, colors, height = 64 }: { v?: LogoVariant; colors: KitColors; height?: number }) {
  if (!v) return null;
  const dark = v.onDark && !v.onLight;
  return (
    <Box sx={{ height: height + 16, minWidth: height * 1.6, px: 1.5, display: 'grid', placeItems: 'center', bgcolor: dark ? colors.primary.hex : '#fff', borderRadius: 'var(--r-ctl)', border: '1px solid var(--border)' }}>
      <Box component="img" src={v.url} alt="" sx={{ maxHeight: height, maxWidth: height * 3.2, objectFit: 'contain', display: 'block' }} />
    </Box>
  );
}

function LogoCard({
  logo,
  busy,
  colors,
  onUpload,
  onRemoveVersion,
  onKind
}: {
  logo: KitLogo | null;
  role: 'primary';
  busy: string | null;
  colors: KitColors;
  onUpload: (file: File, logoId?: string) => void;
  onRemoveVersion: (logo: KitLogo, v: LogoVariant) => void;
  onKind: (logo: KitLogo, v: LogoVariant, kind: LogoVariantKind) => void;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const pick = (logoId?: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && checkFile(file)) onUpload(file, logoId);
  };
  const uploading = busy?.startsWith('upload:');
  const supplied = logo ? logo.variants.filter((v) => !v.derived) : [];
  const made = logo ? logo.variants.filter((v) => v.derived) : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)' }}>
      {logo ? (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {[...supplied, ...made].map((v) => (
              <Box key={v.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: 'min-content', minWidth: 150 }}>
                <LogoTile v={v} colors={colors} />
                {v.derived ? (
                  <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {VERSION_LABEL[v.variant]}
                    <br />
                    <Box component="span" sx={{ color: 'var(--text-faint)' }}>Made from your logo, used where the original wouldn’t stand out</Box>
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TextField
                      select
                      size="small"
                      value={v.variant}
                      onChange={(e) => onKind(logo, v, e.target.value as LogoVariantKind)}
                      disabled={busy !== null}
                      inputProps={{ 'aria-label': 'Which version this is' }}
                      sx={{ flex: 1, '& .MuiSelect-select': { py: 0.5, fontSize: 12.5 } }}
                    >
                      {(Object.keys(VERSION_LABEL) as LogoVariantKind[]).map((k) => (
                        <MenuItem key={k} value={k} sx={{ fontSize: 13 }}>
                          {VERSION_LABEL[k]}
                        </MenuItem>
                      ))}
                    </TextField>
                    {supplied.length > 1 && <RemoveButton label="Remove this version" disabled={busy !== null} onConfirm={() => onRemoveVersion(logo, v)} />}
                  </Box>
                )}
                {v.lowRes && !v.derived && (
                  <Typography sx={{ fontSize: 11.5, color: 'var(--warning-text, #b45309)', display: 'flex', gap: 0.5 }}>
                    <WarnIcon sx={{ fontSize: 14, mt: '1px' }} />
                    Small file: may look soft in print.
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button size="small" variant="outlined" startIcon={uploading ? <CircularProgress size={14} /> : <UploadIcon />} disabled={busy !== null} onClick={() => replaceRef.current?.click()}>
              Replace logo
            </Button>
            <Button size="small" startIcon={<AddIcon />} disabled={busy !== null || supplied.length >= 4} onClick={() => addRef.current?.click()}>
              Add another version
            </Button>
            <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>e.g. the official white version for dark backgrounds</Typography>
          </Box>
        </>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)', flex: 1, minWidth: 200 }}>No logo yet. Posters need your logo.</Typography>
          <Button variant="contained" startIcon={uploading ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <UploadIcon />} disabled={busy !== null} onClick={() => replaceRef.current?.click()}>
            Upload your logo
          </Button>
        </Box>
      )}
      <input ref={replaceRef} type="file" hidden accept={UPLOAD_TYPES} onChange={pick(undefined)} />
      <input ref={addRef} type="file" hidden accept={UPLOAD_TYPES} onChange={pick(logo?.id)} />
    </Box>
  );
}

function checkFile(file: File): boolean {
  if (!/^image\/(png|jpe?g|webp|svg\+xml)$/i.test(file.type)) {
    notify('Use a PNG, JPG, WebP or SVG file.', { tone: 'error' });
    return false;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    notify(`That file is over ${MAX_MB} MB.`, { tone: 'error' });
    return false;
  }
  return true;
}

/** A name, then a file: for campaign logos and partners. */
function AddWithName({ label, placeholder, busy, disabled, onAdd }: { label: string; placeholder: string; busy: boolean; disabled: boolean; onAdd: (file: File, name: string) => void }) {
  const [name, setName] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <TextField size="small" label={`${label} name`} placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 80 }} sx={{ flex: 1, minWidth: 220 }} />
      <Button
        variant="outlined"
        startIcon={busy ? <CircularProgress size={14} /> : <UploadIcon />}
        disabled={disabled || !name.trim()}
        onClick={() => ref.current?.click()}
        sx={{ height: 40 }}
      >
        Choose logo file
      </Button>
      <input
        ref={ref}
        type="file"
        hidden
        accept={UPLOAD_TYPES}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && checkFile(file)) {
            onAdd(file, name.trim());
            setName('');
          }
        }}
      />
    </Box>
  );
}

/** Remove, asked once more right there (no dialog). */
function RemoveButton({ label, disabled, onConfirm }: { label: string; disabled: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking]);
  if (asking) {
    return (
      <Button
        size="small"
        color="error"
        variant="contained"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        sx={{ py: 0.25, minWidth: 0, fontSize: 12 }}
      >
        Remove?
      </Button>
    );
  }
  return (
    <Tooltip title={label}>
      <span>
        <IconButton size="small" aria-label={label} disabled={disabled} onClick={() => setAsking(true)}>
          <RemoveIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}

function ColorField({ label, hint, value, palette, onChange }: { label: string; hint: string; value: { name: string; hex: string }; palette: { name: string; hex: string }[] | null; onChange: (c: { name: string; hex: string }) => void }) {
  const [text, setText] = useState(value.hex);
  useEffect(() => setText(value.hex), [value.hex]);
  const valid = /^#[0-9a-f]{6}$/i.test(text);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
        {label}
        <Box component="span" sx={{ display: 'block', fontWeight: 400, fontSize: 11.5, color: 'var(--text-muted)' }}>
          {hint}
        </Box>
      </Typography>
      {palette ? (
        <TextField
          select
          size="small"
          value={value.hex.toLowerCase()}
          onChange={(e) => {
            const c = palette.find((p) => p.hex.toLowerCase() === e.target.value);
            if (c) onChange({ name: c.name, hex: c.hex.toLowerCase() });
          }}
          SelectProps={{ renderValue: () => <Swatch hex={value.hex} name={value.name} /> }}
        >
          {palette.map((p) => (
            <MenuItem key={p.hex} value={p.hex.toLowerCase()}>
              <Swatch hex={p.hex} name={p.name} />
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
          <Box
            component="input"
            type="color"
            value={valid ? text : value.hex}
            aria-label={`${label}: pick a colour`}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setText(e.target.value);
              onChange({ name: value.name, hex: e.target.value.toLowerCase() });
            }}
            sx={{ width: 36, height: 36, p: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)', bgcolor: 'transparent', cursor: 'pointer', flexShrink: 0 }}
          />
          <TextField
            size="small"
            value={text}
            error={!valid}
            inputProps={{ 'aria-label': `${label}: hex value`, maxLength: 7, style: { fontFamily: 'ui-monospace, monospace', fontSize: 13 } }}
            onChange={(e) => {
              const t = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
              setText(t);
              if (/^#[0-9a-f]{6}$/i.test(t)) onChange({ name: value.name, hex: t.toLowerCase() });
            }}
          />
        </Box>
      )}
    </Box>
  );
}

function Swatch({ hex, name }: { hex: string; name: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box sx={{ width: 18, height: 18, borderRadius: '4px', bgcolor: hex, border: '1px solid rgba(0,0,0,.15)', flexShrink: 0 }} />
      <Box component="span" sx={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </Box>
    </Box>
  );
}

/** The fonts and colours together, as a poster would set them. */
function FontSample({ fonts, catalog, colors }: { fonts: KitFonts; catalog: DesignCatalog; colors: KitColors }) {
  return (
    <Box sx={{ p: 2, borderRadius: 'var(--r-card)', bgcolor: colors.primary.hex, color: '#fff', display: 'flex', flexDirection: 'column', gap: 0.75, overflow: 'hidden' }} aria-label="Sample">
      <Box sx={{ fontFamily: kitFontFamily(fonts.display, catalog.fonts), fontWeight: 700, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.accent.hex }}>Community service</Box>
      <Box sx={{ fontFamily: kitFontFamily(fonts.display, catalog.fonts), fontWeight: 800, fontSize: 30, lineHeight: 1.05 }}>
        Clean schools,{' '}
        <Box component="span" sx={{ fontFamily: fonts.accent ? kitFontFamily(fonts.accent, catalog.fonts) : undefined, color: colors.accent.hex, fontStyle: fonts.accent ? 'normal' : 'italic' }}>
          bright futures
        </Box>
      </Box>
      <Box sx={{ fontFamily: kitFontFamily(fonts.text, catalog.fonts), fontSize: 15, lineHeight: 1.45, opacity: 0.92 }}>Join us as we spend the day cleaning and repainting classrooms with the pupils.</Box>
    </Box>
  );
}

function RulesEditor({ rules, onChange }: { rules: KitRule[]; onChange: (rules: KitRule[]) => void }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rules.map((r, i) =>
        r.hard ? (
          // Made mandatory by an administrator: shown, not edited here.
          <Box key={r.id || i} sx={{ display: 'flex', gap: 1, fontSize: 13.5, color: 'var(--text-strong)' }}>
            <LockIcon sx={{ fontSize: 16, color: 'var(--text-faint)', mt: '2px', flexShrink: 0 }} titleAccess="Set by an administrator" />
            {r.text}
          </Box>
        ) : (
        <Box key={r.id || i} sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            fullWidth
            multiline
            value={r.text}
            placeholder="e.g. Always show our partner Equity Bank on fundraising posters."
            inputProps={{ maxLength: 400, 'aria-label': `Rule ${i + 1}` }}
            onChange={(e) => onChange(rules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
          />
          <IconButton size="small" aria-label={`Remove rule ${i + 1}`} onClick={() => onChange(rules.filter((_, j) => j !== i))} sx={{ mt: 0.25 }}>
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Box>
        )
      )}
      {rules.length < 30 && (
        <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...rules, { id: '', text: '', hard: false }])} sx={{ alignSelf: 'flex-start' }}>
          Add a rule
        </Button>
      )}
    </Box>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="fieldset" sx={{ border: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.75, minWidth: 0 }}>
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
