import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem,
  TextField, Typography
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Image as ImageIcon, TextFields as TextIcon } from '@mui/icons-material';
import { hubAssetUrl, PosterLayerImage, PosterLayerText, StructuredPoster } from '../../services/api';
import type { HubSlot } from './types';

const PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: 'Square 1080 × 1080', width: 1080, height: 1080 },
  { label: 'Portrait 1080 × 1350', width: 1080, height: 1350 },
  { label: 'Story 1080 × 1920', width: 1080, height: 1920 },
  { label: 'Landscape 1200 × 628', width: 1200, height: 628 }
];

type EditableLayer = (PosterLayerImage | PosterLayerText) & { key: number };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Slots of the project; only those holding an image can be used as image layers. */
  slots: HubSlot[];
  /** Start from an existing version's data ("edit as new version"). */
  initial?: StructuredPoster | null;
  onSubmit: (poster: StructuredPoster) => Promise<void>;
}

/** Fields editable on either kind of layer (the `type` discriminant is never patched). */
type LayerPatch = Partial<Omit<PosterLayerImage, 'type'> & Omit<PosterLayerText, 'type'>>;

let layerKey = 0;
const withKey = (l: PosterLayerImage | PosterLayerText): EditableLayer => ({ ...l, key: ++layerKey });

const num = (v: string) => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

/**
 * Builds the structured poster data the hub renders server-side (sharp) into a PNG.
 * The preview below is only an approximation of the final render.
 */
export default function PosterComposer({ open, onClose, slots, initial, onSubmit }: Props) {
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [background, setBackground] = useState('#ffffff');
  const [layers, setLayers] = useState<EditableLayer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const wasOpen = useRef(false);

  const imageSlots = useMemo(() => slots.filter((s) => s.assetId), [slots]);

  // Reset whenever the dialog opens.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setWidth(initial?.width ?? 1080);
      setHeight(initial?.height ?? 1080);
      setBackground(initial?.background ?? '#ffffff');
      setLayers((initial?.layers ?? []).map(withKey));
      setError('');
    }
    wasOpen.current = open;
  }, [open, initial]);

  const update = (key: number, patch: LayerPatch) =>
    setLayers((ls) => ls.map((l) => (l.key === key ? ({ ...l, ...patch } as EditableLayer) : l)));

  const addImage = () => {
    const first = imageSlots[0];
    setLayers((ls) => [
      ...ls,
      withKey({ type: 'image', assetId: first?.assetId?._id ?? '', x: 0, y: 0, width: Math.round(width / 2), height: Math.round(height / 2) })
    ]);
  };
  const addText = () =>
    setLayers((ls) => [...ls, withKey({ type: 'text', text: 'Your text', fontSize: 64, color: '#000000', x: 60, y: 120 })]);

  const submit = async () => {
    setError('');
    if (layers.some((l) => l.type === 'image' && !l.assetId)) {
      setError('Every image layer needs an uploaded image — upload one to a slot first.');
      return;
    }
    const poster: StructuredPoster = {
      width,
      height,
      background,
      layers: layers.map(({ key: _key, ...layer }) => layer)
    };
    try {
      setSaving(true);
      await onSubmit(poster);
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Could not render the poster');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="md">
      <DialogTitle>Compose a poster version</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 280px' }, alignItems: 'start' }}>
          {/* ---- Controls ---- */}
          <Box>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2, mt: 0.5 }}>
              <TextField
                select size="small" label="Size preset" value=""
                onChange={(e) => {
                  const p = PRESETS[Number(e.target.value)];
                  if (p) { setWidth(p.width); setHeight(p.height); }
                }}
                sx={{ minWidth: 200 }}
              >
                {PRESETS.map((p, i) => <MenuItem key={p.label} value={i}>{p.label}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Width" type="number" value={width} onChange={(e) => setWidth(num(e.target.value))} sx={{ width: 100 }} />
              <TextField size="small" label="Height" type="number" value={height} onChange={(e) => setHeight(num(e.target.value))} sx={{ width: 100 }} />
              <TextField size="small" label="Background" value={background} onChange={(e) => setBackground(e.target.value)} sx={{ width: 120 }} />
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button size="small" startIcon={<ImageIcon />} onClick={addImage} disabled={imageSlots.length === 0}>Add image</Button>
              <Button size="small" startIcon={<TextIcon />} onClick={addText}>Add text</Button>
              <Typography variant="caption" sx={{ alignSelf: 'center', color: 'text.secondary' }}>
                {imageSlots.length === 0 ? 'Upload an image to a slot to use it here.' : 'Layers are drawn bottom to top.'}
              </Typography>
            </Box>

            {layers.length === 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-ctl)' }}>
                No layers yet.
              </Typography>
            )}

            {layers.map((l, index) => (
              <Box key={l.key} sx={{ p: 1.5, mb: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-raised)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ flex: 1 }}>{index + 1}. {l.type === 'image' ? 'Image' : 'Text'}</Typography>
                  <IconButton size="small" aria-label="Remove layer" onClick={() => setLayers((ls) => ls.filter((x) => x.key !== l.key))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>

                {l.type === 'image' ? (
                  <TextField select fullWidth size="small" label="Slot image" value={l.assetId} onChange={(e) => update(l.key, { assetId: e.target.value })} sx={{ mb: 1 }}>
                    {imageSlots.map((s) => <MenuItem key={s._id} value={s.assetId!._id}>{s.name} — {s.assetId!.originalFileName}</MenuItem>)}
                  </TextField>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                    <TextField size="small" label="Text" value={l.text} onChange={(e) => update(l.key, { text: e.target.value })} sx={{ flex: '1 1 180px' }} inputProps={{ maxLength: 500 }} />
                    <TextField size="small" label="Size" type="number" value={l.fontSize ?? 32} onChange={(e) => update(l.key, { fontSize: num(e.target.value) })} sx={{ width: 80 }} />
                    <TextField size="small" label="Colour" value={l.color ?? '#000000'} onChange={(e) => update(l.key, { color: e.target.value })} sx={{ width: 110 }} />
                  </Box>
                )}

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <TextField size="small" label="X" type="number" value={l.x} onChange={(e) => update(l.key, { x: num(e.target.value) })} sx={{ width: 90 }} />
                  <TextField size="small" label="Y" type="number" value={l.y} onChange={(e) => update(l.key, { y: num(e.target.value) })} sx={{ width: 90 }} />
                  {l.type === 'image' && (
                    <>
                      <TextField size="small" label="Width" type="number" value={l.width} onChange={(e) => update(l.key, { width: num(e.target.value) })} sx={{ width: 90 }} />
                      <TextField size="small" label="Height" type="number" value={l.height} onChange={(e) => update(l.key, { height: num(e.target.value) })} sx={{ width: 90 }} />
                    </>
                  )}
                </Box>
              </Box>
            ))}
          </Box>

          {/* ---- Preview (scaled approximation) ---- */}
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Preview ({width} × {height})</Typography>
            <Box
              sx={{
                position: 'relative', width: '100%', mt: 0.5, overflow: 'hidden',
                border: '1px solid var(--border-strong)', borderRadius: 'var(--r-nav)',
                bgcolor: background, containerType: 'inline-size',
                aspectRatio: `${Math.max(width, 1)} / ${Math.max(height, 1)}`
              }}
            >
              {layers.map((l) =>
                l.type === 'image' ? (
                  l.assetId && (
                    <Box
                      key={l.key} component="img" src={hubAssetUrl(l.assetId)} alt=""
                      sx={{
                        position: 'absolute', objectFit: 'cover',
                        left: `${(l.x / width) * 100}%`, top: `${(l.y / height) * 100}%`,
                        width: `${(l.width / width) * 100}%`, height: `${(l.height / height) * 100}%`
                      }}
                    />
                  )
                ) : (
                  <Box
                    key={l.key}
                    sx={{
                      position: 'absolute', whiteSpace: 'pre', lineHeight: 1, color: l.color || '#000',
                      left: `${(l.x / width) * 100}%`,
                      top: `${((l.y - (l.fontSize ?? 32) * 0.85) / height) * 100}%`,
                      fontSize: `${((l.fontSize ?? 32) / width) * 100}cqw`,
                      fontFamily: l.font || 'sans-serif'
                    }}
                  >
                    {l.text}
                  </Box>
                )
              )}
            </Box>
          </Box>
        </Box>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" startIcon={<AddIcon />} onClick={submit} disabled={saving}>
          {saving ? 'Rendering…' : 'Render new version'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
