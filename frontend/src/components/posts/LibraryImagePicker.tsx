import { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import { Close as CloseIcon, Search as SearchIcon, PhotoLibraryOutlined as LibraryIcon } from '@mui/icons-material';
import { libraryAPI, librarySrc, type LibraryItem } from '../../services/library';
import { errorMessage, notify } from '../../store/toastStore';
import { formatDay } from '../../lib/dates';
import EmptyState from '../ui/EmptyState';

/**
 * Pick a picture from the Library: to use as the post's picture (default), or for something else
 * (onPick, e.g. a reference picture). Pictures linked to this post's campaign are shown first;
 * type to search everything (titles, text in images, tags, events).
 */
export default function LibraryImagePicker({
  open,
  taskId,
  campaignId,
  ownerId,
  title = 'Choose from the Library',
  onClose,
  onUsed,
  onPick
}: {
  open: boolean;
  taskId: string;
  campaignId?: string;
  /** The post's account (an admin editing a client's post sees the client's Library). */
  ownerId?: string;
  title?: string;
  onClose: () => void;
  /** Default action: the picture became the post's picture. */
  onUsed?: (imageUrl: string) => void;
  /** Instead of using it on the post: do this with the chosen item (the dialog closes when it resolves). */
  onPick?: (item: LibraryItem) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [using, setUsing] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setError(null);
      try {
        const res = await libraryAPI.search({ ownerId, kind: 'image', q: q.trim() || undefined, campaignId: q.trim() ? undefined : campaignId, sort: q.trim() ? 'relevance' : 'newest', limit: 30 });
        // Nothing in this campaign yet: show the newest pictures instead.
        if (!q.trim() && campaignId && res.items.length === 0) {
          const all = await libraryAPI.search({ ownerId, kind: 'image', sort: 'newest', limit: 30 });
          if (alive) setItems(all.items);
        } else if (alive) setItems(res.items);
      } catch (e) {
        if (alive) setError(errorMessage(e, 'Couldn’t load the Library.'));
      }
    }, q ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, q, campaignId, ownerId]);

  const use = async (item: LibraryItem) => {
    setUsing(item.id);
    try {
      if (onPick) {
        await onPick(item);
      } else {
        const res = await libraryAPI.useOnPost(item.id, taskId);
        notify('Picture updated');
        onUsed?.(res.imageUrl);
      }
      onClose();
    } catch (e) {
      notify(errorMessage(e, onPick ? 'Couldn’t add this picture.' : 'Couldn’t use this picture.'), { tone: 'error' });
    } finally {
      setUsing(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: 'var(--bg-panel)', backgroundImage: 'none' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>{title}</Box>
        <IconButton size="small" aria-label="Close" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Search pictures: “cold brew picture”, “Women’s Day”…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ mb: 2 }}
        />
        {error ? (
          <Typography sx={{ color: 'var(--danger-text)', fontSize: 14 }}>{error}</Typography>
        ) : items === null ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress size={22} />
          </Box>
        ) : items.length === 0 ? (
          <EmptyState compact icon={<LibraryIcon />} title={q ? 'No pictures match' : 'No pictures in the Library yet'} text={q ? 'Try other words.' : 'Pictures you upload or create appear here.'} />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.25 }}>
            {items.map((item) => (
              <Box
                key={item.id}
                component="button"
                type="button"
                onClick={() => use(item)}
                disabled={Boolean(using)}
                title={item.title}
                sx={{
                  all: 'unset', cursor: using ? 'wait' : 'pointer', borderRadius: 'var(--r-ctl)', overflow: 'hidden', border: '1px solid var(--border)',
                  bgcolor: 'var(--bg-raised)', position: 'relative', '&:hover, &:focus-visible': { borderColor: 'var(--border-strong)', outline: '2px solid var(--border-strong)' }
                }}
              >
                <Box sx={{ aspectRatio: '1 / 1', bgcolor: 'var(--bg-subtle)' }}>
                  {item.thumbnailUrl && <img src={librarySrc(item.thumbnailUrl)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </Box>
                <Box sx={{ p: 0.75 }}>
                  <Typography noWrap sx={{ fontSize: 12.5, color: 'var(--text-strong)' }}>{item.title}</Typography>
                  <Typography noWrap sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{formatDay(item.capturedAt || item.createdAt, { weekday: false })}</Typography>
                </Box>
                {using === item.id && (
                  <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: 'rgba(0,0,0,.35)' }}>
                    <CircularProgress size={22} sx={{ color: '#fff' }} />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
