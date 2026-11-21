import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { Box, Button, CircularProgress, IconButton, ListItemText, Menu, MenuItem, Switch, TextField, Tooltip, Typography } from '@mui/material';
import {
  Add as AddIcon,
  Close as RemoveIcon,
  TextIncrease as BiggerIcon,
  TextDecrease as SmallerIcon,
  SwapHoriz as SwapIcon,
  AspectRatio as ShapeIcon,
  PhotoSizeSelectLarge as SizesIcon,
  ZoomIn as CloserIcon,
  ZoomOut as WiderIcon,
  OpenWith as MoveIcon,
  Gradient as FadeIcon,
  CropFree as FrameIcon,
  Palette as WashIcon,
  PhotoLibraryOutlined as SwapPhotoIcon,
  Accessibility as BreakoutIcon,
  PrintOutlined as PrintIcon,
  AutoAwesome as AIIcon,
  Event as DateIcon,
  Schedule as TimeIcon,
  PlaceOutlined as PlaceIcon,
  PhoneOutlined as PhoneIcon,
  Language as WebIcon,
  InfoOutlined as InfoIcon
} from '@mui/icons-material';
import { designAPI, POSTER_FORMATS, type DesignCatalog, type PhotoFrameShape, type PosterEditBody, type PosterTextEdits, type QuickOp, type SceneSummary } from '../../services/design';
import { errorMessage, notify } from '../../store/toastStore';
import type { DetailKind, PostAIDraft, PostDesign, PosterField, PosterText } from '../../types';

/**
 * Changing a designed poster. Each change re-renders the poster from its document in a few seconds
 * and arrives as a new version next to the one you changed, so nothing is ever lost:
 * - the words, typed straight in (no AI): every line, the details and the date badge
 * - one-tap changes (no AI): headline size, swap colours, another shape, and the photo: closer,
 *   wider, moved, faded, framed in another shape, a colour wash, people over the frame, another photo
 * - a change described in a sentence (a quick AI turns it into the same kind of changes)
 * - print files (A4, A3) with sharp text at any size
 */

const FIELD_LABEL: Record<PosterField, string> = {
  eyebrow: 'Small line above the headline',
  headline: 'Headline',
  subhead: 'Line under the headline',
  body: 'Text',
  cta: 'Call to action',
  footnote: 'Small print',
  hashtag: 'Hashtag',
  sponsorsTitle: 'Above the partner logos',
  personLabel: 'Their part (e.g. Guest speaker)',
  personName: 'Name',
  personRole: 'Role',
  social: 'Handle',
  web: 'Website'
};

const DETAIL_KINDS: { kind: DetailKind; label: string; icon: typeof DateIcon }[] = [
  { kind: 'date', label: 'Date', icon: DateIcon },
  { kind: 'time', label: 'Time', icon: TimeIcon },
  { kind: 'place', label: 'Place', icon: PlaceIcon },
  { kind: 'phone', label: 'Phone', icon: PhoneIcon },
  { kind: 'web', label: 'Website', icon: WebIcon },
  { kind: 'info', label: 'Other', icon: InfoIcon }
];

const MAX_DETAILS = 4;

type Words = {
  fields: Partial<Record<PosterField, string>>;
  details: { kind: DetailKind; text: string }[];
  stats: { value: string; label: string }[];
  badge: { on: boolean; top: string; main: string; bottom: string };
};
const MAX_STATS = 3;

function wordsOf(text: PosterText): Words {
  const fields: Partial<Record<PosterField, string>> = {};
  for (const f of Object.keys(FIELD_LABEL) as PosterField[]) fields[f] = text[f] || '';
  return {
    fields,
    details: (text.details || []).map((d) => ({ ...d })),
    stats: (text.stats || []).map((s) => ({ ...s })),
    badge: { on: Boolean(text.badge?.main), top: text.badge?.top || '', main: text.badge?.main || '', bottom: text.badge?.bottom || '' }
  };
}

export interface PosterEditorProps {
  taskId: string;
  /** "current" (the post's picture) or the draft's id. */
  posterRef: string;
  design: PostDesign;
  catalog: DesignCatalog | null;
  /** A line tapped on the picture: focus its box. */
  focus: { field: string; at: number } | null;
  /** A new version was made. */
  onDraft: (draft: PostAIDraft, message: string) => void;
  /** The post's own pictures, to swap into the poster. */
  photos?: { url: string; label?: string }[];
}

const SCENE_FIELDS: Record<string, PosterField[]> = { eyebrow: ['eyebrow'], headline: ['headline'], subhead: ['subhead'], cta: ['cta'], contact: ['social', 'web'] };
const FRAME_SHAPES: { shape: PhotoFrameShape; label: string }[] = [
  { shape: 'rect', label: 'Straight edges' },
  { shape: 'rounded', label: 'Rounded corners' },
  { shape: 'circle', label: 'Circle' },
  { shape: 'arch', label: 'Arch' },
  { shape: 'slant-left', label: 'Slanted left side' },
  { shape: 'slant-right', label: 'Slanted right side' },
  { shape: 'blob', label: 'Soft organic' }
];
const FADES: { side: 'none' | 'bottom' | 'top' | 'left' | 'right' | 'edges'; label: string }[] = [
  { side: 'none', label: 'No fade' },
  { side: 'bottom', label: 'Fade at the bottom' },
  { side: 'top', label: 'Fade at the top' },
  { side: 'left', label: 'Fade on the left' },
  { side: 'right', label: 'Fade on the right' },
  { side: 'edges', label: 'Fade all round' }
];
const WASHES: { color: 'none' | 'primary' | 'secondary' | 'accent'; mode?: 'tint' | 'duotone'; label: string }[] = [
  { color: 'none', label: 'No colour wash' },
  { color: 'primary', mode: 'tint', label: 'Main brand colour' },
  { color: 'secondary', mode: 'tint', label: 'Second brand colour' },
  { color: 'accent', mode: 'tint', label: 'Accent colour' },
  { color: 'primary', mode: 'duotone', label: 'Duotone in the main colour' }
];

export default function PosterEditor({ taskId, posterRef, design, focus, onDraft, photos = [] }: PosterEditorProps) {
  const doc = design.doc;
  const scene = (doc as { scene?: SceneSummary }).scene;
  // The fields this poster shows: its scene's word layers (older posters: the words they have).
  const shown = useMemo(() => {
    const names = new Set<keyof PosterText>();
    if (scene) {
      for (const l of scene.layers) {
        if (l.type === 'text' && l.role) {
          if (l.role === 'details' || l.role === 'badge') names.add(l.role);
          else for (const f of SCENE_FIELDS[l.role] || []) names.add(f);
        }
        if (l.type === 'partners') names.add('sponsorsTitle');
      }
      // Words can be added even where the poster has none yet (a line is made for them).
      for (const f of ['eyebrow', 'subhead', 'cta', 'details'] as (keyof PosterText)[]) names.add(f);
    } else for (const k of Object.keys(doc.text)) names.add(k as keyof PosterText);
    return names;
  }, [scene, doc.text]);
  const maxOf = (name: string) => (name === 'headline' ? 90 : name === 'subhead' ? 200 : 60);
  const photoLayers = (scene?.layers || []).filter((l) => l.type === 'photo');
  const [photoLayer, setPhotoLayer] = useState<string | undefined>(undefined);
  const photoOn = photoLayers.find((l) => l.id === photoLayer) || photoLayers[0];
  const [menu, setMenu] = useState<{ kind: 'fade' | 'frame' | 'wash' | 'swap' | 'move'; anchor: HTMLElement } | null>(null);

  const original = useMemo(() => wordsOf(doc.text), [doc.text]);
  const [words, setWords] = useState<Words>(original);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [shapeAnchor, setShapeAnchor] = useState<HTMLElement | null>(null);
  const [sizes, setSizes] = useState<{ sizes: { format: string; url: string }[]; skipped: { format: string; reason: string }[] } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Another poster shown: its words.
  useEffect(() => {
    setWords(original);
    setReply(null);
    setSizes(null);
  }, [original]);

  const allSizes = async () => {
    setBusy('sizes');
    try {
      setSizes(await designAPI.sizes(taskId, posterRef));
    } catch (e) {
      notify(errorMessage(e, 'The other sizes couldn’t be made.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // A line tapped on the picture.
  useEffect(() => {
    if (!focus) return;
    const id = focus.field === 'details' ? 'poster-detail-0' : focus.field === 'stats' ? 'poster-stat-0' : focus.field === 'badge' ? 'poster-badge-main' : `poster-field-${focus.field}`;
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
      el.select?.();
    } else if (focus.field === 'details') {
      setWords((w) => ({ ...w, details: [{ kind: 'date', text: '' }] }));
    }
  }, [focus]);

  // What changed, as the server wants it.
  const edits = useMemo<PosterTextEdits | null>(() => {
    const out: PosterTextEdits = {};
    for (const f of Object.keys(FIELD_LABEL) as PosterField[]) {
      if (!shown.has(f)) continue;
      const now = (words.fields[f] || '').trim();
      if (now !== (original.fields[f] || '').trim()) out[f] = now || null;
    }
    const details = words.details.filter((d) => d.text.trim()).map((d) => ({ kind: d.kind, text: d.text.trim() }));
    if (JSON.stringify(details) !== JSON.stringify(original.details.map((d) => ({ kind: d.kind, text: d.text.trim() })))) out.details = details;
    const stats = words.stats.filter((s) => s.value.trim()).map((s) => ({ value: s.value.trim(), label: s.label.trim() }));
    if (JSON.stringify(stats) !== JSON.stringify(original.stats.map((s) => ({ value: s.value.trim(), label: s.label.trim() })))) out.stats = stats;
    const b = words.badge;
    const ob = original.badge;
    if (b.on !== ob.on || (b.on && (b.top !== ob.top || b.main !== ob.main || b.bottom !== ob.bottom))) {
      out.badge = b.on && b.main.trim() ? { top: b.top.trim() || undefined, main: b.main.trim(), bottom: b.bottom.trim() || undefined } : null;
    }
    return Object.keys(out).length ? out : null;
  }, [words, original, shown]);
  const headlineEmpty = shown.has('headline') && !(words.fields.headline || '').trim();

  const send = async (key: string, body: PosterEditBody, done: string) => {
    setBusy(key);
    setReply(null);
    try {
      const answer = await designAPI.edit(taskId, posterRef, body);
      if (answer.draft) onDraft(answer.draft, done);
      else setReply(answer.refused || answer.reply);
      if (answer.draft && body.request) setRequest('');
    } catch (e) {
      notify(errorMessage(e, 'The poster couldn’t be changed.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const quick = (key: string, op: QuickOp, done: string) => send(key, { ops: [op] }, done);

  const print = async (size: 'a4' | 'a3') => {
    const cached = size === 'a4' ? design.pdf_a4 : design.pdf_a3;
    if (cached) return void window.open(cached, '_blank', 'noopener');
    // Open the tab now (browsers block it after a wait), then point it at the file.
    const tab = window.open('', '_blank');
    setBusy(`print:${size}`);
    try {
      const url = await designAPI.print(taskId, posterRef, size);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      tab?.close();
      notify(errorMessage(e, 'The print file couldn’t be made.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const setField = (f: PosterField, v: string) => setWords((w) => ({ ...w, fields: { ...w.fields, [f]: v } }));
  const setDetail = (i: number, patch: Partial<{ kind: DetailKind; text: string }>) => setWords((w) => ({ ...w, details: w.details.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const formats = POSTER_FORMATS.filter((f) => f.value !== doc.format);
  const printable = Boolean(scene);
  const layer = photoOn?.id;
  const photoQuick = (key: string, op: QuickOp, done: string) => quick(key, op, done);
  const scale = doc.tweaks?.headlineScale || 1;
  const warnings = (design.issues || []).filter((i) => i.level === 'warning');

  return (
    <Box sx={{ mt: 1.5, p: 1.75, borderRadius: 'var(--r-card)', border: '1px solid var(--border)', bgcolor: 'var(--bg-raised)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {(design.note || warnings.length > 0) && (
        <Box sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {design.note && <Box>{design.note}</Box>}
          {warnings.map((w) => (
            <Box key={w.code + w.message} sx={{ color: 'var(--warning-text, #b45309)' }}>
              Worth a look: {w.message}
            </Box>
          ))}
        </Box>
      )}

      {/* One tap */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        <QuickButton icon={<BiggerIcon />} busy={busy === 'bigger'} disabled={Boolean(busy) || scale >= 1.29} onClick={() => quick('bigger', { op: 'headline_size', scale: 1.12 }, 'Bigger headline ready')}>
          Bigger headline
        </QuickButton>
        <QuickButton icon={<SmallerIcon />} busy={busy === 'smaller'} disabled={Boolean(busy) || scale <= 0.76} onClick={() => quick('smaller', { op: 'headline_size', scale: 0.88 }, 'Smaller headline ready')}>
          Smaller
        </QuickButton>
        <QuickButton icon={<SwapIcon />} busy={busy === 'swap'} disabled={Boolean(busy)} onClick={() => quick('swap', { op: 'swap_colours' }, 'Colours swapped')}>
          Swap colours
        </QuickButton>
        {formats.length > 0 && (
          <QuickButton icon={<ShapeIcon />} busy={busy === 'shape'} disabled={Boolean(busy)} onClick={(e) => setShapeAnchor(e.currentTarget)}>
            Another shape
          </QuickButton>
        )}
        <QuickButton icon={<SizesIcon />} busy={busy === 'sizes'} disabled={Boolean(busy)} onClick={allSizes}>
          All sizes
        </QuickButton>
        {printable && (
          <QuickButton icon={<PrintIcon />} busy={busy === 'print:a4'} disabled={Boolean(busy)} onClick={() => print('a4')}>
            Print file (A4)
          </QuickButton>
        )}
        {printable && (
          <QuickButton icon={<PrintIcon />} busy={busy === 'print:a3'} disabled={Boolean(busy)} onClick={() => print('a3')}>
            A3
          </QuickButton>
        )}
        <Menu anchorEl={shapeAnchor} open={Boolean(shapeAnchor)} onClose={() => setShapeAnchor(null)}>
          {formats.map((f) => (
            <MenuItem
              key={f.value}
              onClick={() => {
                setShapeAnchor(null);
                quick('shape', { op: 'change_format', format: f.value }, `${f.label} version ready`);
              }}
            >
              <Box aria-hidden sx={{ width: 13, aspectRatio: f.ratio, border: '1.5px solid currentColor', borderRadius: '2px', mr: 1.25 }} />
              <ListItemText primary={f.label} secondary={f.hint} />
            </MenuItem>
          ))}
        </Menu>

      </Box>

      {/* The photo */}
      {photoOn && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>The photo</Typography>
            {photoLayers.length > 1 && (
              <TextField select size="small" value={photoOn.id} onChange={(e) => setPhotoLayer(e.target.value)} inputProps={{ 'aria-label': 'Which photo' }} sx={{ minWidth: 120 }}>
                {photoLayers.map((l, i) => (
                  <MenuItem key={l.id} value={l.id}>
                    Photo {i + 1}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            <QuickButton icon={<CloserIcon />} busy={busy === 'closer'} disabled={Boolean(busy)} onClick={() => photoQuick('closer', { op: 'photo_zoom', layer, scale: 1.2 }, 'Closer photo ready')}>
              Closer
            </QuickButton>
            <QuickButton icon={<WiderIcon />} busy={busy === 'wider'} disabled={Boolean(busy)} onClick={() => photoQuick('wider', { op: 'photo_zoom', layer, scale: 0.84 }, 'Wider photo ready')}>
              Show more
            </QuickButton>
            <QuickButton icon={<MoveIcon />} busy={busy === 'move'} disabled={Boolean(busy)} onClick={(e) => setMenu({ kind: 'move', anchor: e.currentTarget })}>
              Move
            </QuickButton>
            <QuickButton icon={<FadeIcon />} busy={busy === 'fade'} disabled={Boolean(busy)} onClick={(e) => setMenu({ kind: 'fade', anchor: e.currentTarget })}>
              Fade
            </QuickButton>
            <QuickButton icon={<FrameIcon />} busy={busy === 'frame'} disabled={Boolean(busy)} onClick={(e) => setMenu({ kind: 'frame', anchor: e.currentTarget })}>
              Frame shape
            </QuickButton>
            <QuickButton icon={<WashIcon />} busy={busy === 'wash'} disabled={Boolean(busy)} onClick={(e) => setMenu({ kind: 'wash', anchor: e.currentTarget })}>
              Colour wash
            </QuickButton>
            <QuickButton icon={<BreakoutIcon />} busy={busy === 'breakout'} disabled={Boolean(busy)} onClick={() => photoQuick('breakout', { op: 'photo_breakout', layer, on: !photoOn.breakout }, photoOn.breakout ? 'People back inside the frame' : 'People over the frame ready')}>
              {photoOn.breakout ? 'People inside the frame' : 'People over the frame'}
            </QuickButton>
            {photos.length > 0 && (
              <QuickButton icon={<SwapPhotoIcon />} busy={busy === 'swap-photo'} disabled={Boolean(busy)} onClick={(e) => setMenu({ kind: 'swap', anchor: e.currentTarget })}>
                Another photo
              </QuickButton>
            )}
          </Box>
          <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
            {menu?.kind === 'move' &&
              ([
                ['Show more of the left', -12, 0],
                ['Show more of the right', 12, 0],
                ['Show more of the top', 0, -12],
                ['Show more of the bottom', 0, 12]
              ] as [string, number, number][]).map(([label, dx, dy]) => (
                <MenuItem key={label} onClick={() => (setMenu(null), photoQuick('move', { op: 'photo_move', layer, dx, dy }, 'Moved photo ready'))}>
                  {label}
                </MenuItem>
              ))}
            {menu?.kind === 'fade' &&
              FADES.map((f) => (
                <MenuItem key={f.side} selected={(photoOn.fade?.side || 'none') === f.side} onClick={() => (setMenu(null), photoQuick('fade', { op: 'photo_fade', layer, side: f.side, size: 30 }, 'Photo fade ready'))}>
                  {f.label}
                </MenuItem>
              ))}
            {menu?.kind === 'frame' &&
              FRAME_SHAPES.map((f) => (
                <MenuItem key={f.shape} selected={photoOn.shape === f.shape} onClick={() => (setMenu(null), photoQuick('frame', { op: 'photo_shape', layer, shape: f.shape }, 'New frame ready'))}>
                  {f.label}
                </MenuItem>
              ))}
            {menu?.kind === 'wash' &&
              WASHES.map((w) => (
                <MenuItem key={w.label} onClick={() => (setMenu(null), photoQuick('wash', { op: 'photo_tint', layer, color: w.color, mode: w.mode, amount: w.mode === 'duotone' ? 0.55 : 0.3 }, 'Colour wash ready'))}>
                  {w.label}
                </MenuItem>
              ))}
            {menu?.kind === 'swap' &&
              photos.map((p, i) => (
                <MenuItem key={p.url} onClick={() => (setMenu(null), photoQuick('swap-photo', { op: 'swap_photo', layer, url: p.url }, 'Poster with the other photo ready'))} sx={{ gap: 1.25 }}>
                  <Box component="img" src={p.url} alt="" sx={{ width: 44, height: 44, objectFit: 'cover', borderRadius: '4px' }} />
                  {p.label || `Picture ${i + 1}`}
                </MenuItem>
              ))}
          </Menu>
        </Box>
      )}

      {sizes && (
        <Box role="status" sx={{ p: 1.25, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
            {sizes.sizes.length ? 'The same poster in other sizes (open to download):' : 'No other sizes could be made.'}
          </Typography>
          {sizes.sizes.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {sizes.sizes.map((s) => {
                const f = POSTER_FORMATS.find((x) => x.value === s.format);
                return (
                  <Button key={s.format} size="small" variant="outlined" component="a" href={s.url} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>
                    {f ? `${f.label} · ${f.hint}` : s.format}
                  </Button>
                );
              })}
            </Box>
          )}
          {sizes.skipped.map((s) => (
            <Typography key={s.format} sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {POSTER_FORMATS.find((x) => x.value === s.format)?.label || s.format}: not made ({s.reason.replace(/\.$/, '')}). Try fewer words.
            </Typography>
          ))}
        </Box>
      )}

      {/* The words */}
      <Box
        component="form"
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          if (edits && !headlineEmpty) send('words', { text: edits }, 'New version with your words');
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
          The words{' '}
          <Box component="span" sx={{ fontWeight: 400, color: 'var(--text-muted)' }}>
            (or tap a line on the poster)
          </Box>
        </Typography>

        {(['eyebrow', 'headline', 'subhead', 'body'] as PosterField[])
          .filter((f) => shown.has(f))
          .map((f) => (
            <WordField key={f} field={f} value={words.fields[f] || ''} max={maxOf(f)} onChange={(v) => setField(f, v)} multiline={f !== 'eyebrow'} required={f === 'headline'} />
          ))}

        {(['personLabel', 'personName', 'personRole'] as PosterField[]).some((f) => shown.has(f)) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.25, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)' }}>
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Featured person (leave the name empty to show no one)</Typography>
            {(['personLabel', 'personName', 'personRole'] as PosterField[])
              .filter((f) => shown.has(f))
              .map((f) => (
                <WordField key={f} field={f} value={words.fields[f] || ''} max={maxOf(f)} onChange={(v) => setField(f, v)} multiline={f === 'personRole'} />
              ))}
          </Box>
        )}

        {shown.has('details') && (
          <Box>
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mb: 0.75 }}>Details</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {words.details.map((d, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                  <TextField
                    select
                    size="small"
                    value={d.kind}
                    onChange={(e) => setDetail(i, { kind: e.target.value as DetailKind })}
                    inputProps={{ 'aria-label': `Kind of detail ${i + 1}` }}
                    sx={{ width: 132, flexShrink: 0 }}
                    SelectProps={{ renderValue: (v) => DETAIL_KINDS.find((k) => k.kind === v)?.label }}
                  >
                    {DETAIL_KINDS.map(({ kind, label, icon: Icon }) => (
                      <MenuItem key={kind} value={kind}>
                        <Icon sx={{ fontSize: 18, mr: 1, color: 'var(--text-muted)' }} />
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField id={`poster-detail-${i}`} size="small" fullWidth value={d.text} onChange={(e) => setDetail(i, { text: e.target.value })} inputProps={{ maxLength: 80, 'aria-label': `Detail ${i + 1}` }} />
                  <IconButton size="small" aria-label={`Remove detail ${i + 1}`} onClick={() => setWords((w) => ({ ...w, details: w.details.filter((_, j) => j !== i) }))}>
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              {words.details.length < MAX_DETAILS && (
                <Button size="small" startIcon={<AddIcon />} onClick={() => setWords((w) => ({ ...w, details: [...w.details, { kind: w.details.some((x) => x.kind === 'date') ? (w.details.some((x) => x.kind === 'time') ? 'place' : 'time') : 'date', text: '' }] }))} sx={{ alignSelf: 'flex-start' }}>
                  Add a detail
                </Button>
              )}
            </Box>
          </Box>
        )}

        {shown.has('stats') && (
          <Box>
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mb: 0.75 }}>Figures (only real numbers: what was achieved)</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {words.stats.map((st, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                  <TextField
                    id={i === 0 ? 'poster-stat-0' : undefined}
                    size="small"
                    value={st.value}
                    placeholder="312"
                    onChange={(e) => setWords((w) => ({ ...w, stats: w.stats.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))}
                    inputProps={{ maxLength: 12, 'aria-label': `Figure ${i + 1}` }}
                    sx={{ width: 110, flexShrink: 0 }}
                  />
                  <TextField
                    size="small"
                    fullWidth
                    value={st.label}
                    placeholder="children vaccinated"
                    onChange={(e) => setWords((w) => ({ ...w, stats: w.stats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
                    inputProps={{ maxLength: 40, 'aria-label': `What figure ${i + 1} counts` }}
                  />
                  <IconButton size="small" aria-label={`Remove figure ${i + 1}`} onClick={() => setWords((w) => ({ ...w, stats: w.stats.filter((_, j) => j !== i) }))}>
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              {words.stats.length < MAX_STATS && (
                <Button size="small" startIcon={<AddIcon />} onClick={() => setWords((w) => ({ ...w, stats: [...w.stats, { value: '', label: '' }] }))} sx={{ alignSelf: 'flex-start' }}>
                  Add a figure
                </Button>
              )}
            </Box>
          </Box>
        )}

        {(['cta', 'hashtag', 'social', 'web', 'sponsorsTitle', 'footnote'] as PosterField[])
          .filter((f) => shown.has(f) && (f !== 'sponsorsTitle' || doc.sponsors.length > 0))
          .map((f) => (
            <WordField key={f} field={f} value={words.fields[f] || ''} max={maxOf(f)} onChange={(v) => setField(f, v)} />
          ))}

        {shown.has('badge') && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', flex: 1 }}>Date badge</Typography>
              <Switch size="small" checked={words.badge.on} onChange={(e) => setWords((w) => ({ ...w, badge: { ...w.badge, on: e.target.checked } }))} inputProps={{ 'aria-label': 'Show the date badge' }} />
            </Box>
            {words.badge.on && (
              <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5 }}>
                <TextField size="small" label="Top" placeholder="SAT" value={words.badge.top} onChange={(e) => setWords((w) => ({ ...w, badge: { ...w.badge, top: e.target.value } }))} inputProps={{ maxLength: 8 }} sx={{ width: 90 }} />
                <TextField id="poster-badge-main" size="small" label="Middle" placeholder="14" value={words.badge.main} onChange={(e) => setWords((w) => ({ ...w, badge: { ...w.badge, main: e.target.value } }))} inputProps={{ maxLength: 6 }} sx={{ width: 90 }} />
                <TextField size="small" label="Bottom" placeholder="DEC" value={words.badge.bottom} onChange={(e) => setWords((w) => ({ ...w, badge: { ...w.badge, bottom: e.target.value } }))} inputProps={{ maxLength: 8 }} sx={{ width: 90 }} />
              </Box>
            )}
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button type="submit" variant="contained" size="small" disabled={!edits || headlineEmpty || Boolean(busy)} startIcon={busy === 'words' ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : undefined}>
            {busy === 'words' ? 'Updating…' : 'Update the poster'}
          </Button>
          {edits && (
            <Button size="small" disabled={Boolean(busy)} onClick={() => setWords(original)} sx={{ color: 'var(--text-muted)' }}>
              Undo typing
            </Button>
          )}
          <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', ml: 'auto' }}>{headlineEmpty ? 'A poster needs a headline.' : 'Free · a few seconds · a new version appears next to this one.'}</Typography>
        </Box>
      </Box>

      {/* Described */}
      <Box>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (request.trim()) send('request', { request: request.trim() }, 'Changed poster ready');
          }}
          sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
        >
          <TextField
            size="small"
            fullWidth
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Or describe a change… e.g. “put the date first and remove the second sponsor”"
            inputProps={{ 'aria-label': 'Describe a change to the poster', maxLength: 1500 }}
            disabled={Boolean(busy)}
          />
          <Button type="submit" variant="outlined" startIcon={busy === 'request' ? <CircularProgress size={14} /> : <AIIcon />} disabled={!request.trim() || Boolean(busy)} sx={{ flexShrink: 0, height: 40 }}>
            Change
          </Button>
        </Box>
        {reply && (
          <Typography role="status" sx={{ fontSize: 13, color: 'var(--text-strong)', mt: 0.75, p: 1, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)' }}>
            {reply}
          </Typography>
        )}
        <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.5 }}>Logos always stay exactly as supplied; changes that would break your brand rules are explained instead.</Typography>
      </Box>
    </Box>
  );
}

function WordField({ field, value, max, onChange, multiline, required }: { field: PosterField; value: string; max?: number; onChange: (v: string) => void; multiline?: boolean; required?: boolean }) {
  const long = max ? value.trim().length > max : false;
  return (
    <TextField
      id={`poster-field-${field}`}
      size="small"
      fullWidth
      label={FIELD_LABEL[field]}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      multiline={multiline}
      minRows={1}
      maxRows={4}
      required={required}
      inputProps={{ maxLength: 400 }}
      helperText={long ? `Long for this design (about ${max} characters fit best). It will be set smaller.` : field === 'headline' ? 'Enter makes a line break. Put *stars* around a word to set it in the accent colour.' : undefined}
      FormHelperTextProps={{ sx: { color: long ? 'var(--warning-text, #b45309)' : undefined, mx: 0 } }}
    />
  );
}

function QuickButton({ icon, busy, disabled, onClick, children }: { icon: ReactElement; busy: boolean; disabled: boolean; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: string }) {
  return (
    <Tooltip title={busy ? 'Working…' : ''}>
      <span>
        <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : icon} disabled={disabled} onClick={onClick} sx={{ textTransform: 'none' }}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}
