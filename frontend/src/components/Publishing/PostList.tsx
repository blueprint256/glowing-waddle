import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  OpenInNew as OpenIcon,
  Replay as RetryIcon,
  Close as CancelIcon,
  DeleteOutline as DeleteIcon,
  CheckCircleOutline as DoneIcon
} from '@mui/icons-material';
import { publishingAPI, formatWhen, PLATFORM_COLORS, STATUS_LABELS, type Post, type PlatformId, type PostStatus } from '../../services/publishing';

const STATUS_COLORS: Record<PostStatus, 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
  draft: 'default',
  scheduled: 'primary',
  publishing: 'info',
  processing: 'info',
  published: 'success',
  failed: 'error',
  cancelled: 'default',
  due: 'warning'
};

export function PlatformBadge({ platform, size = 28 }: { platform: PlatformId; size?: number }) {
  const label = platform === 'x' ? 'X' : platform === 'linkedin' ? 'in' : platform === 'youtube' ? 'YT' : platform === 'tiktok' ? 'TT' : platform === 'instagram' ? 'IG' : 'f';
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.42, fontWeight: 700, bgcolor: PLATFORM_COLORS[platform], color: '#fff' }} aria-hidden>
      {label}
    </Avatar>
  );
}

interface Props {
  posts: Post[];
  onChanged: (message?: string) => void;
  showTask?: boolean;
  emptyText?: string;
}

/** Posts with their status and the actions that make sense for each. */
export default function PostList({ posts, onChanged, showTask = true, emptyText = 'Nothing here yet.' }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<Post | null>(null);
  const [link, setLink] = useState('');

  const act = async (post: Post, fn: () => Promise<unknown>, done: string) => {
    setBusy(post.id);
    setError(null);
    try {
      await fn();
      onChanged(done);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  if (!posts.length) return <Typography sx={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', py: 4, textAlign: 'center' }}>{emptyText}</Typography>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {posts.map((p) => {
        const manual = p.mode === 'manual';
        const editable = ['draft', 'scheduled', 'failed', 'due'].includes(p.status);
        return (
          <Box key={p.id} sx={{ display: 'flex', gap: 1.5, p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-raised)', alignItems: 'flex-start' }}>
            <PlatformBadge platform={p.platform} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}>
                  {p.platformName}
                  {p.channel?.name ? ` · ${p.channel.name}` : manual ? ' · post by hand' : ''}
                </Typography>
                <Chip size="small" label={STATUS_LABELS[p.status]} color={STATUS_COLORS[p.status]} variant={p.status === 'published' ? 'filled' : 'outlined'} sx={{ height: 20, fontSize: 'var(--fs-3xs)' }} />
                {p.channel?.simulated && <Chip size="small" label="Test account" sx={{ height: 20, fontSize: 'var(--fs-3xs)' }} />}
              </Box>
              <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {p.status === 'published' && p.publishedAt ? `Published ${formatWhen(p.publishedAt)}` : p.scheduledAt ? formatWhen(p.scheduledAt) : 'Not scheduled'}
                {showTask && p.task?.name && (
                  <>
                    {' · '}
                    <Link component={RouterLink} to={`/tasks/${p.task.id}`}>
                      {p.task.name}
                    </Link>
                  </>
                )}
                {p.media.length > 0 && ` · ${p.media.length} file${p.media.length === 1 ? '' : 's'}`}
              </Typography>
              {p.text && (
                <Typography sx={{ fontSize: 'var(--fs-xs)', mt: 0.5, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.text}</Typography>
              )}
              {p.progress && <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', mt: 0.5 }}>{p.progress}</Typography>}
              {p.lastError && ['failed', 'scheduled', 'cancelled'].includes(p.status) && (
                <Typography sx={{ fontSize: 'var(--fs-2xs)', color: p.status === 'failed' ? 'var(--danger-text)' : 'var(--text-muted)', mt: 0.5 }}>
                  {p.status === 'scheduled' ? `Will retry: ${p.lastError}` : p.lastError}
                </Typography>
              )}
              {manual && p.status === 'due' && (
                <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', mt: 0.5 }}>
                  Copy the caption, download the files, post them on {p.platformName}, then press “Mark as posted”.
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
              {p.remoteUrl && (
                <Tooltip title="Open the live post">
                  <IconButton size="small" href={p.remoteUrl} target="_blank" rel="noopener">
                    <OpenIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {(manual || p.status === 'failed') && p.text && (
                <Tooltip title="Copy caption">
                  <IconButton size="small" onClick={() => navigator.clipboard?.writeText(p.text).then(() => onChanged('Caption copied'))}>
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {(manual || p.status === 'failed') &&
                p.media.map((m) => (
                  <Tooltip key={m.index} title={`Download ${m.name || `file ${m.index + 1}`}`}>
                    <IconButton size="small" href={publishingAPI.fileUrl(p.id, m.index)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ))}
              {(p.status === 'due' || (manual && p.status === 'scheduled')) && (
                <Button size="small" startIcon={<DoneIcon />} disabled={busy === p.id} onClick={() => { setMarking(p); setLink(''); }}>
                  Mark as posted
                </Button>
              )}
              {p.status === 'failed' && p.mode === 'auto' && (
                <Button size="small" startIcon={<RetryIcon />} disabled={busy === p.id} onClick={() => act(p, () => publishingAPI.retry(p.id), 'Trying again')}>
                  Retry
                </Button>
              )}
              {editable && (
                <Tooltip title="Cancel">
                  <IconButton size="small" disabled={busy === p.id} onClick={() => act(p, () => publishingAPI.cancel(p.id), 'Cancelled')}>
                    <CancelIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {['cancelled', 'draft', 'failed'].includes(p.status) && (
                <Tooltip title="Remove from the list">
                  <IconButton size="small" disabled={busy === p.id} onClick={() => act(p, () => publishingAPI.remove(p.id), 'Removed')}>
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
          <Typography sx={{ fontSize: 'var(--fs-sm)', mb: 2 }}>Paste the link to the live post so it's saved with the task (optional).</Typography>
          <TextField autoFocus fullWidth size="small" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
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
    </Box>
  );
}
