import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Box, Button, CircularProgress, IconButton, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { Add as AddIcon, Close as RemoveIcon, LockOutlined as LockIcon, Upload as UploadIcon, WarningAmberRounded as WarnIcon } from '@mui/icons-material';
import {
  kitFontFamily,
  type ColorRole,
  type CatalogFont,
  type KitColors,
  type KitFonts,
  type KitLogo,
  type KitRule,
  type LogoVariant,
  type LogoVariantKind
} from '../../services/design';
import { notify } from '../../store/toastStore';

/**
 * The parts of Settings › Brand that show the brand kit: logo cards and their versions, partner and
 * logo uploads, colour fields, the font sample and the rules editor.
 */

export const ROLES: { role: ColorRole; label: string; hint: string }[] = [
  { role: 'primary', label: 'Main colour', hint: 'Panels and fades' },
  { role: 'secondary', label: 'Second colour', hint: 'Grounds and depth' },
  { role: 'accent', label: 'Accent', hint: 'Dates, buttons, highlights' },
  { role: 'ink', label: 'Text', hint: 'Dark words' },
  { role: 'paper', label: 'Paper', hint: 'Light grounds, partner band' }
];

export const VERSION_LABEL: Record<LogoVariantKind, string> = {
  color: 'Colour',
  reverse: 'White (for dark grounds)',
  'mono-light': 'One colour, white',
  'mono-dark': 'One colour, dark'
};

export const UPLOAD_TYPES = 'image/png,image/svg+xml,image/webp,image/jpeg';
export const MAX_MB = 15;

// ---------------------------------------------------------------------------------------------------

export function dedupe(colors: { name: string; hex: string }[]) {
  const seen = new Set<string>();
  return colors.filter((c) => {
    const k = c.hex.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A logo version on the ground it's made for. */
export function LogoTile({ v, colors, height = 64 }: { v?: LogoVariant; colors: KitColors; height?: number }) {
  if (!v) return null;
  const dark = v.onDark && !v.onLight;
  return (
    <Box sx={{ height: height + 16, minWidth: height * 1.6, px: 1.5, display: 'grid', placeItems: 'center', bgcolor: dark ? colors.primary.hex : '#fff', borderRadius: 'var(--r-ctl)', border: '1px solid var(--border)' }}>
      <Box component="img" src={v.url} alt="" sx={{ maxHeight: height, maxWidth: height * 3.2, objectFit: 'contain', display: 'block' }} />
    </Box>
  );
}

export function LogoCard({
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

export function checkFile(file: File): boolean {
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
export function AddWithName({ label, placeholder, busy, disabled, onAdd }: { label: string; placeholder: string; busy: boolean; disabled: boolean; onAdd: (file: File, name: string) => void }) {
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
export function RemoveButton({ label, disabled, onConfirm }: { label: string; disabled: boolean; onConfirm: () => void }) {
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

export function ColorField({ label, hint, value, palette, onChange }: { label: string; hint: string; value: { name: string; hex: string }; palette: { name: string; hex: string }[] | null; onChange: (c: { name: string; hex: string }) => void }) {
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

export function Swatch({ hex, name }: { hex: string; name: string }) {
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
export function FontSample({ fonts, choices, colors }: { fonts: KitFonts; choices: CatalogFont[]; colors: KitColors }) {
  return (
    <Box sx={{ p: 2, borderRadius: 'var(--r-card)', bgcolor: colors.primary.hex, color: '#fff', display: 'flex', flexDirection: 'column', gap: 0.75, overflow: 'hidden' }} aria-label="Sample">
      <Box sx={{ fontFamily: kitFontFamily(fonts.display, choices), fontWeight: 700, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.accent.hex }}>Coming up</Box>
      <Box sx={{ fontFamily: kitFontFamily(fonts.display, choices), fontWeight: 800, fontSize: 30, lineHeight: 1.05 }}>
        Something worth{' '}
        <Box component="span" sx={{ fontFamily: fonts.accent ? kitFontFamily(fonts.accent, choices) : undefined, color: colors.accent.hex, fontStyle: fonts.accent ? 'normal' : 'italic' }}>
          sharing
        </Box>
      </Box>
      <Box sx={{ fontFamily: kitFontFamily(fonts.text, choices), fontSize: 15, lineHeight: 1.45, opacity: 0.92 }}>This is how your headlines and text look together on a poster.</Box>
    </Box>
  );
}

export function RulesEditor({ rules, onChange }: { rules: KitRule[]; onChange: (rules: KitRule[]) => void }) {
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
