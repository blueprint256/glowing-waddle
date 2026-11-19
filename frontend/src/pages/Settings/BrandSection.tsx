import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Box, Button, Checkbox, CircularProgress, FormControlLabel, MenuItem, Radio, RadioGroup, Switch, TextField, Typography } from '@mui/material';
import { LockOutlined as LockIcon, Upload as UploadIcon, WarningAmberRounded as WarnIcon } from '@mui/icons-material';
import api from '../../services/api';
import {
  designAPI,
  fontChoices,
  kitFontFamily,
  loadCatalogFonts,
  loadCustomFonts,
  type BrandKit,
  type DesignCatalog,
  type KitFonts,
  type KitRule
} from '../../services/design';
import { errorMessage, notify } from '../../store/toastStore';
import { BRAND_TONES, SECTORS } from './settingsShared';
import { AddWithName, ColorField, FontSample, LogoCard, LogoTile, RemoveButton, ROLES, RulesEditor, dedupe } from './brandKitParts';

/**
 * Settings › Brand: one place for everything the app's AI writes and designs from.
 *  - About you and How you sound: what captions, plans and posters say, and how
 *  - Logos, partners, colours, fonts (bundled or uploaded), the contact line and the rules: what
 *    pictures and posters look like
 * Logos, partners and fonts save as soon as they're added; the rest has one Save bar.
 *
 * Clubs: a Rotary or Rotaract club ticks one box and its posters follow that brand's official
 * colours, fonts and logo rules. Nobody else sees anything of it.
 */

interface Info {
  companyName: string;
  sector: string;
  about: string;
  productsServices: string;
  usp: string;
  brandTone: string;
  audienceProfile: string;
  globalRules: string;
  brandGuidelines: string;
}

const EMPTY: Info = { companyName: '', sector: '', about: '', productsServices: '', usp: '', brandTone: '', audienceProfile: '', globalRules: '', brandGuidelines: '' };
const INFO_FIELDS = Object.keys(EMPTY) as (keyof Info)[];

type Look = Pick<BrandKit, 'colors' | 'fonts' | 'rules' | 'contact'>;
const lookOf = (k: BrandKit): Look => ({ colors: k.colors, fonts: k.fonts, rules: k.rules, contact: k.contact || { social: '', web: '' } });

const CLUBS = [
  { id: 'rotary', name: 'Rotary club' },
  { id: 'rotaract', name: 'Rotaract club' }
];

const FONT_TYPES = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

export default function BrandSection() {
  const [savedInfo, setSavedInfo] = useState<Info | null>(null);
  const [info, setInfo] = useState<Info>(EMPTY);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const [catalog, setCatalog] = useState<DesignCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Notes written for posters before Brand and Posters were one page, moved into Brand guidelines. */
  const [movedNotes, setMovedNotes] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/users/me/company-info'), designAPI.kit(), designAPI.catalog()])
      .then(([r, k, c]) => {
        const loaded = { ...EMPTY, ...Object.fromEntries(Object.entries(r.data.companyInfo || {}).filter(([key]) => key in EMPTY).map(([key, v]) => [key, v ?? ''])) } as Info;
        setSavedInfo(loaded);
        const notes = (k.notes || '').trim();
        if (notes && !loaded.brandGuidelines.includes(notes)) {
          setInfo({ ...loaded, brandGuidelines: [loaded.brandGuidelines.trim(), notes].filter(Boolean).join('\n\n') });
          setMovedNotes(true);
        } else setInfo(loaded);
        setKit(k);
        setLook(lookOf(k));
        setCatalog(c);
        loadCatalogFonts(c.fonts);
        loadCustomFonts(k.customFonts || []);
      })
      .catch((e) => setError(errorMessage(e, 'Your brand couldn’t load.')));
  }, []);

  const savedLook = useMemo(() => (kit ? lookOf(kit) : null), [kit]);
  const infoDirty = Boolean(savedInfo) && INFO_FIELDS.some((k) => info[k] !== savedInfo![k]);
  const lookDirty = Boolean(look && savedLook && JSON.stringify(look) !== JSON.stringify(savedLook));
  const dirty = infoDirty || lookDirty;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Logos, partners and fonts change the kit straight away; the form keeps unsaved edits.
  const took = (k: BrandKit, message?: string, warning?: string | null) => {
    setKit(k);
    loadCustomFonts(k.customFonts || []);
    setLook((l) => (l ? { ...l, fonts: k.fonts } : l));
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
    if (!dirty || saving || !look) return;
    setSaving(true);
    try {
      if (infoDirty) {
        const body = Object.fromEntries(INFO_FIELDS.map((k) => [k, info[k].trim()]));
        await api.patch('/users/me/company-info', body);
        const next = { ...info, ...body } as Info;
        setSavedInfo(next);
        setInfo(next);
      }
      if (lookDirty || movedNotes) {
        const k = await designAPI.saveKit({ ...look, rules: look.rules.filter((r) => r.text.trim()), ...(movedNotes ? { notes: '' } : {}) });
        setKit(k);
        setLook(lookOf(k));
        setMovedNotes(false);
      }
      notify('Brand saved');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save your brand.'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (savedInfo) setInfo(savedInfo);
    if (savedLook) setLook(savedLook);
    setMovedNotes(false);
  };

  const chooseClub = (id: string | null) =>
    run(
      'pack',
      async () => {
        const k = await designAPI.saveKit({ pack: id });
        setKit(k);
        setLook(lookOf(k));
        const club = CLUBS.find((c) => c.id === id);
        notify(club ? `Posters now follow the ${club.name.replace(' club', '')} brand` : 'Your own colours and fonts from now on');
      },
      'Couldn’t change that.'
    );

  if (error) return <Typography sx={{ color: 'var(--st-attention-fg)' }}>{error}</Typography>;
  if (!savedInfo || !kit || !look || !catalog) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  const set = (key: keyof Info) => (e: ChangeEvent<HTMLInputElement>) => setInfo((f) => ({ ...f, [key]: e.target.value }));
  const pack = catalog.packs.find((p) => p.id === kit.pack) || null;
  const primary = kit.logos.find((l) => l.role === 'primary') || null;
  const others = kit.logos.filter((l) => l.role === 'campaign');
  const palette = pack ? dedupe([...Object.values(pack.colors), ...pack.palette]) : null;
  const choices = fontChoices(catalog.fonts, kit.customFonts || []);
  const sectorOptions = info.sector && !SECTORS.includes(info.sector) ? [info.sector, ...SECTORS] : SECTORS;
  const toneOptions = info.brandTone && !BRAND_TONES.includes(info.brandTone) ? [info.brandTone, ...BRAND_TONES] : BRAND_TONES;

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 3.5, pb: dirty ? 8 : 0 }}
    >
      <Group title="About you" hint="The basics every caption, plan and poster starts from.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
          <TextField label="Name" value={info.companyName} onChange={set('companyName')} fullWidth helperText="Your business, organisation or club, as it should appear." />
          <TextField select label="Industry" value={info.sector} onChange={set('sector')} fullWidth>
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
        <TextField label="What you do" value={info.about} onChange={set('about')} multiline minRows={3} fullWidth placeholder="A few sentences, as you’d tell someone new." />
        <TextField label="Products, services or programmes" value={info.productsServices} onChange={set('productsServices')} multiline minRows={2} fullWidth />
        <TextField label="What makes you different" value={info.usp} onChange={set('usp')} multiline minRows={2} fullWidth />

        <Box>
          <FormControlLabel
            control={<Checkbox checked={Boolean(kit.pack)} disabled={busy === 'pack'} onChange={(e) => chooseClub(e.target.checked ? 'rotary' : null)} />}
            label={<Typography sx={{ fontSize: 14 }}>We’re a Rotary or Rotaract club</Typography>}
          />
          {kit.pack && (
            <Box sx={{ pl: 4, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <RadioGroup row value={kit.pack} onChange={(e) => chooseClub(e.target.value)} aria-label="Which club">
                {CLUBS.map((c) => (
                  <FormControlLabel key={c.id} value={c.id} control={<Radio size="small" disabled={busy === 'pack'} />} label={<Typography sx={{ fontSize: 14 }}>{c.name}</Typography>} />
                ))}
              </RadioGroup>
              <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Posters follow the official {pack?.name || 'club'} brand: its colours, fonts and logo rules. Logos keep their clear space and are never recoloured.
              </Typography>
            </Box>
          )}
        </Box>
      </Group>

      <Group title="How you sound" hint="So the AI writes the way you would.">
        <TextField select label="Tone of voice" value={info.brandTone} onChange={set('brandTone')} fullWidth sx={{ maxWidth: 320 }}>
          <MenuItem value="">
            <em>Not set</em>
          </MenuItem>
          {toneOptions.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Who you’re talking to" value={info.audienceProfile} onChange={set('audienceProfile')} multiline minRows={2} fullWidth placeholder="Age, interests, where they are, what they care about." />
        <TextField label="Always and never" value={info.globalRules} onChange={set('globalRules')} multiline minRows={3} fullWidth placeholder="e.g. Always say “Kampala”, never “KLA”. No slang. At most two emojis." />
      </Group>

      <Group title="Your logo" hint="The best file you have: an SVG, or a PNG at least 1,000 pixels wide. It goes on every poster, and the app makes white and dark versions for dark and light backgrounds. Saves straight away.">
        <LogoCard
          logo={primary}
          role="primary"
          busy={busy}
          colors={kit.colors}
          onUpload={(file, logoId) =>
            run(
              `upload:${logoId || 'primary'}`,
              async () => {
                const r = await designAPI.addLogo(file, { role: 'primary', name: 'Main logo', logoId });
                took(r.kit, logoId ? 'Version added' : 'Logo added', r.warning);
              },
              'Couldn’t add the logo.'
            )
          }
          onRemoveVersion={(logo, v) => run(`version:${v.id}`, async () => took(await designAPI.updateLogo(logo.id, { removeVariant: v.id }), 'Version removed'), 'Couldn’t remove that version.')}
          onKind={(logo, v, kind) => run(`version:${v.id}`, async () => took(await designAPI.updateLogo(logo.id, { variantId: v.id, variant: kind })), 'Couldn’t change that version.')}
        />
      </Group>

      <Group title="Other logos" hint="A programme, campaign or event logo. It sits beside your logo, never in its place. Choose which go on every poster; you can add or leave them out for one poster.">
        {others.map((l) => (
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
          label="Logo"
          placeholder="e.g. our annual fun run"
          busy={busy === 'upload:campaign'}
          disabled={busy !== null}
          onAdd={(file, name) =>
            run(
              'upload:campaign',
              async () => {
                const r = await designAPI.addLogo(file, { role: 'campaign', name });
                took(r.kit, `${name} added`, r.warning);
              },
              'Couldn’t add the logo.'
            )
          }
        />
      </Group>

      <Group title="Partners and sponsors" hint="Add each partner’s logo once, then tick it on any poster. Posters size them so each looks equally important, and never bigger than your logo.">
        {kit.partners.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.25 }}>
            {kit.partners.map((p) => {
              const shown = p.logo.onLight ? p.logo : (p.alts || []).find((a) => a.onLight) || p.logo;
              return (
                <Box key={p.id} sx={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 0.75, p: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-card)' }}>
                  <Box sx={{ height: 64, display: 'grid', placeItems: 'center', bgcolor: shown.onLight ? '#fff' : '#1f2430', borderRadius: 'calc(var(--r-card) - 2px)' }}>
                    <Box component="img" src={shown.url} alt="" sx={{ maxWidth: '85%', maxHeight: 48, objectFit: 'contain' }} />
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', pr: 3.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
                    {p.name}
                  </Typography>
                  {p.logo.lowRes && (
                    <Typography sx={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 0.5, alignItems: 'flex-start', lineHeight: 1.3 }}>
                      <WarnIcon sx={{ fontSize: 14, color: 'var(--warning-text, #b45309)', mt: '1px' }} />
                      Small file: fine on social media, soft in print.
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
          placeholder="e.g. Equity Bank"
          busy={busy === 'upload:partner'}
          disabled={busy !== null || kit.partners.length >= 60}
          onAdd={(file, name) =>
            run(
              'upload:partner',
              async () => {
                const r = await designAPI.addPartner(file, name);
                took(r.kit, `${name} added`, r.warning);
              },
              'Couldn’t add the partner.'
            )
          }
        />
      </Group>

      <Group title="Colours" hint={pack ? `From the ${pack.name} palette.` : 'Taken from your logo or your guidelines at first. Adjust them to your brand.'}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(5, minmax(0, 1fr))' }, gap: 1.5 }}>
          {ROLES.map(({ role, label, hint }) => (
            <ColorField key={role} label={label} hint={hint} value={look.colors[role]} palette={palette} onChange={(c) => setLook((f) => (f ? { ...f, colors: { ...f.colors, [role]: c } } : f))} />
          ))}
        </Box>
      </Group>

      <Group title="Fonts" hint={pack ? `The ${pack.name} fonts (free stand-ins for the official ones).` : 'Headlines, text, and an optional accent for a word or two. Choose from the list or upload your own.'}>
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
              value={look.fonts[key] || ''}
              disabled={Boolean(pack)}
              onChange={(e) => setLook((f) => (f ? { ...f, fonts: { ...f.fonts, [key]: e.target.value || undefined } } : f))}
              InputProps={pack ? { endAdornment: <LockIcon sx={{ fontSize: 16, color: 'var(--text-faint)', mr: 3 }} /> } : undefined}
              SelectProps={{ renderValue: (v) => <span style={{ fontFamily: kitFontFamily(String(v), choices), fontSize: 16 }}>{choices.find((x) => x.id === v)?.family || 'None'}</span> }}
              fullWidth
            >
              {key === 'accent' && (
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
              )}
              {choices.map((fnt) => (
                <MenuItem key={fnt.id} value={fnt.id} sx={{ display: 'block' }}>
                  <Box sx={{ fontFamily: kitFontFamily(fnt.id, choices), fontSize: 18, lineHeight: 1.3 }}>{fnt.family}</Box>
                  {fnt.note && <Box sx={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: 340 }}>{fnt.note}</Box>}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </Box>
        <FontSample fonts={look.fonts} choices={choices} colors={look.colors} />
        {!pack && (
          <FontUploads
            kit={kit}
            busy={busy}
            onAdd={(file, fields) =>
              run(
                fields.fontId ? `font:${fields.fontId}` : 'font:new',
                async () => {
                  const r = await designAPI.addFont(file, fields);
                  took(r.kit, r.message);
                },
                'Couldn’t add the font.'
              )
            }
            onRemove={(id, name) => run(`font:${id}`, async () => took(await designAPI.removeFont(id), `${name} removed`), 'Couldn’t remove the font.')}
          />
        )}
      </Group>

      <Group title="Contact line" hint="Shown at the foot of posters where the design has room.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          <TextField label="Social handle" placeholder="e.g. @kawabora" value={look.contact.social} inputProps={{ maxLength: 60 }} onChange={(e) => setLook((f) => (f ? { ...f, contact: { ...f.contact, social: e.target.value } } : f))} />
          <TextField label="Website" placeholder="e.g. kawabora.ug" value={look.contact.web} inputProps={{ maxLength: 60 }} onChange={(e) => setLook((f) => (f ? { ...f, contact: { ...f.contact, web: e.target.value } } : f))} />
        </Box>
      </Group>

      <Group title="Guidelines and rules" hint="What every caption, picture and poster must and mustn’t do.">
        {movedNotes && (
          <Typography sx={{ fontSize: 13, color: 'var(--text-strong)', p: 1, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)' }}>
            Your notes for posters are now part of Brand guidelines below. Save to keep them there.
          </Typography>
        )}
        <TextField
          label="Brand guidelines"
          value={info.brandGuidelines}
          onChange={set('brandGuidelines')}
          multiline
          minRows={4}
          fullWidth
          placeholder="Photo style, words to use and avoid, anything a designer should know…"
          helperText="Captions, AI pictures and posters all follow these."
        />
        {pack && (
          <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.75 }} aria-label={`${pack.name} rules`}>
            {pack.rules.map((r) => (
              <Box component="li" key={r.id} sx={{ display: 'flex', gap: 1, fontSize: 13.5, color: 'var(--text-strong)' }}>
                <LockIcon sx={{ fontSize: 16, color: 'var(--text-faint)', mt: '2px', flexShrink: 0 }} titleAccess={`${pack.name} rule`} />
                {r.text}
              </Box>
            ))}
          </Box>
        )}
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', mb: -1 }}>Poster rules</Typography>
        <RulesEditor rules={look.rules} onChange={(rules: KitRule[]) => setLook((f) => (f ? { ...f, rules } : f))} />
      </Group>

      {dirty && (
        <Box
          sx={{
            position: 'sticky', bottom: 12, zIndex: 2, display: 'flex', alignItems: 'center', gap: 1, p: 1.25, pl: 2,
            borderRadius: 'var(--r-panel)', border: '1px solid var(--border-strong)', bgcolor: 'var(--bg-panel)', boxShadow: '0 6px 24px rgba(0,0,0,.18)'
          }}
        >
          <Typography sx={{ flex: 1, fontSize: 14 }}>You have unsaved changes.</Typography>
          <Button onClick={discard} disabled={saving}>
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

/** The account's uploaded fonts: add one (or another weight of one), remove one. */
function FontUploads({
  kit,
  busy,
  onAdd,
  onRemove
}: {
  kit: BrandKit;
  busy: string | null;
  onAdd: (file: File, fields: { name?: string; category?: string; fontId?: string }) => void;
  onRemove: (id: string, name: string) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('sans');
  const [target, setTarget] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const fonts = kit.customFonts || [];
  const pick = (fontId: string | null) => {
    setTarget(fontId);
    ref.current?.click();
  };
  const describe = (w: string, style: string) => {
    const names: Record<string, string> = { '100': 'Thin', '200': 'Extra light', '300': 'Light', '400': 'Regular', '500': 'Medium', '600': 'Semibold', '700': 'Bold', '800': 'Extra bold', '900': 'Black' };
    const weight = w.includes(' ') ? 'All weights' : names[w] || w;
    return style === 'italic' ? `${weight} italic` : weight;
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.5, border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-card)' }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>Your own fonts</Typography>
      {fonts.map((f) => (
        <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 180 }}>
            <Box sx={{ fontFamily: `"kit-${f.id}", system-ui`, fontSize: 20, lineHeight: 1.2, color: 'var(--text-strong)' }}>{f.name}</Box>
            <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.files.map((x) => describe(x.weight, x.style)).join(' · ')}</Typography>
          </Box>
          <Button size="small" startIcon={busy === `font:${f.id}` ? <CircularProgress size={14} /> : <UploadIcon />} disabled={busy !== null} onClick={() => pick(f.id)}>
            Add a weight
          </Button>
          <RemoveButton label={`Remove ${f.name}`} disabled={busy !== null} onConfirm={() => onRemove(f.id, f.name)} />
        </Box>
      ))}
      {fonts.length < 10 && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField size="small" label="Font name" placeholder="e.g. Kawa Sans" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 60 }} sx={{ flex: 1, minWidth: 180 }} />
          <TextField size="small" select label="Kind" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ width: 150 }}>
            <MenuItem value="sans">Sans serif</MenuItem>
            <MenuItem value="serif">Serif</MenuItem>
            <MenuItem value="display">Display</MenuItem>
            <MenuItem value="condensed">Condensed</MenuItem>
            <MenuItem value="script">Script</MenuItem>
          </TextField>
          <Button variant="outlined" startIcon={busy === 'font:new' ? <CircularProgress size={14} /> : <UploadIcon />} disabled={busy !== null} onClick={() => pick(null)} sx={{ height: 40 }}>
            Upload a font
          </Button>
        </Box>
      )}
      <input
        ref={ref}
        type="file"
        hidden
        accept={FONT_TYPES}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) return notify('Choose a TTF, OTF, WOFF or WOFF2 font file.', { tone: 'error' });
          if (file.size > 6 * 1024 * 1024) return notify('That font file is over 6 MB.', { tone: 'error' });
          onAdd(file, target ? { fontId: target } : { name: name.trim() || undefined, category });
          if (!target) setName('');
        }}
      />
      <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>
        TTF, OTF, WOFF or WOFF2, up to 6 MB. Upload each weight (regular, bold, italic) of the same font with “Add a weight”. Only upload fonts your licence lets you use in your own designs.
      </Typography>
    </Box>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="fieldset" sx={{ border: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
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
