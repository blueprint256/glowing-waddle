import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery
} from '@mui/material';
import {
  AutoAwesome as AIIcon,
  CloudUploadOutlined as UploadIcon,
  PhotoLibraryOutlined as LibraryIcon,
  Visibility as PreviewIcon,
  DeleteOutline as DeleteIcon,
  Close as CloseIcon,
  ChevronRight as ChevronIcon,
  ImageOutlined as ImageIcon
} from '@mui/icons-material';
import { taskAPI, commentAPI } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { canUseAI, type Comment } from '../../types';
import { SETTABLE_POST_STATUSES, isPublishingStatus, postStatusMeta, toPostStatus, type PostStatus } from '../../lib/status';
import { dayKey, dayToISO, formatAgo, formatDay } from '../../lib/dates';
import { paths, refId } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';
import { announcePostChanged, useAIJobsStore } from '../../store/aiJobsStore';
import { PostStatusChip, StatusDot } from '../ui/StatusChip';
import ImageViewer from '../ui/ImageViewer';
import PostPreview, { type PreviewPlatform } from './PostPreview';
import { ImproveBriefButton, ImproveCaptionButton } from './AISuggestion';
import LibraryImagePicker from './LibraryImagePicker';
import TaskPublishing from '../Publishing/TaskPublishing';
import EditInCanvaButton from '../Canva/EditInCanvaButton';

/**
 * One post, everything about it in one place: title, status, day, image (upload, Library, AI,
 * Canva), caption with live preview editing and AI help, brief, publishing and notes.
 *
 * Used in the side panel (?post=<id> on any page), in Blue's full screen, and on /posts/<id>.
 * Status and day save at once (with Undo); title, caption and brief save together with
 * "Save" or Ctrl+S, and nothing is lost by accident (the bar says when there are unsaved changes).
 */

interface Draft {
  name: string;
  description: string;
  content: string;
}

const fromTask = (t: any): Draft => ({ name: t?.name || '', description: t?.description || '', content: t?.content || '' });

/**
 * Takes the post's own fields from an update response, keeping the campaign/theme details loaded
 * with the post (update responses only include their names).
 */
const OWN_FIELDS = ['name', 'description', 'content', 'status', 'taskDate', 'designedImage', 'pendingGeneratedImage', 'attachedImages', 'updatedAt', 'lastModifiedBy'];
const mergeOwn = (prev: any, next: any) => {
  if (!next) return prev;
  const out = { ...prev };
  // Update responses hold the whole post: a field that's missing is empty (e.g. a removed date).
  for (const k of OWN_FIELDS) out[k] = next[k];
  return out;
};

function Label({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, minHeight: 30, flexWrap: 'wrap' }}>
      <Typography component="h3" sx={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {children}
      </Typography>
      {right}
    </Box>
  );
}

export interface PostEditorProps {
  taskId: string;
  /** panel: side panel / Blue; page: /posts/<id> with the preview beside the editor. */
  variant?: 'panel' | 'page';
  /** Tells the host whether there are unsaved changes (to ask before closing). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Gives the host a way to save before closing. */
  registerSave?: (save: () => Promise<boolean>) => void;
  /** Called after the post was deleted. */
  onDeleted?: () => void;
  /** Called with the title once loaded (for the host's header). */
  onLoaded?: (task: any) => void;
}

export default function PostEditor({ taskId, variant = 'panel', onDirtyChange, registerSave, onDeleted, onLoaded }: PostEditorProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const aiEnabled = canUseAI(user);
  const wide = useMediaQuery('(min-width: 75em)');
  const sideBySide = variant === 'page' && wide;

  const [task, setTask] = useState<any>(null);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null }>({ name: '', logoUrl: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', description: '', content: '' });
  const [baseline, setBaseline] = useState<Draft>({ name: '', description: '', content: '' });
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [posterBusy, setPosterBusy] = useState<'adopt' | 'discard' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [platform, setPlatform] = useState<PreviewPlatform>('instagram');
  const [viewer, setViewer] = useState<{ src: string; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const job = useAIJobsStore((s) => s.images[taskId]);
  const createImage = useAIJobsStore((s) => s.createImage);
  const [now, setNow] = useState(Date.now());

  const dirty = draft.name !== baseline.name || draft.description !== baseline.description || draft.content !== baseline.content;

  const load = useCallback(
    async (opts: { keepDraft?: boolean } = {}) => {
      try {
        const res = await taskAPI.getById(taskId);
        const t = res.data.task;
        setTask(t);
        setBrand(res.data.brand || { name: '', logoUrl: null });
        setLoadError(null);
        const next = fromTask(t);
        setBaseline(next);
        if (!opts.keepDraft) setDraft(next);
        onLoaded?.(t);
      } catch (e) {
        setLoadError(errorMessage(e, 'This post couldn’t be loaded.'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId]
  );

  const loadComments = useCallback(async () => {
    try {
      const res = await commentAPI.getAll({ taskId });
      setComments(res.data.comments || []);
    } catch {
      setComments([]);
    }
  }, [taskId]);

  useEffect(() => {
    setTask(null);
    load();
    loadComments();
  }, [load, loadComments]);

  // Another view changed this post (publishing, an AI image, Blue): refresh, keeping unsaved typing.
  useEffect(() => {
    const onChanged = (e: Event) => {
      if ((e as CustomEvent).detail === taskId) load({ keepDraft: true });
    };
    window.addEventListener('post:changed', onChanged);
    return () => window.removeEventListener('post:changed', onChanged);
  }, [taskId, load]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Ticks while the AI image is being made, for the elapsed time.
  useEffect(() => {
    if (job?.state !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.state]);

  // Closing the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!draft.name.trim()) {
      notify('Give the post a title first.', { tone: 'error' });
      return false;
    }
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (draft.name !== baseline.name) body.name = draft.name.trim();
      if (draft.description !== baseline.description) body.description = draft.description;
      if (draft.content !== baseline.content) body.content = draft.content;
      const res = await taskAPI.update(taskId, body);
      const t = res.data.task;
      setTask((prev: any) => mergeOwn(prev, t));
      const next = fromTask(t);
      setBaseline(next);
      setDraft(next);
      notify('Saved');
      announcePostChanged(taskId);
      return true;
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save. Try again.'), { tone: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, baseline, taskId]);

  useEffect(() => registerSave?.(save), [registerSave, save]);

  // Ctrl/⌘+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  /** Status and day save straight away, with Undo. */
  const quickUpdate = async (body: Record<string, unknown>, message: string, undoBody: Record<string, unknown>) => {
    setStatusBusy(true);
    try {
      const res = await taskAPI.update(taskId, body);
      setTask((prev: any) => mergeOwn(prev, res.data.task));
      announcePostChanged(taskId);
      notify(message, {
        undo: async () => {
          try {
            const back = await taskAPI.update(taskId, undoBody);
            setTask((prev: any) => mergeOwn(prev, back.data.task));
            announcePostChanged(taskId);
          } catch (e) {
            notify(errorMessage(e, 'Couldn’t undo.'), { tone: 'error' });
          }
        }
      });
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t update the post.'), { tone: 'error' });
    } finally {
      setStatusBusy(false);
    }
  };

  const changeStatus = (next: PostStatus) => {
    const current = toPostStatus(task?.status);
    if (next === current) return;
    quickUpdate({ status: next }, `Marked as ${postStatusMeta(next).label}`, { status: current });
  };

  const changeDay = (key: string) => {
    const before = task?.taskDate ?? null;
    const value = key ? dayToISO(key) : null;
    quickUpdate({ taskDate: value }, key ? `Moved to ${formatDay(value, { relative: true })}` : 'Date removed', { taskDate: before });
  };

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return notify('Choose a picture (PNG, JPG, WebP or GIF).', { tone: 'error' });
    if (file.size > 10 * 1024 * 1024) return notify('That picture is over 10 MB. Choose a smaller one.', { tone: 'error' });
    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await taskAPI.uploadImage(taskId, form);
      setTask((prev: any) => ({ ...prev, designedImage: res.data.task?.designedImage }));
      notify('Image updated');
      announcePostChanged(taskId);
    } catch (err) {
      notify(errorMessage(err, 'Couldn’t upload the picture.'), { tone: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const poster = async (action: 'adopt' | 'discard') => {
    setPosterBusy(action);
    try {
      if (action === 'adopt') await taskAPI.adoptPoster(taskId);
      else await taskAPI.discardPoster(taskId);
      useAIJobsStore.getState().clear(taskId);
      await load({ keepDraft: true });
      announcePostChanged(taskId);
      notify(action === 'adopt' ? 'AI image is now the post’s image (also saved in the Library)' : 'AI image discarded');
    } catch (e) {
      notify(errorMessage(e, 'Something went wrong. Try again.'), { tone: 'error' });
    } finally {
      setPosterBusy(null);
    }
  };

  const remove = async () => {
    try {
      const res = await taskAPI.delete(taskId);
      setConfirmDelete(false);
      notify(res.data?.cancelledPosts ? res.data.message : 'Post deleted');
      onDeleted?.();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t delete the post.'), { tone: 'error' });
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await commentAPI.create({ content: note.trim(), taskId });
      setNote('');
      loadComments();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t add the note.'), { tone: 'error' });
    }
  };

  const status = toPostStatus(task?.status);
  const fromPublishing = isPublishingStatus(status);
  const campaign = task?.campaignId && typeof task.campaignId === 'object' ? task.campaignId : null;
  const theme = task?.projectId && typeof task.projectId === 'object' ? task.projectId : null;
  const ownerId = refId(campaign?.createdBy);
  const dayValue = dayKey(task?.taskDate) || '';
  const jobSeconds = job?.state === 'running' ? Math.max(0, Math.round((now - job.startedAt) / 1000)) : 0;
  const statusOptions = useMemo(() => SETTABLE_POST_STATUSES, []);

  if (loadError && !task) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography sx={{ color: 'var(--danger-text)', mb: 1.5 }}>{loadError}</Typography>
        <Button onClick={() => load()}>Try again</Button>
      </Box>
    );
  }
  if (!task) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress size={24} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  const preview = (
    <PostPreview
      caption={draft.content}
      onCaptionChange={(v) => setDraft((d) => ({ ...d, content: v }))}
      image={task.designedImage}
      brandName={brand.name}
      brandLogo={brand.logoUrl}
      dateLabel={task.taskDate ? formatDay(task.taskDate, { weekday: false }) : undefined}
      platform={platform}
      onPlatformChange={setPlatform}
    />
  );

  const editor = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}>
      {/* Where it belongs */}
      {(campaign || theme) && (
        <Box component="nav" aria-label="Part of" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25, fontSize: 13, color: 'var(--text-muted)' }}>
          {campaign && (
            <Box component={RouterLink} to={paths.campaign(campaign)} sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline', color: 'var(--text-strong)' } }}>
              {campaign.name}
            </Box>
          )}
          {campaign && theme && <ChevronIcon aria-hidden sx={{ fontSize: 16, color: 'var(--text-faint)' }} />}
          {theme && campaign && (
            <Box component={RouterLink} to={paths.campaign(campaign, { theme })} sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline', color: 'var(--text-strong)' } }}>
              {theme.name}
            </Box>
          )}
        </Box>
      )}

      {/* Title */}
      <TextField
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder="Post title"
        variant="standard"
        fullWidth
        multiline
        inputProps={{ 'aria-label': 'Post title', maxLength: 200 }}
        InputProps={{ disableUnderline: true, sx: { fontSize: 22, fontWeight: 650, color: 'var(--text-strong)', lineHeight: 1.3 } }}
        helperText={draft.name.trim() ? undefined : 'A title is needed (only you see it).'}
        error={!draft.name.trim()}
        sx={{ mt: -1 }}
      />

      {/* Status and day */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        {fromPublishing ? (
          <Tooltip title="Set by Publishing. Change or cancel it in the Publishing section below.">
            <Box sx={{ display: 'inline-flex' }}>
              <PostStatusChip status={status} />
            </Box>
          </Tooltip>
        ) : (
          <Select
            size="small"
            value={status}
            onChange={(e) => changeStatus(e.target.value as PostStatus)}
            disabled={statusBusy}
            inputProps={{ 'aria-label': 'Status' }}
            renderValue={(v) => <PostStatusChip status={v} size="xs" />}
            sx={{ minWidth: 150, height: 34, '& .MuiSelect-select': { display: 'flex', alignItems: 'center', py: 0.5 } }}
          >
            {statusOptions.map((s) => (
              <MenuItem key={s} value={s} sx={{ gap: 1 }}>
                <StatusDot status={s} />
                <Box>
                  <Typography sx={{ fontSize: 14 }}>{postStatusMeta(s).label}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{postStatusMeta(s).hint}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        )}
        <TextField
          type="date"
          size="small"
          value={dayValue}
          onChange={(e) => changeDay(e.target.value)}
          disabled={statusBusy}
          inputProps={{ 'aria-label': 'Day it goes out' }}
          sx={{ width: 170, '& input': { py: '6.5px' } }}
        />
        {!dayValue && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>Not on the calendar yet</Typography>}
      </Box>

      {/* Image */}
      <Box component="section" aria-label="Image">
        <Label>Image</Label>
        {task.designedImage ? (
          <Box
            component="button"
            type="button"
            onClick={() => setViewer({ src: task.designedImage, title: draft.name })}
            aria-label="See the image full size"
            sx={{ all: 'unset', display: 'block', width: '100%', cursor: 'zoom-in', borderRadius: 'var(--r-card)', overflow: 'hidden', border: '1px solid var(--border)', bgcolor: 'var(--bg-subtle)' }}
          >
            <Box component="img" src={task.designedImage} alt={draft.name} sx={{ width: '100%', maxHeight: 380, objectFit: 'contain', display: 'block' }} />
          </Box>
        ) : (
          <Box sx={{ border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-card)', py: 4, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            <ImageIcon sx={{ fontSize: 32, display: 'block', mx: 'auto', mb: 0.5, color: 'var(--text-faint)' }} />
            No image yet
          </Box>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          <Button size="small" startIcon={uploading ? <CircularProgress size={14} /> : <UploadIcon />} disabled={uploading} onClick={() => fileRef.current?.click()}>
            {task.designedImage ? 'Replace' : 'Upload'}
          </Button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={upload} />
          <Button size="small" startIcon={<LibraryIcon />} onClick={() => setPickerOpen(true)}>
            From the Library
          </Button>
          {aiEnabled && (
            <Button size="small" startIcon={<AIIcon />} disabled={job?.state === 'running'} onClick={() => createImage(taskId, draft.name || 'this post')}>
              Create image with AI
            </Button>
          )}
          {task.designedImage && (
            <EditInCanvaButton
              target={{ target: 'task', taskId }}
              onImported={(message) => {
                notify(message);
                load({ keepDraft: true });
                announcePostChanged(taskId);
              }}
            />
          )}
        </Box>
        {job?.state === 'running' && (
          <Box sx={{ mt: 1.25, p: 1.25, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
            <Typography sx={{ fontSize: 13, color: 'var(--text)', mb: 0.75 }}>
              Creating the image… {jobSeconds}s. This usually takes 20–60 seconds. You can keep working or close this; you’ll get a message when it’s ready.
            </Typography>
            <LinearProgress variant={jobSeconds < 60 ? 'determinate' : 'indeterminate'} value={Math.min(95, (jobSeconds / 60) * 100)} />
          </Box>
        )}
        {task.pendingGeneratedImage && (
          <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 'var(--r-card)', border: '1px solid var(--st-scheduled-dot)', bgcolor: 'var(--bg-subtle)' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', mb: 1 }}>New AI image — use it or discard it</Typography>
            <Box
              component="button"
              type="button"
              onClick={() => setViewer({ src: task.pendingGeneratedImage, title: `${draft.name} — AI image` })}
              aria-label="See the AI image full size"
              sx={{ all: 'unset', display: 'block', cursor: 'zoom-in', borderRadius: 'var(--r-ctl)', overflow: 'hidden' }}
            >
              <Box component="img" src={task.pendingGeneratedImage} alt="AI image" sx={{ width: '100%', maxHeight: 300, objectFit: 'contain', display: 'block', bgcolor: '#000' }} />
            </Box>
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <Button size="small" variant="contained" disabled={Boolean(posterBusy)} onClick={() => poster('adopt')}>
                {posterBusy === 'adopt' ? 'Saving…' : 'Use this image'}
              </Button>
              {aiEnabled && (
                <Button size="small" disabled={Boolean(posterBusy) || job?.state === 'running'} onClick={() => createImage(taskId, draft.name || 'this post')}>
                  Try again
                </Button>
              )}
              <Button size="small" disabled={Boolean(posterBusy)} onClick={() => poster('discard')} sx={{ color: 'var(--text-muted)' }}>
                Discard
              </Button>
            </Box>
          </Box>
        )}
      </Box>

      {/* Caption */}
      <Box component="section" aria-label="Caption">
        <Label
          right={
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {aiEnabled && (
                <ImproveCaptionButton taskId={taskId} caption={draft.content} brief={draft.description} onUse={(text) => setDraft((d) => ({ ...d, content: text }))} />
              )}
              {!sideBySide && (
                <Button size="small" startIcon={<PreviewIcon />} onClick={() => setPreviewOpen(true)}>
                  Preview and edit
                </Button>
              )}
            </Box>
          }
        >
          Caption
        </Label>
        <TextField
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          placeholder="The text that gets published, with hashtags and a call to action."
          multiline
          minRows={4}
          fullWidth
          inputProps={{ 'aria-label': 'Caption' }}
          helperText={`${[...draft.content].length.toLocaleString()} characters`}
        />
      </Box>

      {/* Brief */}
      <Box component="section" aria-label="Brief">
        <Label right={aiEnabled ? <ImproveBriefButton taskId={taskId} brief={draft.description} caption={draft.content} onUse={(text) => setDraft((d) => ({ ...d, description: text }))} /> : undefined}>
          Brief
        </Label>
        <TextField
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="What the post should achieve and show (for you, a designer or the AI)."
          multiline
          minRows={2}
          fullWidth
          inputProps={{ 'aria-label': 'Brief' }}
        />
      </Box>

      {/* Reference images */}
      {Array.isArray(task.attachedImages) && task.attachedImages.length > 0 && (
        <Box component="section" aria-label="Reference images">
          <Label>Reference images</Label>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {task.attachedImages.map((src: string, i: number) => (
              <Box
                key={src}
                component="button"
                type="button"
                onClick={() => setViewer({ src, title: `Reference image ${i + 1}` })}
                sx={{ all: 'unset', cursor: 'zoom-in', width: 72, height: 72, borderRadius: 'var(--r-ctl)', overflow: 'hidden', border: '1px solid var(--border)' }}
              >
                <img src={src} alt={`Reference ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <TaskPublishing taskId={taskId} />

      {/* Notes */}
      <Box component="section" aria-label="Notes">
        <Label>Notes</Label>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addNote();
              }
            }}
            placeholder="Add a note (ideas, links, reminders)…"
            size="small"
            multiline
            maxRows={6}
            fullWidth
            inputProps={{ 'aria-label': 'New note' }}
          />
          <Button onClick={addNote} disabled={!note.trim()} sx={{ flexShrink: 0 }}>
            Add
          </Button>
        </Box>
        {comments.length > 0 && (
          <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {comments.map((c) => (
              <Box key={c._id} sx={{ p: 1.25, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)' }}>
                <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text)' }}>{c.content}</Typography>
                <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.5 }}>
                  {c.authorId?.firstName ? `${c.authorId.firstName} ${c.authorId.lastName || ''} · ` : ''}
                  {formatAgo(c.createdAt)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box sx={{ pt: 1, borderTop: '1px solid var(--border)' }}>
        <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmDelete(true)}>
          Delete post
        </Button>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ position: 'relative' }}>
      {sideBySide ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 480px)', gap: 4, alignItems: 'start' }}>
          {editor}
          <Box sx={{ position: 'sticky', top: 16 }}>
            <Label>Preview — edit the caption right here</Label>
            {preview}
          </Box>
        </Box>
      ) : (
        editor
      )}

      {/* Unsaved changes */}
      {dirty && (
        <Box
          role="status"
          sx={{
            position: 'sticky', bottom: 0, mt: 2, mx: variant === 'panel' ? -2 : 0, px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1,
            bgcolor: 'var(--bg-float)', borderTop: '1px solid var(--border-strong)', boxShadow: '0 -6px 16px rgba(0,0,0,.08)', zIndex: 2
          }}
        >
          <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--warning)' }} />
          <Typography sx={{ flex: 1, fontSize: 14, color: 'var(--text-strong)' }}>Unsaved changes</Typography>
          <Button size="small" onClick={() => setDraft(baseline)} disabled={saving}>
            Discard
          </Button>
          <Button size="small" variant="contained" onClick={() => save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      )}

      {/* Preview with editing, when it isn't beside the editor */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: 'var(--bg-panel)', backgroundImage: 'none' } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
          <Box sx={{ flex: 1 }}>Preview — edit the caption right here</Box>
          <IconButton size="small" aria-label="Close" onClick={() => setPreviewOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>{preview}</DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {aiEnabled && <ImproveCaptionButton taskId={taskId} caption={draft.content} brief={draft.description} onUse={(text) => setDraft((d) => ({ ...d, content: text }))} />}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setPreviewOpen(false)}>Done</Button>
          <Button
            variant="contained"
            disabled={!dirty || saving}
            onClick={async () => {
              if (await save()) setPreviewOpen(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <LibraryImagePicker
        open={pickerOpen}
        taskId={taskId}
        campaignId={refId(campaign)}
        ownerId={ownerId}
        onClose={() => setPickerOpen(false)}
        onUsed={(url) => {
          setTask((prev: any) => ({ ...prev, designedImage: url }));
          announcePostChanged(taskId);
        }}
      />

      <ImageViewer src={viewer?.src || null} title={viewer?.title} onClose={() => setViewer(null)} />

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this post?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            “{task.name}” will be deleted. If it’s scheduled, it won’t go out. Its pictures stay in the Library. This can’t be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={remove}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Lets the full page link straight to the planner around this post's day. */}
      {variant === 'page' && dayValue && (
        <Box sx={{ mt: 3 }}>
          <Button size="small" onClick={() => navigate(paths.planner({ view: 'week', date: dayValue }))}>
            See this week in the Planner
          </Button>
        </Box>
      )}
    </Box>
  );
}
