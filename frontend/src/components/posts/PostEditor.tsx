import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  ListSubheader,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery
} from '@mui/material';
import { Visibility as PreviewIcon, DeleteOutline as DeleteIcon, Close as CloseIcon, OpenInNew as OpenIcon } from '@mui/icons-material';
import { campaignAPI, taskAPI, userAPI } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { UserRole, canUseAI, type Task } from '../../types';
import { SETTABLE_POST_STATUSES, isPublishingStatus, postStatusMeta, toPostStatus, type PostStatus } from '../../lib/status';
import { dayKey, dayToISO, formatDay } from '../../lib/dates';
import { paths, refId } from '../../lib/paths';
import { campaignColor } from '../../lib/colors';
import { titleFrom } from '../../lib/postTitle';
import { errorMessage, notify } from '../../store/toastStore';
import { announcePostChanged } from '../../store/aiJobsStore';
import { PostStatusChip, StatusDot } from '../ui/StatusChip';
import PostPreview, { type PreviewPlatform } from './PostPreview';
import { ImproveCaptionButton } from './AISuggestion';
import PicturePanel from './PicturePanel';
import TaskPublishing from '../Publishing/TaskPublishing';

/**
 * One post, everything about it on one screen (Post v2):
 *   title (automatic from the caption, click to rename) · campaign (or none) · day · status
 *   What's this post about? (what the AI works from) · picture · caption · Publishing
 *
 * The same screen makes a new post (taskId null): nothing is saved until "Create post" (or until
 * a picture is added, which needs the post to exist), then it simply carries on as the post.
 *
 * Used in the side panel (?post=<id> or ?post=new on any page), in Blue's full screen, and on
 * /posts/<id>. Campaign, day and status save at once (with Undo); title, "about" and caption save
 * together with "Save" or Ctrl+S, and nothing is lost by accident.
 */

interface Draft {
  name: string;
  description: string;
  content: string;
}

/** An automatic title is shown as a hint, so the field holds only a title someone typed. */
const fromTask = (t: any): Draft => ({ name: t?.autoName ? '' : t?.name || '', description: t?.description || '', content: t?.content || '' });

const NO_CAMPAIGN = 'none';

function Label({ children, right, htmlFor }: { children: ReactNode; right?: ReactNode; htmlFor?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, minHeight: 30, flexWrap: 'wrap' }}>
      <Box component={htmlFor ? 'label' : 'h3'} {...(htmlFor ? { htmlFor } : {})} sx={{ flex: 1, m: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {children}
      </Box>
      {right}
    </Box>
  );
}

export interface NewPostDefaults {
  /** "2026-11-20" */
  day?: string;
  /** A campaign id, or "none". */
  campaignId?: string;
  status?: PostStatus;
  caption?: string;
}

export interface PostEditorProps {
  /** The post, or null for a new one. */
  taskId: string | null;
  /** For a new post: what to start with. */
  defaults?: NewPostDefaults;
  /** panel: side panel / Blue; page: /posts/<id> with the preview beside the editor. */
  variant?: 'panel' | 'page';
  /** Tells the host whether there are unsaved changes (to ask before closing). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Gives the host a way to save before closing. */
  registerSave?: (save: () => Promise<boolean>) => void;
  /** A new post was created (the host updates its address). */
  onCreated?: (taskId: string) => void;
  /** Cancel on a new post. */
  onCancel?: () => void;
  /** Called after the post was deleted. */
  onDeleted?: () => void;
  /** Called with the post once loaded (for the host's header). */
  onLoaded?: (task: any) => void;
}

export default function PostEditor({ taskId: initialId, defaults, variant = 'panel', onDirtyChange, registerSave, onCreated, onCancel, onDeleted, onLoaded }: PostEditorProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const aiEnabled = canUseAI(user);
  const wide = useMediaQuery('(min-width: 75em)');
  const sideBySide = variant === 'page' && wide;

  const [taskId, setTaskId] = useState<string | null>(initialId);
  const isNew = !taskId;
  const [task, setTask] = useState<Task | null>(null);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null }>({ name: '', logoUrl: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const empty: Draft = { name: '', description: '', content: defaults?.caption || '' };
  const [draft, setDraft] = useState<Draft>(empty);
  const [baseline, setBaseline] = useState<Draft>({ name: '', description: '', content: '' });
  // A new post's campaign, day and status (an existing post saves these at once).
  const [newCampaign, setNewCampaign] = useState<string>(defaults?.campaignId || NO_CAMPAIGN);
  const [newDay, setNewDay] = useState<string>(defaults?.day || '');
  const [newStatus, setNewStatus] = useState<PostStatus>(defaults?.status || 'Draft');
  const [campaigns, setCampaigns] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [platform, setPlatform] = useState<PreviewPlatform>('instagram');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const creating = useRef<Promise<string | null> | null>(null);

  const dirty = isNew
    ? Boolean(draft.name.trim() || draft.description.trim() || draft.content.trim())
    : draft.name !== baseline.name || draft.description !== baseline.description || draft.content !== baseline.content;

  // ---- Loading -----------------------------------------------------------------------------------

  const load = useCallback(
    async (opts: { keepDraft?: boolean } = {}) => {
      if (!taskId) return;
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

  useEffect(() => {
    if (initialId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new post shows your brand (previews, the AI logo option) until it's created.
  useEffect(() => {
    if (initialId) return;
    let alive = true;
    const fallbackName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
    userAPI
      .getCompanyInfo()
      .then((r) => {
        const ci = r.data?.companyInfo || {};
        if (alive) setBrand({ name: ci.companyName || fallbackName, logoUrl: ci.primaryLogoUrl || null });
      })
      .catch(() => alive && setBrand({ name: fallbackName, logoUrl: null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Campaigns to choose from: the post's account's, not archived (plus its current one). An admin
  // making a new post can pick any account's campaign (the post then belongs to that account).
  const me = user?._id || user?.id;
  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const ownerId = task?.ownerId ? String(task.ownerId) : isAdmin ? null : me;
  useEffect(() => {
    let alive = true;
    campaignAPI
      .getAll({ limit: 500 })
      .then((r) => alive && setCampaigns(r.data.campaigns || []))
      .catch(() => alive && setCampaigns([]));
    return () => {
      alive = false;
    };
  }, []);
  const currentCampaign = task?.campaignId && typeof task.campaignId === 'object' ? task.campaignId : null;
  const campaignOptions = useMemo(() => {
    const list = (campaigns || []).filter((c) => (!ownerId || refId(c.createdBy) === String(ownerId)) && (!c.archived || c._id === refId(currentCampaign)));
    return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [campaigns, ownerId, currentCampaign]);

  // A new post's campaign must be one it can go in (e.g. not an archived one from a filter).
  useEffect(() => {
    if (isNew && campaigns !== null && newCampaign !== NO_CAMPAIGN && !campaignOptions.some((c) => c._id === newCampaign)) setNewCampaign(NO_CAMPAIGN);
  }, [isNew, campaigns, campaignOptions, newCampaign]);

  // Another view changed this post (publishing, an AI picture, Blue): refresh, keeping typing.
  useEffect(() => {
    const onChanged = (e: Event) => {
      if (taskId && (e as CustomEvent).detail === taskId) load({ keepDraft: true });
    };
    window.addEventListener('post:changed', onChanged);
    return () => window.removeEventListener('post:changed', onChanged);
  }, [taskId, load]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

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

  // ---- Creating and saving -----------------------------------------------------------------------

  /** Creates the new post from what's on screen (once, even if several things ask at the same time). */
  const create = useCallback(async (): Promise<string | null> => {
    if (taskId) return taskId;
    if (creating.current) return creating.current;
    const run = (async () => {
      setSaving(true);
      try {
        const res = await taskAPI.create({
          name: draft.name.trim(),
          description: draft.description,
          content: draft.content,
          campaignId: newCampaign === NO_CAMPAIGN ? null : newCampaign,
          taskDate: newDay ? dayToISO(newDay) : null,
          status: newStatus
        });
        const t = res.data.task;
        setTask(t);
        setTaskId(t._id);
        const saved = fromTask(t);
        setBaseline(saved);
        setDraft((d) => ({ ...d, name: saved.name }));
        onLoaded?.(t);
        onCreated?.(t._id);
        announcePostChanged(t._id);
        return t._id as string;
      } catch (e) {
        notify(errorMessage(e, 'Couldn’t create the post. Try again.'), { tone: 'error' });
        return null;
      } finally {
        setSaving(false);
        creating.current = null;
      }
    })();
    creating.current = run;
    return run;
  }, [taskId, draft, newCampaign, newDay, newStatus, onCreated, onLoaded]);

  const save = useCallback(async (): Promise<boolean> => {
    if (isNew) {
      if (!dirty) return true;
      const id = await create();
      if (id) notify('Post created');
      return Boolean(id);
    }
    if (!dirty) return true;
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (draft.name !== baseline.name) body.name = draft.name.trim();
      if (draft.description !== baseline.description) body.description = draft.description;
      if (draft.content !== baseline.content) body.content = draft.content;
      const res = await taskAPI.update(taskId!, body);
      const t = res.data.task;
      setTask(t);
      const next = fromTask(t);
      setBaseline(next);
      setDraft(next);
      notify('Saved');
      announcePostChanged(taskId!);
      return true;
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save. Try again.'), { tone: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [isNew, dirty, create, draft, baseline, taskId]);

  useEffect(() => registerSave?.(save), [registerSave, save]);

  // Ctrl/⌘+S saves (creates a new post).
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

  /** Campaign, status and day save straight away on a saved post, with Undo. */
  const quickUpdate = async (body: Record<string, unknown>, message: string, undoBody: Record<string, unknown>) => {
    if (!taskId) return;
    setQuickBusy(true);
    try {
      const res = await taskAPI.update(taskId, body);
      setTask(res.data.task);
      announcePostChanged(taskId);
      notify(message, {
        undo: async () => {
          try {
            const back = await taskAPI.update(taskId, undoBody);
            setTask(back.data.task);
            announcePostChanged(taskId);
          } catch (e) {
            notify(errorMessage(e, 'Couldn’t undo.'), { tone: 'error' });
          }
        }
      });
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t update the post.'), { tone: 'error' });
    } finally {
      setQuickBusy(false);
    }
  };

  const status = isNew ? newStatus : toPostStatus(task?.status);
  const fromPublishing = !isNew && isPublishingStatus(status);
  const dayValue = isNew ? newDay : dayKey(task?.taskDate) || '';
  const campaignValue = isNew ? newCampaign : refId(currentCampaign) || NO_CAMPAIGN;

  const changeStatus = (next: PostStatus) => {
    if (isNew) return setNewStatus(next);
    if (next === status) return;
    quickUpdate({ status: next }, `Marked as ${postStatusMeta(next).label}`, { status });
  };

  const changeDay = (key: string) => {
    if (isNew) return setNewDay(key);
    const before = task?.taskDate ?? null;
    const value = key ? dayToISO(key) : null;
    quickUpdate({ taskDate: value }, key ? `Moved to ${formatDay(value, { relative: true })}` : 'Day removed', { taskDate: before });
  };

  const changeCampaign = (value: string) => {
    if (isNew) return setNewCampaign(value);
    if (value === campaignValue) return;
    const name = campaignOptions.find((c) => c._id === value)?.name;
    quickUpdate(
      { campaignId: value === NO_CAMPAIGN ? null : value },
      value === NO_CAMPAIGN ? 'Taken out of its campaign' : `Moved to ${name || 'the campaign'}`,
      { campaignId: campaignValue === NO_CAMPAIGN ? null : campaignValue }
    );
  };

  const remove = async () => {
    if (!taskId) return;
    try {
      const res = await taskAPI.delete(taskId);
      setConfirmDelete(false);
      notify(res.data?.message || 'Post deleted');
      onDeleted?.();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t delete the post.'), { tone: 'error' });
    }
  };

  // ---- Render ------------------------------------------------------------------------------------

  const autoTitle = titleFrom(draft.content, draft.description);
  const shownTitle = draft.name.trim() || autoTitle;

  if (loadError && !task) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography sx={{ color: 'var(--danger-text)', mb: 1.5 }}>{loadError}</Typography>
        <Button onClick={() => load()}>Try again</Button>
      </Box>
    );
  }
  if (!isNew && !task) {
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
      image={task?.designedImage}
      brandName={brand.name}
      brandLogo={brand.logoUrl}
      dateLabel={dayValue ? formatDay(dayToISO(dayValue), { weekday: false }) : undefined}
      platform={platform}
      onPlatformChange={setPlatform}
    />
  );

  const captionButton = (size?: 'small' | 'medium') =>
    aiEnabled ? (
      <ImproveCaptionButton
        taskId={taskId}
        campaignId={campaignValue === NO_CAMPAIGN ? null : campaignValue}
        caption={draft.content}
        brief={draft.description}
        size={size}
        onUse={(text) => setDraft((d) => ({ ...d, content: text }))}
      />
    ) : null;

  const editor = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}>
      {/* Title: automatic until someone types one */}
      <Box sx={{ mt: -1 }}>
        <TextField
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder={isNew && !draft.content.trim() && !draft.description.trim() ? 'New post' : autoTitle}
          variant="standard"
          fullWidth
          multiline
          inputProps={{ 'aria-label': 'Post title', maxLength: 200 }}
          InputProps={{ disableUnderline: true, sx: { fontSize: 22, fontWeight: 650, color: 'var(--text-strong)', lineHeight: 1.3, '& textarea::placeholder': { color: 'var(--text-strong)', opacity: 0.55 } } }}
        />
        <Typography sx={{ fontSize: 12, color: 'var(--text-faint)', mt: 0.25 }}>
          {draft.name.trim() ? (
            <>
              Your title.{' '}
              <Box component="button" type="button" onClick={() => setDraft((d) => ({ ...d, name: '' }))} sx={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>
                Use the start of the caption instead
              </Box>
            </>
          ) : (
            'Title: the start of the caption. Click it to rename. Only you see it.'
          )}
        </Typography>
      </Box>

      {/* Campaign, day, status */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, alignItems: 'center' }}>
        <Select
          size="small"
          value={campaigns === null && campaignValue !== NO_CAMPAIGN && !currentCampaign ? NO_CAMPAIGN : campaignValue}
          onChange={(e) => changeCampaign(String(e.target.value))}
          disabled={quickBusy || campaigns === null}
          inputProps={{ 'aria-label': 'Campaign' }}
          renderValue={(v) => {
            const c = v === NO_CAMPAIGN ? null : campaignOptions.find((x) => x._id === v) || currentCampaign;
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                <Box component="span" aria-hidden sx={{ width: 9, height: 9, borderRadius: '3px', flexShrink: 0, bgcolor: c ? campaignColor(c._id) : 'transparent', border: c ? 'none' : '1.5px dashed var(--text-faint)' }} />
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c ? 'var(--text)' : 'var(--text-muted)' }}>
                  {c ? c.name : 'No campaign'}
                </Box>
              </Box>
            );
          }}
          sx={{ minWidth: 160, maxWidth: 260, height: 34, '& .MuiSelect-select': { display: 'flex', alignItems: 'center', py: 0.5 } }}
          MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
        >
          <MenuItem value={NO_CAMPAIGN}>
            <Box>
              <Typography sx={{ fontSize: 14 }}>No campaign</Typography>
              <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>Everyday content</Typography>
            </Box>
          </MenuItem>
          {campaignOptions.length > 0 && <ListSubheader sx={{ lineHeight: '30px', fontSize: 12 }}>Campaigns</ListSubheader>}
          {campaignOptions.map((c) => {
            const owner = c.createdBy && typeof c.createdBy === 'object' && refId(c.createdBy) !== me ? [c.createdBy.firstName, c.createdBy.lastName].filter(Boolean).join(' ') : '';
            return (
              <MenuItem key={c._id} value={c._id} sx={{ gap: 1 }}>
                <Box component="span" aria-hidden sx={{ width: 9, height: 9, borderRadius: '3px', bgcolor: campaignColor(c._id), flexShrink: 0 }} />
                <Typography sx={{ fontSize: 14 }}>
                  {c.name}
                  {c.archived ? ' (archived)' : ''}
                  {isNew && owner ? <Box component="span" sx={{ color: 'var(--text-muted)' }}>{` · ${owner}`}</Box> : null}
                </Typography>
              </MenuItem>
            );
          })}
          {/* A campaign that isn't in the list yet (still loading, or another account's for admins). */}
          {currentCampaign && !campaignOptions.some((c) => c._id === refId(currentCampaign)) && (
            <MenuItem value={refId(currentCampaign)} sx={{ display: 'none' }}>
              {currentCampaign.name}
            </MenuItem>
          )}
        </Select>
        <TextField
          type="date"
          size="small"
          value={dayValue}
          onChange={(e) => changeDay(e.target.value)}
          disabled={quickBusy}
          inputProps={{ 'aria-label': 'Day it goes out' }}
          sx={{ width: 160, '& input': { py: '6.5px' } }}
        />
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
            disabled={quickBusy}
            inputProps={{ 'aria-label': 'Status' }}
            renderValue={(v) => <PostStatusChip status={v} size="xs" />}
            sx={{ minWidth: 130, height: 34, '& .MuiSelect-select': { display: 'flex', alignItems: 'center', py: 0.5 } }}
          >
            {SETTABLE_POST_STATUSES.map((s) => (
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
        {!dayValue && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>No day yet</Typography>}
        {currentCampaign && (
          <Tooltip title="Open the campaign">
            <IconButton size="small" component={RouterLink} to={paths.campaign(currentCampaign)} aria-label={`Open the campaign ${currentCampaign.name}`}>
              <OpenIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {task?.legacyTheme && (
        <Typography sx={{ fontSize: 12.5, color: 'var(--text-faint)', mt: -1.5 }}>Was in the “{task.legacyTheme}” theme (themes were retired).</Typography>
      )}

      {/* What it's about */}
      <Box component="section">
        <Label htmlFor="post-about">What’s this post about?</Label>
        <TextField
          id="post-about"
          inputRef={briefRef}
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="e.g. Hot chocolate is back from Friday. Cosy winter feel, our mugs on a wooden table."
          multiline
          minRows={2}
          maxRows={8}
          fullWidth
          helperText={aiEnabled ? 'Optional. The AI uses it to write the caption and create the picture. Only you see it.' : 'Optional. A note for you (or a designer). Only you see it.'}
          FormHelperTextProps={{ sx: { mx: 0 } }}
        />
      </Box>

      {/* Picture */}
      <PicturePanel
        task={task}
        brief={draft.description}
        title={shownTitle}
        aiEnabled={aiEnabled}
        brandLogo={brand.logoUrl}
        ensureSaved={create}
        onTask={(t) => setTask(t)}
        reload={() => load({ keepDraft: true })}
        focusBrief={() => {
          briefRef.current?.focus();
          briefRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }}
      />

      {/* Caption */}
      <Box component="section">
        <Label
          htmlFor="post-caption"
          right={
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {captionButton()}
              {!sideBySide && (
                <Button size="small" startIcon={<PreviewIcon />} onClick={() => setPreviewOpen(true)}>
                  Preview
                </Button>
              )}
            </Box>
          }
        >
          Caption
        </Label>
        <TextField
          id="post-caption"
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          placeholder="The text that gets published, with hashtags and a call to action."
          multiline
          minRows={4}
          fullWidth
          helperText={`${[...draft.content].length.toLocaleString()} characters`}
          FormHelperTextProps={{ sx: { mx: 0 } }}
        />
      </Box>

      {taskId ? (
        <TaskPublishing taskId={taskId} />
      ) : (
        <Box component="section">
          <Label>Publishing</Label>
          <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Create the post first, then schedule it here.</Typography>
        </Box>
      )}

      {taskId && (
        <Box sx={{ pt: 1, borderTop: '1px solid var(--border)' }}>
          <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmDelete(true)}>
            Delete post
          </Button>
        </Box>
      )}
    </Box>
  );

  const bar = isNew ? (
    <Box sx={barSx(variant)}>
      <Typography sx={{ flex: 1, fontSize: 14, color: 'var(--text-muted)' }}>New post · not saved yet</Typography>
      <Button size="small" onClick={() => onCancel?.()} disabled={saving}>
        Cancel
      </Button>
      <Button size="small" variant="contained" onClick={() => save()} disabled={saving || !dirty}>
        {saving ? 'Creating…' : 'Create post'}
      </Button>
    </Box>
  ) : dirty ? (
    <Box role="status" sx={barSx(variant)}>
      <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--warning)' }} />
      <Typography sx={{ flex: 1, fontSize: 14, color: 'var(--text-strong)' }}>Unsaved changes</Typography>
      <Button size="small" onClick={() => setDraft(baseline)} disabled={saving}>
        Discard
      </Button>
      <Button size="small" variant="contained" onClick={() => save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Box>
  ) : null;

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

      {bar}

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
          {captionButton()}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setPreviewOpen(false)}>Done</Button>
          {!isNew && (
            <Button
              variant="contained"
              disabled={!dirty || saving}
              onClick={async () => {
                if (await save()) setPreviewOpen(false);
              }}
            >
              Save
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this post?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            “{shownTitle}” will be deleted with its pictures and AI drafts. If it’s scheduled, it won’t go out. Copies in the Library stay. This can’t be undone.
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

const barSx = (variant: 'panel' | 'page') => ({
  position: 'sticky',
  bottom: 0,
  mt: 2,
  mx: variant === 'panel' ? -2 : 0,
  px: 2,
  py: 1.25,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  bgcolor: 'var(--bg-float)',
  borderTop: '1px solid var(--border-strong)',
  boxShadow: '0 -6px 16px rgba(0,0,0,.08)',
  zIndex: 2
});
