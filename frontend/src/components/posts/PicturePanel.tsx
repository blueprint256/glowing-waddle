import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/material';
import {
  AutoAwesome as AIIcon,
  CloudUploadOutlined as UploadIcon,
  PhotoLibraryOutlined as LibraryIcon,
  MoreHoriz as MoreIcon,
  DeleteOutline as DeleteIcon,
  Add as AddIcon,
  ImageOutlined as ImageIcon,
  Brush as ChangeIcon,
  History as EarlierIcon,
  ExpandMore as OpenIcon,
  ExpandLess as CloseSectionIcon,
  EditOutlined as EditIcon
} from '@mui/icons-material';
import { taskAPI, userAPI, type AIUsage } from '../../services/api';
import { errorMessage, notify } from '../../store/toastStore';
import { announcePostChanged, isRunning, useAIJobsStore } from '../../store/aiJobsStore';
import { formatAgo } from '../../lib/dates';
import type { PostAIDraft, PostReference, ReferenceRole, Task } from '../../types';
import LibraryImagePicker from './LibraryImagePicker';
import ImageViewer from '../ui/ImageViewer';
import EditInCanvaButton from '../Canva/EditInCanvaButton';
import CreateWithAI, { type CreateMode } from './CreateWithAI';
import PosterEditor from './PosterEditor';
import { designAPI, type DesignCatalog } from '../../services/design';
import { posterRunning, usePosterJobsStore } from '../../store/posterJobsStore';

/**
 * A post's picture (Post v2):
 * - the current picture, AI drafts not chosen yet (kept 7 days) and up to 3 earlier pictures,
 *   all in one strip; click one to look at it, then use, change or discard it
 * - Upload, From the Library, Edit in Canva
 * - Create with AI (CreateWithAI.tsx): a poster (the design engine: real words, logo files and
 *   partners, checked, every line editable) or a photo with no words, from "What's this post
 *   about?", the brand and the pictures given
 * - Changing what you're looking at: a poster opens the poster editor (type on it, or describe a
 *   change); a photo takes a sentence that edits it, keeping the rest
 * Nothing replaces the picture until you choose "Use this picture".
 */

const MAX_REFERENCES = 6;
const DRAFT_DAYS = 7;
const MAX_UPLOAD = 15 * 1024 * 1024;

type Viewing = { kind: 'current' } | { kind: 'draft'; id: string } | { kind: 'earlier'; url: string };

const ROLE_TEXT: Record<ReferenceRole, { label: string; hint: string }> = {
  include: { label: 'Include this', hint: 'A product, place or person to show as it is' },
  style: { label: 'Copy this style', hint: 'Layout, colours and mood only; its words, logos and people aren’t copied' }
};

function daysLeft(at: string): number {
  const ms = new Date(at).getTime() + DRAFT_DAYS * 86400000 - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function draftLabel(d: PostAIDraft): string {
  if (d.kind === 'design') return d.from ? 'Changed poster' : 'Poster option';
  if (d.kind === 'change') return d.prompt ? `Change: ${d.prompt}` : 'Changed picture';
  return 'New AI picture';
}

/** What each tappable part of a poster is called. */
const AREA_NAME: Record<string, string> = {
  eyebrow: 'the line above the headline',
  headline: 'the headline',
  subhead: 'the line under the headline',
  body: 'the text',
  cta: 'the call to action',
  footnote: 'the small print',
  hashtag: 'the hashtag',
  sponsorsTitle: 'the words above the partner logos',
  details: 'the details',
  stats: 'the figures',
  personLabel: 'the person’s part',
  personName: 'the name',
  personRole: 'the role',
  social: 'the handle',
  web: 'the website',
  badge: 'the date badge'
};

const isPicture = (f: File) => /^image\/(png|jpe?g|webp|gif)$/i.test(f.type);

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, minHeight: 30 }}>
      <Typography component="h3" sx={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {children}
      </Typography>
      {right}
    </Box>
  );
}

export interface PicturePanelProps {
  /** The saved post, or null while it's a new post not created yet. */
  task: Task | null;
  /** "What's this post about?" as typed (saved or not): what Create image works from. */
  brief: string;
  /** The title, for messages ("AI picture ready for …"). */
  title: string;
  aiEnabled: boolean;
  brandLogo: string | null;
  /** For a new post: creates it first and returns its id (null if it couldn't be created). */
  ensureSaved: () => Promise<string | null>;
  /** A response brought the updated post. */
  onTask: (task: Task) => void;
  /** Reload the post (after Canva). */
  reload: () => void;
  /** Focus "What's this post about?" (when Create needs it). */
  focusBrief: () => void;
}

export default function PicturePanel({ task, brief, title, aiEnabled, brandLogo, ensureSaved, onTask, reload, focusBrief }: PicturePanelProps) {
  const taskId = task?._id || null;
  const job = useAIJobsStore((s) => (taskId ? s.images[taskId] : undefined));
  const changeImage = useAIJobsStore((s) => s.changeImage);
  const clearJob = useAIJobsStore((s) => s.clear);
  const running = isRunning(job);
  const posterJob = usePosterJobsStore((s) => (taskId ? s.jobs[taskId] : undefined));
  const resumePoster = usePosterJobsStore((s) => s.resume);
  const clearPoster = usePosterJobsStore((s) => s.clear);
  const posterBusy = posterRunning(posterJob);

  const drafts = task?.aiDrafts || [];
  const earlier = task?.imageHistory || [];
  const references = task?.references || [];
  const current = task?.designedImage || null;

  const [viewing, setViewing] = useState<Viewing>({ kind: 'current' });
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('poster');
  const [instruction, setInstruction] = useState('');
  const [picker, setPicker] = useState<'picture' | 'reference' | null>(null);
  const [refRole, setRefRole] = useState<ReferenceRole>('include');
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [now, setNow] = useState(Date.now());
  const [dragging, setDragging] = useState(false);
  const [editOpen, setEditOpen] = useState(true);
  const [editFocus, setEditFocus] = useState<{ field: string; at: number } | null>(null);
  const [catalog, setCatalog] = useState<DesignCatalog | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refFileRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLInputElement>(null);

  // The post's saved choices once it's loaded, or when another post is shown. A new post that
  // just got created keeps what was chosen on screen.
  const shownId = useRef<string | null>(taskId);
  const optionsLoaded = useRef(Boolean(task));
  useEffect(() => {
    const switched = shownId.current !== null && shownId.current !== taskId;
    const firstLoad = !optionsLoaded.current && Boolean(task) && shownId.current !== null;
    shownId.current = taskId;
    if (task) optionsLoaded.current = true;
    if (!switched && !firstLoad) return;
    setViewing({ kind: 'current' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, Boolean(task)]);

  // What's being looked at disappeared (used, discarded, expired): back to the current picture.
  const viewed = useMemo(() => {
    if (viewing.kind === 'draft') {
      const d = drafts.find((x) => x.id === viewing.id);
      if (d) return { kind: 'draft' as const, url: d.url, draft: d };
    }
    if (viewing.kind === 'earlier') {
      const e = earlier.find((x) => x.url === viewing.url);
      if (e) return { kind: 'earlier' as const, url: e.url, at: e.at };
    }
    return current ? { kind: 'current' as const, url: current } : null;
  }, [viewing, drafts, earlier, current]);

  // A finished job: show its picture.
  useEffect(() => {
    if (!taskId || job?.state !== 'done' || !job.draft) return;
    if (drafts.some((d) => d.id === job.draft!.id)) {
      setViewing({ kind: 'draft', id: job.draft.id });
      clearJob(taskId);
    }
  }, [job, drafts, taskId, clearJob]);

  // A poster being made for this post (started here, elsewhere, or before a reload): follow it.
  useEffect(() => {
    if (taskId && aiEnabled) resumePoster(taskId, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, aiEnabled]);

  // Poster options ready: show the best one.
  useEffect(() => {
    if (!taskId || posterJob?.status !== 'done') return;
    const first = posterJob.draftIds[0];
    if (!first || drafts.some((d) => d.id === first)) {
      if (first) setViewing({ kind: 'draft', id: first });
      setCreateOpen(false);
      setEditOpen(true);
      clearPoster(taskId);
    }
  }, [posterJob, drafts, taskId, clearPoster]);

  // The designs, for the poster editor (once).
  const hasPosters = Boolean(task?.pictureDesign) || drafts.some((d) => d.kind === 'design');
  useEffect(() => {
    if (hasPosters && !catalog) designAPI.catalog().then(setCatalog).catch(() => undefined);
  }, [hasPosters, catalog]);

  // Ticks while a job runs, for the elapsed time.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const seconds = running && job ? Math.max(0, Math.round((now - job.startedAt) / 1000)) : 0;

  // How many AI pictures are left this month (shown under the button).
  const loadUsage = () => {
    userAPI
      .myAIUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  };
  useEffect(() => {
    if (aiEnabled && createOpen) loadUsage();
  }, [aiEnabled, createOpen, job?.state, posterJob?.status]);

  const apply = (res: any, message?: string) => {
    if (res?.data?.task) onTask(res.data.task);
    if (taskId) announcePostChanged(taskId);
    if (message) notify(message);
  };

  const act = async (key: string, fn: (id: string) => Promise<void>, failMessage: string) => {
    setBusy(key);
    try {
      const id = taskId || (await ensureSaved());
      if (id) await fn(id);
    } catch (e) {
      notify(errorMessage(e, failMessage), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // ---- Picture actions -------------------------------------------------------------------------

  const uploadFile = (file: File | undefined) => {
    if (!file) return;
    if (!isPicture(file)) return notify('Choose a picture (PNG, JPG, WebP or GIF).', { tone: 'error' });
    if (file.size > MAX_UPLOAD) return notify('That picture is over 15 MB. Choose a smaller one.', { tone: 'error' });
    act(
      'upload',
      async (id) => {
        const form = new FormData();
        form.append('image', file);
        apply(await taskAPI.uploadImage(id, form), current ? 'Picture replaced. The previous one is under Earlier.' : 'Picture added');
        setViewing({ kind: 'current' });
      },
      'Couldn’t upload the picture.'
    );
  };

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    uploadFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    uploadFile(Array.from(e.dataTransfer.files || []).find(isPicture));
  };

  const use = (url: string, message: string) =>
    act(
      `use:${url}`,
      async (id) => {
        apply(await taskAPI.useImage(id, url), message);
        setViewing({ kind: 'current' });
      },
      'Couldn’t update the picture.'
    );

  const discard = (draft: PostAIDraft) =>
    act(
      `discard:${draft.id}`,
      async (id) => {
        apply(await taskAPI.discardDraft(id, draft.id), 'AI picture discarded');
        setViewing({ kind: 'current' });
      },
      'Couldn’t discard the AI picture.'
    );

  const removePicture = () =>
    act(
      'remove',
      async (id) => {
        apply(await taskAPI.removeImage(id), 'Picture removed. You can bring it back from Earlier.');
        setViewing({ kind: 'current' });
      },
      'Couldn’t remove the picture.'
    );

  const change = async () => {
    const text = instruction.trim();
    if (!text || !viewed || !taskId) return;
    const logo = task?.pictureOptions?.logo || null;
    const res = await changeImage(taskId, title, { instruction: text, from: viewed.url, logo: logo && brandLogo ? logo : null });
    if (res.state === 'done') setInstruction('');
  };

  // ---- References ------------------------------------------------------------------------------

  const addReferenceFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isPicture(file)) return notify('Choose a picture (PNG, JPG, WebP or GIF).', { tone: 'error' });
    if (file.size > MAX_UPLOAD) return notify('That picture is over 15 MB. Choose a smaller one.', { tone: 'error' });
    act('ref:add', async (id) => apply(await taskAPI.addReferenceFile(id, file, refRole)), 'Couldn’t add the reference picture.');
  };

  const addReferenceUrl = (url: string, role: ReferenceRole) =>
    act('ref:add', async (id) => apply(await taskAPI.addReference(id, { url, role })), 'Couldn’t add the reference picture.');

  const setRole = (ref: PostReference, role: ReferenceRole) =>
    act(`ref:${ref.id}`, async (id) => apply(await taskAPI.updateReference(id, ref.id, { role })), 'Couldn’t update the reference picture.');

  const removeRef = (ref: PostReference) =>
    act(`ref:${ref.id}`, async (id) => apply(await taskAPI.removeReference(id, ref.id)), 'Couldn’t remove the reference picture.');

  const openAddReference = (role: ReferenceRole, anchor: HTMLElement) => {
    setRefRole(role);
    setAddAnchor(anchor);
  };

  // ---- Render ------------------------------------------------------------------------------------

  const imagesLeft = usage && !usage.unlimited && usage.images.limit > 0 ? usage.images.remaining ?? 0 : null;
  const outOfImages = imagesLeft !== null && imagesLeft <= 0;
  const changeRunning = running && job?.kind === 'change';
  const createRunning = running && job?.kind === 'create';
  const viewedIsBeingChanged = changeRunning && job?.from && viewed?.url === job.from;
  const strip = [
    ...(current ? [{ key: 'current', url: current, label: 'Current picture', select: { kind: 'current' } as Viewing, tag: 'Now', earlier: false }] : []),
    ...drafts.map((d) => ({ key: `draft:${d.id}`, url: d.url, label: draftLabel(d), select: { kind: 'draft', id: d.id } as Viewing, tag: d.kind === 'design' ? 'Poster' : 'AI', earlier: false })),
    ...earlier.map((e, i) => ({ key: `earlier:${i}`, url: e.url, label: `Earlier picture (${formatAgo(e.at)})`, select: { kind: 'earlier', url: e.url } as Viewing, tag: '', earlier: true }))
  ];
  const viewedDesign = viewed?.kind === 'draft' ? viewed.draft.design || null : viewed?.kind === 'current' ? task?.pictureDesign || null : null;
  const posterRef = viewed?.kind === 'draft' ? viewed.draft.id : 'current';
  const siblings = viewed?.kind === 'draft' && viewed.draft.design?.jobId ? drafts.filter((d) => d.design?.jobId === viewed.draft.design!.jobId) : [];
  const editable = Boolean(aiEnabled && taskId && viewedDesign);
  const tapAreas = editable && editOpen ? (viewedDesign?.areas || []) : [];
  const onPosterDraft = (draft: PostAIDraft, message: string) => {
    if (task) onTask({ ...task, aiDrafts: [draft, ...drafts.filter((d) => d.id !== draft.id)] });
    setViewing({ kind: 'draft', id: draft.id });
    if (taskId) announcePostChanged(taskId);
    notify(message);
  };
  const isViewed = (v: Viewing) =>
    (v.kind === 'current' && viewed?.kind === 'current') ||
    (v.kind === 'draft' && viewed?.kind === 'draft' && viewed.draft.id === v.id) ||
    (v.kind === 'earlier' && viewed?.kind === 'earlier' && viewed.url === v.url);

  return (
    <Box component="section" aria-label="Picture">
      <SectionLabel
        right={
          current ? (
            <>
              <IconButton size="small" aria-label="More picture options" onClick={(e) => setMoreAnchor(e.currentTarget)}>
                <MoreIcon fontSize="small" />
              </IconButton>
              <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
                {aiEnabled && (
                  <MenuItem
                    onClick={() => {
                      setMoreAnchor(null);
                      setCreateOpen(true);
                      addReferenceUrl(current, 'style');
                    }}
                    disabled={references.length >= MAX_REFERENCES || references.some((r) => r.url === current)}
                  >
                    <ListItemIcon>
                      <AddIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary="Use as a style reference" secondary="For new AI photos" />
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    setMoreAnchor(null);
                    removePicture();
                  }}
                >
                  <ListItemIcon>
                    <DeleteIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Remove picture" secondary="You can bring it back from Earlier" />
                </MenuItem>
              </Menu>
            </>
          ) : undefined
        }
      >
        Picture
      </SectionLabel>

      {/* What's being looked at */}
      <Box
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        sx={{
          position: 'relative',
          borderRadius: 'var(--r-card)',
          border: viewed ? `1px solid ${viewed.kind === 'draft' ? 'var(--st-scheduled-dot)' : 'var(--border)'}` : '1px dashed var(--border-strong)',
          outline: dragging ? '2px solid var(--focus, #3b82f6)' : 'none',
          bgcolor: 'var(--bg-subtle)',
          overflow: 'hidden'
        }}
      >
        {viewed && tapAreas.length > 0 ? (
          // A poster: the picture at its own proportions, with each line tappable to change it.
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
              <Box component="button" type="button" onClick={() => setViewer(viewed.url)} aria-label="See the poster full size" sx={{ all: 'unset', display: 'block', cursor: 'zoom-in' }}>
                <Box component="img" src={viewed.url} alt={viewed.kind === 'draft' ? draftLabel(viewed.draft) : title} sx={{ maxWidth: '100%', maxHeight: 420, display: 'block' }} />
              </Box>
              {tapAreas.map((a) => (
                <Tooltip key={a.field} title={`Change ${AREA_NAME[a.field] || 'this'}`} placement="top">
                  <Box
                    component="button"
                    type="button"
                    aria-label={`Change ${AREA_NAME[a.field] || 'this line'}`}
                    onClick={() => {
                      setEditOpen(true);
                      setEditFocus({ field: a.field, at: Date.now() });
                    }}
                    sx={{
                      all: 'unset', position: 'absolute', cursor: 'text', borderRadius: '3px',
                      left: `calc(${a.x * 100}% - 3px)`, top: `calc(${a.y * 100}% - 3px)`, width: `calc(${a.w * 100}% + 6px)`, height: `calc(${a.h * 100}% + 6px)`,
                      '&:hover, &:focus-visible': { outline: '2px dashed rgba(255,255,255,.95)', boxShadow: '0 0 0 1px rgba(0,0,0,.55), inset 0 0 0 1px rgba(0,0,0,.35)', bgcolor: 'rgba(255,255,255,.08)' }
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
          </Box>
        ) : viewed ? (
          <Box
            component="button"
            type="button"
            onClick={() => setViewer(viewed.url)}
            aria-label="See the picture full size"
            sx={{ all: 'unset', display: 'block', width: '100%', cursor: 'zoom-in' }}
          >
            <Box component="img" src={viewed.url} alt={viewed.kind === 'draft' ? draftLabel(viewed.draft) : title} sx={{ width: '100%', maxHeight: 420, objectFit: 'contain', display: 'block' }} />
          </Box>
        ) : (
          <Box sx={{ py: 5, px: 2, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            <ImageIcon sx={{ fontSize: 34, display: 'block', mx: 'auto', mb: 0.75, color: 'var(--text-faint)' }} />
            {dragging ? 'Drop the picture here' : 'No picture yet. Upload one, drop it here, pick one from the Library, or create one with AI.'}
          </Box>
        )}

        {viewed && viewed.kind !== 'current' && (
          <Box sx={{ position: 'absolute', top: 8, left: 8, px: 1, py: 0.25, borderRadius: 99, fontSize: 12, fontWeight: 600, bgcolor: 'rgba(0,0,0,.66)', color: '#fff' }}>
            {viewed.kind === 'draft' ? (viewed.draft.kind === 'design' ? 'Poster · not used yet' : 'AI picture · not used yet') : 'Earlier picture'}
          </Box>
        )}

        {(createRunning || viewedIsBeingChanged) && (
          <Box role="status" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: 'rgba(0,0,0,.45)', color: '#fff', textAlign: 'center', p: 2 }}>
            <Box>
              <CircularProgress size={26} sx={{ color: '#fff', mb: 1 }} />
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{createRunning ? 'Creating the picture…' : 'Changing the picture…'} {seconds}s</Typography>
              <Typography sx={{ fontSize: 12.5, opacity: 0.85 }}>Usually 20–60 seconds. You can keep working or close the post.</Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* Actions for what's being looked at */}
      {viewed?.kind === 'draft' && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
          <Button size="small" variant="contained" disabled={Boolean(busy)} onClick={() => use(viewed.url, viewedDesign ? 'Poster in use (also saved in the Library)' : 'Picture updated (also saved in the Library)')}>
            {busy === `use:${viewed.url}` ? 'Saving…' : viewedDesign ? 'Use this poster' : 'Use this picture'}
          </Button>
          {editable && (
            <Button size="small" startIcon={<EditIcon />} onClick={() => setEditOpen((o) => !o)} aria-expanded={editOpen}>
              {editOpen ? 'Hide editing' : 'Edit'}
            </Button>
          )}
          {aiEnabled && !viewedDesign && (
            <Button size="small" startIcon={<ChangeIcon />} disabled={running} onClick={() => changeRef.current?.focus()}>
              Change it
            </Button>
          )}
          <Button size="small" disabled={Boolean(busy)} onClick={() => discard(viewed.draft)} sx={{ color: 'var(--text-muted)' }}>
            Discard
          </Button>
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', ml: 'auto' }}>
            {siblings.length > 1 ? `Option ${siblings.findIndex((d) => d.id === viewed.draft.id) + 1} of ${siblings.length} · ` : ''}
            {viewed.draft.kind === 'change' || viewed.draft.from ? 'Changed' : 'Made'} {formatAgo(viewed.draft.at)} · deleted in {daysLeft(viewed.draft.at)} day{daysLeft(viewed.draft.at) === 1 ? '' : 's'} if not used
          </Typography>
        </Box>
      )}
      {viewed?.kind === 'current' && editable && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
          <Button size="small" startIcon={<EditIcon />} onClick={() => setEditOpen((o) => !o)} aria-expanded={editOpen}>
            {editOpen ? 'Hide editing' : 'Edit poster'}
          </Button>
          {editOpen && <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Tap a line on the poster to change it.</Typography>}
        </Box>
      )}
      {viewed?.kind === 'earlier' && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
          <Button size="small" variant="contained" disabled={Boolean(busy)} onClick={() => use(viewed.url, 'Earlier picture brought back')}>
            {busy === `use:${viewed.url}` ? 'Saving…' : 'Bring this back'}
          </Button>
          <Button size="small" onClick={() => setViewing({ kind: 'current' })} sx={{ color: 'var(--text-muted)' }}>
            Back to the current picture
          </Button>
        </Box>
      )}

      {/* All the post's pictures */}
      {strip.length > 1 && (
        <Box role="list" aria-label="This post’s pictures" sx={{ display: 'flex', gap: 0.75, mt: 1.25, overflowX: 'auto', pb: 0.5 }}>
          {strip.map((s, i) => {
            const firstEarlier = s.earlier && !strip[i - 1]?.earlier;
            return (
              <Box key={s.key} role="listitem" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                {firstEarlier && (
                  <Tooltip title="Earlier pictures (the last 3 are kept)">
                    <EarlierIcon aria-label="Earlier pictures" sx={{ fontSize: 18, color: 'var(--text-faint)', ml: 0.5 }} />
                  </Tooltip>
                )}
                <Tooltip title={s.label}>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => setViewing(s.select)}
                    aria-label={s.label}
                    aria-current={isViewed(s.select) ? 'true' : undefined}
                    sx={{
                      all: 'unset', cursor: 'pointer', position: 'relative', width: 64, height: 64, borderRadius: 'var(--r-ctl)', overflow: 'hidden', bgcolor: 'var(--bg-subtle)',
                      outline: isViewed(s.select) ? '2px solid var(--text-strong)' : '1px solid var(--border)', outlineOffset: isViewed(s.select) ? 1 : 0,
                      '&:focus-visible': { outline: '2px solid var(--focus, #3b82f6)' }
                    }}
                  >
                    <img src={s.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {s.tag && (
                      <Box component="span" sx={{ position: 'absolute', left: 3, bottom: 3, px: 0.5, borderRadius: 1, fontSize: 10, fontWeight: 700, lineHeight: '15px', bgcolor: s.tag === 'Now' ? 'rgba(0,0,0,.66)' : 'var(--st-scheduled-dot)', color: '#fff' }}>
                        {s.tag}
                      </Box>
                    )}
                  </Box>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Ways to add a picture */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.25 }}>
        <Button size="small" startIcon={busy === 'upload' ? <CircularProgress size={14} /> : <UploadIcon />} disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
          {current ? 'Replace' : 'Upload'}
        </Button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onUpload} />
        <Button
          size="small"
          startIcon={<LibraryIcon />}
          disabled={Boolean(busy)}
          onClick={async () => {
            if (taskId || (await ensureSaved())) setPicker('picture');
          }}
        >
          From the Library
        </Button>
        {aiEnabled && (
          <Button
            size="small"
            startIcon={posterBusy || createRunning ? <CircularProgress size={14} /> : <AIIcon />}
            endIcon={createOpen ? <CloseSectionIcon /> : <OpenIcon />}
            onClick={() => setCreateOpen((o) => !o)}
            aria-expanded={createOpen || posterBusy || createRunning}
            aria-controls="create-with-ai"
          >
            {posterBusy ? `Designing… ${Math.round((posterJob?.progress || 0) * 100)}%` : createRunning ? 'Creating photo…' : 'Create with AI'}
          </Button>
        )}
        {taskId && current && (
          <EditInCanvaButton
            target={{ target: 'task', taskId }}
            onImported={(message) => {
              notify(message);
              reload();
              announcePostChanged(taskId);
            }}
          />
        )}
      </Box>

      {/* Change the picture being looked at */}
      {editable && editOpen && viewedDesign && taskId && (
        <PosterEditor taskId={taskId} posterRef={posterRef} design={viewedDesign} catalog={catalog} focus={editFocus} onDraft={onPosterDraft} />
      )}

      {/* Create with AI: a poster or a photo */}
      {aiEnabled && (createOpen || posterBusy || createRunning) && (
        <CreateWithAI
          task={task}
          title={title}
          brief={brief}
          brandLogo={brandLogo}
          usage={usage}
          mode={posterBusy ? 'poster' : createRunning ? 'photo' : createMode}
          onMode={setCreateMode}
          busy={busy}
          ensureSaved={ensureSaved}
          focusBrief={focusBrief}
          onAddPicture={(anchor, role) => openAddReference(role, anchor)}
          onRemovePicture={removeRef}
          onSetRole={setRole}
          onView={setViewer}
        />
      )}

      {aiEnabled && viewed && taskId && !viewedDesign && (
        <Box sx={{ mt: 1.5 }}>
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              change();
            }}
            sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
          >
            <TextField
              inputRef={changeRef}
              size="small"
              fullWidth
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={viewed.kind === 'draft' ? 'Change this AI picture… e.g. “make the background a sunset”' : 'Change this picture… e.g. “replace the mountain with a soft waterfall”'}
              inputProps={{ 'aria-label': 'What to change in the picture', maxLength: 2000 }}
              disabled={running || outOfImages}
            />
            <Button type="submit" variant="outlined" startIcon={changeRunning ? <CircularProgress size={14} /> : <ChangeIcon />} disabled={!instruction.trim() || running || outOfImages} sx={{ flexShrink: 0, height: 40 }}>
              Change
            </Button>
          </Box>
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 0.5 }}>
            Keeps everything else the same. You’ll see the result next to this one and choose.
            {changeRunning && !viewedIsBeingChanged ? ' A change is being made on another picture.' : ''}
          </Typography>
        </Box>
      )}

      {/* Adding a picture for Create with AI */}
      <input ref={refFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={addReferenceFile} />
      <Menu anchorEl={addAnchor} open={Boolean(addAnchor)} onClose={() => setAddAnchor(null)}>
        <Box sx={{ px: 2, pt: 0.5, pb: 1, maxWidth: 300 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', mb: 0.75 }}>How the AI should use it</Typography>
          <ToggleButtonGroup size="small" exclusive fullWidth value={refRole} onChange={(_, v) => v && setRefRole(v)} sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontSize: 12.5 } }}>
            <ToggleButton value="include">Include this</ToggleButton>
            <ToggleButton value="style">Copy this style</ToggleButton>
          </ToggleButtonGroup>
          <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.75 }}>{ROLE_TEXT[refRole].hint}.</Typography>
        </Box>
        <MenuItem
          onClick={() => {
            setAddAnchor(null);
            refFileRef.current?.click();
          }}
        >
          <ListItemIcon>
            <UploadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Upload a picture" />
        </MenuItem>
        <MenuItem
          onClick={async () => {
            setAddAnchor(null);
            if (taskId || (await ensureSaved())) setPicker('reference');
          }}
        >
          <ListItemIcon>
            <LibraryIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="From the Library" />
        </MenuItem>
        {current && !references.some((r) => r.url === current) && (
          <MenuItem
            onClick={() => {
              setAddAnchor(null);
              addReferenceUrl(current, refRole);
            }}
          >
            <ListItemIcon>
              <ImageIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="This post’s current picture" />
          </MenuItem>
        )}
      </Menu>

      {taskId && (
        <LibraryImagePicker
          open={picker !== null}
          taskId={taskId}
          campaignId={task?.campaignId && typeof task.campaignId === 'object' ? task.campaignId._id : task?.campaignId || undefined}
          ownerId={task?.ownerId ? String(task.ownerId) : undefined}
          title={picker === 'reference' ? `Add a picture to ${refRole === 'style' ? 'copy the style of' : 'include'}` : 'Choose from the Library'}
          onClose={() => setPicker(null)}
          onUsed={() => {
            reload();
            announcePostChanged(taskId);
            setViewing({ kind: 'current' });
          }}
          onPick={
            picker === 'reference'
              ? async (item) => {
                  const res = await taskAPI.addReference(taskId, { libraryAssetId: item.id, role: refRole });
                  apply(res, refRole === 'style' ? 'Style picture added' : 'Picture added');
                }
              : undefined
          }
        />
      )}

      <ImageViewer src={viewer} title={title} onClose={() => setViewer(null)} />
    </Box>
  );
}
