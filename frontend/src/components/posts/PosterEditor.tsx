import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { Box, Button, CircularProgress, IconButton, ListItemText, Menu, MenuItem, Switch, TextField, Tooltip, Typography } from '@mui/material';
import {
  Add as AddIcon,
  Close as RemoveIcon,
  TextIncrease as BiggerIcon,
  TextDecrease as SmallerIcon,
  SwapHoriz as SwapIcon,
  AspectRatio as ShapeIcon,
  ViewQuiltOutlined as LayoutIcon,
  PrintOutlined as PrintIcon,
  AutoAwesome as AIIcon,
  Event as DateIcon,
  Schedule as TimeIcon,
  PlaceOutlined as PlaceIcon,
  PhoneOutlined as PhoneIcon,
  Language as WebIcon,
  InfoOutlined as InfoIcon
} from '@mui/icons-material';
import { designAPI, POSTER_FORMATS, type DesignCatalog, type PosterEditBody, type PosterTextEdits, type QuickOp } from '../../services/design';
import { errorMessage, notify } from '../../store/toastStore';
import type { DetailKind, PostAIDraft, PostDesign, PosterField, PosterText } from '../../types';

/**
 * Changing a designed poster. Each change re-renders the poster from its document in a few seconds
 * and arrives as a new version next to the one you changed, so nothing is ever lost:
 * - the words, typed straight in (no AI): every line, the details and the date badge
 * - one-tap changes (no AI): headline size, swap colours, another shape or layout
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
  sponsorsTitle: 'Above the partner logos'
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

type Words = { fields: Partial<Record<PosterField, string>>; details: { kind: DetailKind; text: string }[]; badge: { on: boolean; top: string; main: string; bottom: string } };

function wordsOf(text: PosterText): Words {
  const fields: Partial<Record<PosterField, string>> = {};
  for (const f of Object.keys(FIELD_LABEL) as PosterField[]) fields[f] = text[f] || '';
  return {
    fields,
    details: (text.details || []).map((d) => ({ ...d })),
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
}

export default function PosterEditor({ taskId, posterRef, design, catalog, focus, onDraft }: PosterEditorProps) {
  const doc = design.doc;
  const template = catalog?.designs.find((d) => d.id === doc.designId);
  const shown = useMemo(() => {
    const names = new Set((template?.fields || []).map((f) => f.name));
    // Without the catalogue: the fields this poster has words in.
    if (!template) for (const k of Object.keys(doc.text)) names.add(k as keyof PosterText);
    return names;
  }, [template, doc.text]);
  const maxOf = (name: string) => template?.fields.find((f) => f.name === name)?.max;

  const original = useMemo(() => wordsOf(doc.text), [doc.text]);
  const [words, setWords] = useState<Words>(original);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [shapeAnchor, setShapeAnchor] = useState<HTMLElement | null>(null);
  const [layoutAnchor, setLayoutAnchor] = useState<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Another poster shown: its words.
  useEffect(() => {
    setWords(original);
    setReply(null);
  }, [original]);

  // A line tapped on the picture.
  useEffect(() => {
    if (!focus) return;
    const id = focus.field === 'details' ? 'poster-detail-0' : focus.field === 'badge' ? 'poster-badge-main' : `poster-field-${focus.field}`;
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
  const formats = POSTER_FORMATS.filter((f) => f.value !== doc.format && (!template || template.formats.includes(f.value)));
  const layouts = (catalog?.designs || []).filter((d) => d.id !== doc.designId && d.formats.includes(doc.format) && d.photos.min <= doc.photos.length && (d.background !== 'required' || Boolean(doc.background)));
  const printable = !template || template.formats.includes('a4');
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
        {layouts.length > 0 && (
          <QuickButton icon={<LayoutIcon />} busy={busy === 'layout'} disabled={Boolean(busy)} onClick={(e) => setLayoutAnchor(e.currentTarget)}>
            Another layout
          </QuickButton>
        )}
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
        <Menu anchorEl={layoutAnchor} open={Boolean(layoutAnchor)} onClose={() => setLayoutAnchor(null)}>
          {layouts.map((d) => (
            <MenuItem
              key={d.id}
              onClick={() => {
                setLayoutAnchor(null);
                quick('layout', { op: 'switch_design', design: d.id }, `${d.name} layout ready`);
              }}
              sx={{ maxWidth: 360, whiteSpace: 'normal' }}
            >
              <ListItemText primary={d.name} secondary={d.description} />
            </MenuItem>
          ))}
        </Menu>
      </Box>

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

        {(['cta', 'hashtag', 'sponsorsTitle', 'footnote'] as PosterField[])
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
      helperText={long ? `Long for this design (about ${max} characters fit best). It will be set smaller.` : field === 'headline' ? 'Press Enter for a line break where you want it.' : undefined}
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
