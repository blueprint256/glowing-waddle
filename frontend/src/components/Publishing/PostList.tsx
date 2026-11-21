import { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, TextField, Tooltip, Typography } from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  OpenInNew as OpenIcon,
  Replay as RetryIcon,
  Close as CancelIcon,
  DeleteOutline as DeleteIcon,
  CheckCircleOutline as DoneIcon
} from '@mui/icons-material';
import { publishingAPI, PLATFORM_COLORS, type Post, type PlatformId } from '../../services/publishing';
import { MetaChip } from '../ui/StatusChip';
import { publishStatusMeta } from '../../lib/status';
import { formatDateTime } from '../../lib/dates';
import { errorMessage } from '../../store/toastStore';
import { useOpenPost } from '../posts/PostPanelHost';

export function PlatformBadge({ platform, size = 28 }: { platform: PlatformId; size?: number }) {
  const label = platform === 'x' ? 'X' : platform === 'linkedin' ? 'in' : platform === 'youtube' ? 'YT' : platform === 'tiktok' ? 'TT' : platform === 'instagram' ? 'IG' : 'f';
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.42, fontWeight: 700, bgcolor: PLATFORM_COLORS[platform], color: '#fff' }} aria-hidden>
      {label}
    </Avatar>
  );
}

/** "Scheduled to Instagram · Fri 21 Nov · 09:00" (decision 11). */
export function whenLine(p: Post): string {
  const to = `${p.platformName}${p.channel?.name ? ` (${p.channel.name})` : ''}`;
  const at = (iso?: string | null) => (iso ? ` · ${formatDateTime(iso)}` : '');
  switch (p.status) {
    case 'published':
      return `Published to ${to}${at(p.publishedAt || p.scheduledAt)}`;
    case 'scheduled':
      return p.mode === 'manual' ? `Reminder to post on ${to} by hand${at(p.scheduledAt)}` : `Scheduled to ${to}${at(p.scheduledAt)}`;
    case 'publishing':
    case 'processing':
      return `Going out to ${to} now`;
    case 'due':
      return `Post on ${to} by hand${at(p.scheduledAt)}`;
    case 'failed':
      return `Didn’t go out to ${to}${at(p.scheduledAt)}`;
    case 'cancelled':
      return `Cancelled for ${to}${at(p.scheduledAt)}`;
    default:
      return `Draft for ${to}${at(p.scheduledAt)}`;
  }
}

interface Props {
  posts: Post[];
  /** After an action: a message to show, and the copy it was about. */
  onChanged: (message?: string, post?: Post) => void;
  /** Show which post it belongs to (off inside the post itself). */
  showTask?: boolean;
  emptyText?: string;
  /** An item to point out (Publishing's ?item=). */
  highlight?: string | null;
}

/** Scheduled and published copies of posts, with the actions that make sense for each. */
export default function PostList({ posts, onChanged, showTask = true, emptyText = 'Nothing here yet.', highlight }: Props) {
  const openPost = useOpenPost();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<Post | null>(null);
  const [cancelling, setCancelling] = useState<Post | null>(null);
  const [link, setLink] = useState('');
  const highlighted = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (highlight && highlighted.current) highlighted.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, posts]);

  const act = async (post: Post, fn: () => Promise<unknown>, done: string) => {
    setBusy(post.id);
    setError(null);
    try {
      await fn();
      onChanged(done, post);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!posts.length) return <Typography sx={{ color: 'var(--text-muted)', fontSize: 13.5, py: 2 }}>{emptyText}</Typography>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {error && (
        <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, borderRadius: 'var(--r-card)', bgcolor: 'var(--st-attention-bg)', color: 'var(--st-attention-fg)', fontSize: 13.5 }}>
          <Box sx={{ flex: 1 }}>{error}</Box>
          <IconButton size="small" aria-label="Dismiss" onClick={() => setError(null)} sx={{ color: 'inherit' }}>
            <CancelIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      {posts.map((p) => {
        const manual = p.mode === 'manual';
        const cancellable = ['draft', 'scheduled', 'failed', 'due'].includes(p.status);
        const isHighlighted = highlight === p.id;
        return (
          <Box
            key={p.id}
            id={`publishing-${p.id}`}
            ref={isHighlighted ? highlighted : undefined}
            sx={{
              display: 'flex', gap: 1.5, p: 1.5, borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-panel)', alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' },
              border: '1px solid', borderColor: isHighlighted ? 'var(--border-strong)' : 'var(--border)', boxShadow: isHighlighted ? '0 0 0 2px var(--border-strong)' : 'none'
            }}
          >
            <PlatformBadge platform={p.platform} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>{whenLine(p)}</Typography>
                <MetaChip meta={publishStatusMeta(p.status)} size="xs" />
                {p.channel?.simulated && <MetaChip meta={{ label: 'Test account', hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' }} size="xs" />}
              </Box>
              {(showTask && p.task?.name) || p.media.length > 0 ? (
                <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {showTask && p.task?.name && (
                    <Link component="button" type="button" onClick={() => openPost(p.task!.id)} sx={{ fontSize: 'inherit', verticalAlign: 'baseline' }}>
                      {p.task.name}
                    </Link>
                  )}
                  {showTask && p.task?.name && p.campaign?.name ? ` · ${p.campaign.name}` : ''}
                  {p.media.length > 0 ? `${showTask && p.task?.name ? ' · ' : ''}${p.media.length} file${p.media.length === 1 ? '' : 's'}` : ''}
                </Typography>
              ) : null}
              {p.text && (
                <Typography sx={{ fontSize: 13, mt: 0.5, whiteSpace: 'pre-wrap', color: 'var(--text-strong)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{p.text}</Typography>
              )}
              {p.progress && <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.5 }}>{p.progress}</Typography>}
              {p.lastError && ['failed', 'scheduled', 'cancelled'].includes(p.status) && (
                <Typography sx={{ fontSize: 12.5, color: p.status === 'failed' ? 'var(--st-attention-fg)' : 'var(--text-muted)', mt: 0.5 }}>
                  {p.status === 'scheduled' ? `Will try again: ${p.lastError}` : p.lastError}
                </Typography>
              )}
              {manual && p.status === 'due' && (
                <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 0.5 }}>
                  Copy the caption, download the files, post them on {p.platformName}, then press “Mark as posted”.
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', ml: { xs: 'auto', sm: 0 } }}>
              {p.remoteUrl && (
                <Tooltip title="Open the live post">
                  <IconButton size="small" href={p.remoteUrl} target="_blank" rel="noopener" aria-label="Open the live post">
                    <OpenIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {(manual || p.status === 'failed') && p.text && (
                <Tooltip title="Copy caption">
                  <IconButton
                    size="small"
                    aria-label="Copy caption"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(p.text)
                        .then(() => onChanged('Caption copied'))
                        .catch(() => setError('Couldn’t copy. Select the caption and copy it yourself.'))
                    }
                  >
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {(manual || p.status === 'failed') &&
                p.media.map((m) => (
                  <Tooltip key={m.index} title={`Download ${m.name || `file ${m.index + 1}`}`}>
                    <IconButton size="small" href={publishingAPI.fileUrl(p.id, m.index)} aria-label={`Download ${m.name || `file ${m.index + 1}`}`}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ))}
              {(p.status === 'due' || (manual && p.status === 'scheduled')) && (
                <Button
                  size="small"
                  startIcon={<DoneIcon />}
                  disabled={busy === p.id}
                  onClick={() => {
                    setMarking(p);
                    setLink('');
                  }}
                >
                  Mark as posted
                </Button>
              )}
              {p.status === 'failed' && p.mode === 'auto' && (
                <Button size="small" startIcon={<RetryIcon />} disabled={busy === p.id} onClick={() => act(p, () => publishingAPI.retry(p.id), 'Trying again')}>
                  Try again
                </Button>
              )}
              {cancellable && (
                <Tooltip title="Cancel">
                  <IconButton size="small" aria-label="Cancel" disabled={busy === p.id} onClick={() => setCancelling(p)}>
                    <CancelIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {['cancelled', 'draft', 'failed'].includes(p.status) && (
                <Tooltip title="Remove from the list">
                  <IconButton size="small" aria-label="Remove from the list" disabled={busy === p.id} onClick={() => act(p, () => publishingAPI.remove(p.id), 'Removed')}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        );
      })}

      <Dialog open={!!marking} onClose={() => setMarking(null)} fullWidth maxWidth="xs">
        <DialogTitle>Mark as posted</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, mb: 2 }}>Paste the link to the live post so it’s kept with the post (optional).</Typography>
          <TextField autoFocus fullWidth size="small" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} inputProps={{ 'aria-label': 'Link to the live post' }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMarking(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              const p = marking!;
              setMarking(null);
              act(p, () => publishingAPI.markPublished(p.id, link.trim() || undefined), 'Marked as posted');
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!cancelling} onClose={() => setCancelling(null)} fullWidth maxWidth="xs">
        <DialogTitle>Cancel this?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>{cancelling ? `${whenLine(cancelling)}. It won’t go out. To post it later, schedule it again from the post.` : ''}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelling(null)}>Keep it</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const p = cancelling!;
              setCancelling(null);
              act(p, () => publishingAPI.cancel(p.id), 'Cancelled');
            }}
          >
            Cancel it
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
