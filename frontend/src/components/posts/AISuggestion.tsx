import { useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Typography } from '@mui/material';
import {
  AutoAwesome as AIIcon,
  ArrowDropDown as MoreIcon,
  Close as CloseIcon,
  ShortText as ShorterIcon,
  EmojiEmotions as PlayfulIcon,
  BusinessCenter as ProIcon,
  Spellcheck as FixIcon,
  Campaign as CtaIcon,
  Tag as TagIcon
} from '@mui/icons-material';
import { taskAPI, type CaptionStyle } from '../../services/api';
import { errorMessage } from '../../store/toastStore';

/**
 * AI writing help on a post. Nothing changes until you choose "Use this": the old and new text are
 * shown side by side, and the suggestion can be tweaked first.
 */

interface SuggestState {
  title: string;
  original: string;
  loading: boolean;
  suggestion: string;
  error: string | null;
  retry: () => void;
}

export function AISuggestDialog({ state, onUse, onClose }: { state: SuggestState | null; onUse: (text: string) => void; onClose: () => void }) {
  const [edited, setEdited] = useState<string | null>(null);
  const open = Boolean(state);
  const value = edited ?? state?.suggestion ?? '';
  const close = () => {
    setEdited(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: 'var(--bg-panel)', backgroundImage: 'none' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <AIIcon sx={{ fontSize: 20, color: 'var(--accent-violet-fg, #7950f2)' }} />
        <Box sx={{ flex: 1 }}>{state?.title}</Box>
        <IconButton size="small" aria-label="Close" onClick={close}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', mb: 0.75 }}>Now</Typography>
            <Box sx={{ p: 1.5, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14, minHeight: 120, color: state?.original ? 'var(--text)' : 'var(--text-faint)' }}>
              {state?.original || 'Empty'}
            </Box>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', mb: 0.75 }}>Suggestion (you can edit it)</Typography>
            {state?.loading ? (
              <Box sx={{ minHeight: 120, display: 'grid', placeItems: 'center', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-ctl)', color: 'var(--text-muted)', fontSize: 14 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} /> Writing…
                </Box>
              </Box>
            ) : state?.error ? (
              <Box sx={{ minHeight: 120, p: 1.5, borderRadius: 'var(--r-ctl)', border: '1px solid var(--danger-text)', color: 'var(--danger-text)', fontSize: 14 }}>{state.error}</Box>
            ) : (
              <TextField value={value} onChange={(e) => setEdited(e.target.value)} multiline minRows={5} fullWidth inputProps={{ 'aria-label': 'Suggestion' }} />
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close}>Keep mine</Button>
        <Button
          onClick={() => {
            setEdited(null);
            state?.retry();
          }}
          disabled={state?.loading}
        >
          Try again
        </Button>
        <Button
          variant="contained"
          disabled={state?.loading || Boolean(state?.error) || !value.trim()}
          onClick={() => {
            onUse(value.trim());
            close();
          }}
        >
          Use this
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const CAPTION_OPTIONS: { style: CaptionStyle; label: string; icon: JSX.Element; group?: string }[] = [
  { style: 'improve', label: 'Improve', icon: <AIIcon fontSize="small" /> },
  { style: 'shorter', label: 'Shorter', icon: <ShorterIcon fontSize="small" /> },
  { style: 'playful', label: 'More playful', icon: <PlayfulIcon fontSize="small" /> },
  { style: 'professional', label: 'More professional', icon: <ProIcon fontSize="small" /> },
  { style: 'fix', label: 'Fix spelling and grammar', icon: <FixIcon fontSize="small" /> },
  { style: 'cta', label: 'Add a call to action', icon: <CtaIcon fontSize="small" /> },
  { style: 'hashtags', label: 'Add hashtags', icon: <TagIcon fontSize="small" /> },
  { style: 'instagram', label: 'Fit for Instagram', icon: <span style={{ width: 20, textAlign: 'center' }}>IG</span>, group: 'fit' },
  { style: 'linkedin', label: 'Fit for LinkedIn', icon: <span style={{ width: 20, textAlign: 'center' }}>in</span>, group: 'fit' },
  { style: 'x', label: 'Fit for X (280 characters)', icon: <span style={{ width: 20, textAlign: 'center' }}>X</span>, group: 'fit' }
];

/**
 * "Improve caption" (or "Write caption" when it's empty) with a menu of options. Works on the
 * caption as currently typed (saved or not).
 */
export function ImproveCaptionButton({
  taskId,
  caption,
  brief,
  onUse,
  size = 'small'
}: {
  taskId: string;
  caption: string;
  brief: string;
  onUse: (text: string) => void;
  size?: 'small' | 'medium';
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<SuggestState | null>(null);
  const empty = !caption.trim();

  const run = (style: CaptionStyle, label: string) => {
    const go = async () => {
      setState({ title: empty ? 'Write caption' : `Improve caption · ${label}`, original: caption, loading: true, suggestion: '', error: null, retry: go });
      try {
        const res = await taskAPI.improveCaption(taskId, { style, caption, brief });
        setState((s) => (s ? { ...s, loading: false, suggestion: res.data.suggestion } : s));
      } catch (error) {
        setState((s) => (s ? { ...s, loading: false, error: errorMessage(error, 'Couldn’t improve the caption. Try again.') } : s));
      }
    };
    go();
  };

  return (
    <>
      <Box sx={{ display: 'inline-flex' }}>
        <Button
          size={size}
          startIcon={<AIIcon />}
          onClick={() => run(empty ? 'write' : 'improve', 'Improve')}
          sx={{ borderTopRightRadius: empty ? undefined : 0, borderBottomRightRadius: empty ? undefined : 0 }}
        >
          {empty ? 'Write caption with AI' : 'Improve caption'}
        </Button>
        {!empty && (
          <Button size={size} aria-label="More ways to improve the caption" onClick={(e) => setAnchor(e.currentTarget)} sx={{ minWidth: 0, px: 0.5, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
            <MoreIcon />
          </Button>
        )}
      </Box>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {CAPTION_OPTIONS.map((o, i) => [
          o.group === 'fit' && CAPTION_OPTIONS[i - 1]?.group !== 'fit' ? <Divider key={`d-${o.style}`} /> : null,
          <MenuItem
            key={o.style}
            onClick={() => {
              setAnchor(null);
              run(o.style, o.label);
            }}
          >
            <ListItemIcon sx={{ fontSize: 12, fontWeight: 700 }}>{o.icon}</ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: 14 }}>{o.label}</ListItemText>
          </MenuItem>
        ])}
      </Menu>
      <AISuggestDialog state={state} onUse={onUse} onClose={() => setState(null)} />
    </>
  );
}

/** "Improve brief" (secondary): rewrites the brief so the visual and the caption are clear. */
export function ImproveBriefButton({ taskId, brief, caption, onUse }: { taskId: string; brief: string; caption: string; onUse: (text: string) => void }) {
  const [state, setState] = useState<SuggestState | null>(null);
  const run = () => {
    const go = async () => {
      setState({ title: 'Improve brief', original: brief, loading: true, suggestion: '', error: null, retry: go });
      try {
        const res = await taskAPI.refineDescription(taskId, { brief, caption });
        setState((s) => (s ? { ...s, loading: false, suggestion: res.data.refinedDescription } : s));
      } catch (error) {
        setState((s) => (s ? { ...s, loading: false, error: errorMessage(error, 'Couldn’t improve the brief. Try again.') } : s));
      }
    };
    go();
  };
  return (
    <>
      <Button size="small" startIcon={<AIIcon />} onClick={run} sx={{ color: 'var(--text-muted)' }}>
        Improve brief
      </Button>
      <AISuggestDialog state={state} onUse={onUse} onClose={() => setState(null)} />
    </>
  );
}
