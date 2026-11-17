import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Link,
  MenuItem,
  Snackbar,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  RestoreFromTrash as RestoreIcon,
  AutoAwesome as AiIcon,
  Upload as UploadIcon,
  History as HistoryIcon,
  OpenInNew as OpenIcon
} from '@mui/icons-material';
import { campaignAPI } from '../../services/api';
import { libraryAPI, librarySrc, formatBytes, formatItemDate, CATEGORY_LABELS, type LibraryItem, type LibraryVersionInfo } from '../../services/library';
import { KIND_ICONS } from './LibraryPage';
import EditInCanvaButton from '../../components/Canva/EditInCanvaButton';

const DATE_SOURCE_LABELS: Record<string, string> = {
  user: 'set by you',
  exif: 'from the photo',
  filename: 'from the file name',
  content: 'read from the content',
  file_modified: 'file date',
  upload: 'upload date'
};

const SOURCE_LABELS: Record<string, string> = {
  upload: 'Uploaded',
  app: 'Imported from the app',
  task: 'From a task',
  restore: 'Restored',
  zip: 'From a zip file',
  canva: 'Edited in Canva'
};

interface Draft {
  title: string;
  description: string;
  event: string;
  category: string;
  capturedAt: string;
  tags: string[];
  notes: string;
}

function draftFrom(item: LibraryItem): Draft {
  return {
    title: item.title || '',
    description: item.description || '',
    event: item.event || '',
    category: item.category || 'other',
    capturedAt: item.capturedAt ? item.capturedAt.slice(0, 10) : '',
    tags: item.tags || [],
    notes: item.notes || ''
  };
}

export default function LibraryItemPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNote, setVersionNote] = useState('');
  const [versionProgress, setVersionProgress] = useState<number | null>(null);
  const [showText, setShowText] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const apply = useCallback((next: LibraryItem) => {
    setItem(next);
    setDraft(draftFrom(next));
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      apply(await libraryAPI.get(id));
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not open this item');
    }
  }, [id, apply]);

  useEffect(() => {
    load();
  }, [load]);

  // While the AI is still reading the item, refresh until it's done.
  useEffect(() => {
    if (item?.aiStatus !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const fresh = await libraryAPI.get(item.id);
        if (fresh.aiStatus !== 'pending') apply(fresh);
      } catch {
        /* keep trying */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [item?.id, item?.aiStatus, apply]);

  useEffect(() => {
    campaignAPI
      .getAll({ limit: 100, includeArchived: true })
      .then((r) => setCampaigns((r.data?.campaigns || []).map((c: any) => ({ id: c._id || c.id, name: c.name }))))
      .catch(() => setCampaigns([]));
  }, []);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) setToast(done);
    } catch (e: any) {
      setToast(e?.response?.data?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Box>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/library')} sx={{ mb: 2 }}>
          Library
        </Button>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }
  if (!item || !draft) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  const original = draftFrom(item);
  const dirty = JSON.stringify(original) !== JSON.stringify(draft);
  const inTrash = Boolean(item.deletedAt);
  const current = item.versions?.find((v) => v.isCurrent) || null;
  const linkedCampaign = item.links.campaignId ? campaigns.find((c) => c.id === item.links.campaignId) : null;

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      (Object.keys(draft) as (keyof Draft)[]).forEach((k) => {
        if (JSON.stringify(draft[k]) !== JSON.stringify(original[k])) body[k] = draft[k];
      });
      if (body.capturedAt === '') delete body.capturedAt;
      apply(await libraryAPI.update(item.id, body));
      setToast('Saved');
    } catch (e: any) {
      setToast(e?.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const setCampaignLink = (campaignId: string | null) =>
    run(async () => apply(await libraryAPI.update(item.id, { links: campaignId ? { campaignId } : {} })), campaignId ? 'Linked' : 'Unlinked');

  const uploadVersion = async () => {
    if (!versionFile) return;
    setVersionProgress(0);
    try {
      apply(await libraryAPI.addVersion(item.id, versionFile, versionNote, setVersionProgress));
      setToast('New version added');
      setVersionFile(null);
      setVersionNote('');
    } catch (e: any) {
      setToast(e?.response?.data?.message || 'Could not add the version');
    } finally {
      setVersionProgress(null);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Button startIcon={<BackIcon />} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/library'))}>
          Library
        </Button>
        <Box sx={{ flex: 1 }} />
        {!inTrash && item.kind === 'image' && (
          <EditInCanvaButton
            target={{ target: 'library', assetId: item.id }}
            onImported={(message) => {
              setToast(message);
              load();
            }}
          />
        )}
        {!inTrash && (
          <>
            <Button startIcon={<DownloadIcon />} href={librarySrc(current?.downloadUrl) || ''} disabled={!current}>
              Download
            </Button>
            <Button startIcon={<DeleteIcon />} color="error" disabled={busy} onClick={() => run(async () => { await libraryAPI.trash(item.id); navigate('/library'); }, 'Moved to trash')}>
              Delete
            </Button>
          </>
        )}
      </Box>

      {inTrash && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" startIcon={<RestoreIcon />} disabled={busy} onClick={() => run(async () => { await libraryAPI.restore(item.id); await load(); }, 'Restored')}>
                Restore
              </Button>
              <Button
                size="small"
                color="error"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Delete "${item.title}" and all ${item.versionCount} version${item.versionCount === 1 ? '' : 's'} for good? This cannot be undone.`)) return;
                  run(async () => { await libraryAPI.purge(item.id); navigate('/library?view=trash'); }, 'Deleted for good');
                }}
              >
                Delete for good
              </Button>
            </Box>
          }
        >
          This item is in the trash and will be deleted for good 30 days after it was removed.
        </Alert>
      )}

      {item.needsReview && item.review && !inTrash && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await libraryAPI.review(item.id, 'merge');
                    navigate(`/library/${r.assetId}`, { replace: true });
                  }, 'Added as a new version')
                }
              >
                Make it a new version
              </Button>
              <Button size="small" disabled={busy} onClick={() => run(async () => { await libraryAPI.review(item.id, 'keep'); await load(); }, 'Kept separate')}>
                Keep separate
              </Button>
            </Box>
          }
        >
          This looks like another version of{' '}
          <Link component={RouterLink} to={`/library/${item.review.versionOf.assetId}`}>
            something already in your Library
          </Link>
          .
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 3fr) minmax(320px, 2fr)' }, gap: 3, alignItems: 'start' }}>
        {/* Preview */}
        <Box>
          <Preview item={item} version={current} />
          {item.aiStatus === 'pending' && (
            <Typography sx={{ mt: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AiIcon sx={{ fontSize: 14 }} /> The AI is reading this item; details will fill in shortly.
            </Typography>
          )}
          {item.aiStatus === 'failed' && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              The AI could not read this item{item.aiError ? `: ${item.aiError}` : '.'}
            </Alert>
          )}
          {item.textContent && (
            <Box sx={{ mt: 2 }}>
              <Button size="small" onClick={() => setShowText((s) => !s)}>
                {showText ? 'Hide text' : item.kind === 'image' ? 'Show text found in the image' : 'Show text'}
              </Button>
              {showText && (
                <Box sx={{ mt: 1, p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', whiteSpace: 'pre-wrap', fontSize: 'var(--fs-xs)', maxHeight: 400, overflow: 'auto' }}>
                  {item.textContent}
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* Details */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField label="Title" size="small" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} disabled={inTrash} />
          <TextField label="Description" size="small" multiline minRows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} disabled={inTrash} />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              label="Date"
              type="date"
              size="small"
              value={draft.capturedAt}
              onChange={(e) => setDraft({ ...draft, capturedAt: e.target.value })}
              InputLabelProps={{ shrink: true }}
              helperText={item.dateSource ? DATE_SOURCE_LABELS[item.dateSource] : undefined}
              sx={{ flex: 1 }}
              disabled={inTrash}
            />
            <TextField select label="Kind of work" size="small" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} sx={{ flex: 1 }} disabled={inTrash}>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <MenuItem key={k} value={k}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <TextField label="Event or occasion" size="small" placeholder="e.g. Women's Day" value={draft.event} onChange={(e) => setDraft({ ...draft, event: e.target.value })} disabled={inTrash} />
          <Autocomplete
            multiple
            freeSolo
            options={[] as string[]}
            value={draft.tags}
            onChange={(_e, value) => setDraft({ ...draft, tags: value.map((v) => v.toLowerCase().trim()).filter(Boolean) })}
            renderTags={(value, getTagProps) => value.map((tag, index) => <Chip size="small" label={tag} {...getTagProps({ index })} key={tag} />)}
            renderInput={(params) => <TextField {...params} label="Tags" size="small" placeholder="Type and press Enter" />}
            disabled={inTrash}
          />
          <TextField label="Notes" size="small" multiline minRows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} disabled={inTrash} />
          {!inTrash && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" onClick={save} disabled={!dirty || saving || !draft.title.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {dirty && <Button onClick={() => setDraft(original)}>Undo changes</Button>}
            </Box>
          )}

          {item.colors.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mr: 0.5 }}>Colours</Typography>
              {item.colors.map((c) => (
                <Tooltip key={c} title={c}>
                  <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: c, border: '1px solid var(--border)' }} />
                </Tooltip>
              ))}
            </Box>
          )}

          <Section title="Linked to">
            {item.links.taskId && (
              <LinkRow label="Task" to={`/tasks/${item.links.taskId}`} />
            )}
            {item.links.projectId && <LinkRow label="Project" to={`/projects/${item.links.projectId}`} />}
            {item.links.campaignId && <LinkRow label={linkedCampaign ? `Campaign · ${linkedCampaign.name}` : 'Campaign'} to={`/campaigns/${item.links.campaignId}`} />}
            {!inTrash && (
              <Autocomplete
                size="small"
                options={campaigns}
                getOptionLabel={(o) => o.name}
                value={linkedCampaign || null}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_e, value) => setCampaignLink(value ? value.id : null)}
                renderInput={(params) => <TextField {...params} label={item.links.campaignId || item.links.taskId ? 'Change campaign link' : 'Link to a campaign'} />}
                disabled={busy}
                sx={{ mt: 1 }}
              />
            )}
            <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', mt: 0.5 }}>Tip: ask Blue to link this to a specific task.</Typography>
          </Section>

          <Section title="Details">
            <Meta label="File" value={current ? `${current.originalName} · ${formatBytes(current.size)}${current.width ? ` · ${current.width}×${current.height}` : ''}` : '—'} />
            {item.folder && <Meta label="Folder" value={item.folder} />}
            <Meta label="Added" value={`${formatItemDate(item.createdAt)} · ${SOURCE_LABELS[item.source] || item.source}`} />
            {!inTrash && (
              <Button size="small" startIcon={<AiIcon />} disabled={busy || item.aiStatus === 'pending'} onClick={() => run(async () => { await libraryAPI.reanalyze(item.id); await load(); }, 'Queued for AI reading')} sx={{ alignSelf: 'flex-start', mt: 0.5 }}>
                Read again with AI
              </Button>
            )}
          </Section>
        </Box>
      </Box>

      {/* Versions */}
      <Box sx={{ mt: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <HistoryIcon fontSize="small" />
          <Typography sx={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)' }}>
            Versions ({item.versions?.length || 0})
          </Typography>
          <Box sx={{ flex: 1 }} />
          {!inTrash && (
            <>
              <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
                Upload new version
              </Button>
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={(e) => {
                  setVersionFile(e.target.files?.[0] || null);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {item.versions?.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              busy={busy || inTrash}
              onRestore={() => run(async () => apply(await libraryAPI.restoreVersion(item.id, v.id)), `Version ${v.number} is current again`)}
            />
          ))}
        </Box>
      </Box>

      <Dialog open={!!versionFile} onClose={() => versionProgress === null && setVersionFile(null)} fullWidth maxWidth="xs">
        <DialogTitle>Add a new version</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 'var(--fs-sm)', mb: 2 }}>
            {versionFile?.name} · {formatBytes(versionFile?.size)}
          </Typography>
          <TextField autoFocus fullWidth size="small" label="What changed? (optional)" value={versionNote} onChange={(e) => setVersionNote(e.target.value)} />
          {versionProgress !== null && <LinearProgress variant="determinate" value={versionProgress * 100} sx={{ mt: 2 }} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVersionFile(null)} disabled={versionProgress !== null}>
            Cancel
          </Button>
          <Button variant="contained" onClick={uploadVersion} disabled={versionProgress !== null}>
            Add version
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}

function Preview({ item, version }: { item: LibraryItem; version: LibraryVersionInfo | null }) {
  const src = librarySrc(version?.fileUrl || item.fileUrl);
  const mime = version?.mime || '';
  const frame = { width: '100%', borderRadius: 'var(--r-panel)', border: '1px solid var(--border)', bgcolor: 'var(--bg-subtle)' };
  if (mime.startsWith('image/') && mime !== 'image/vnd.adobe.photoshop') {
    return (
      <Box sx={{ ...frame, display: 'flex', justifyContent: 'center', p: 1 }}>
        <img src={src} alt={item.title} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
      </Box>
    );
  }
  if (mime.startsWith('video/')) return <Box component="video" src={src} controls preload="metadata" sx={{ ...frame, maxHeight: '70vh' }} />;
  if (mime.startsWith('audio/')) return <Box component="audio" src={src} controls sx={{ width: '100%' }} />;
  if (mime === 'application/pdf') return <Box component="iframe" title={item.title} src={src} sx={{ ...frame, height: '70vh' }} />;
  const thumb = librarySrc(item.thumbnailUrl);
  return (
    <Box sx={{ ...frame, minHeight: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'var(--text-faint)' }}>
      {thumb ? <img src={thumb} alt="" style={{ maxWidth: '100%', maxHeight: '60vh' }} /> : <Box sx={{ '& svg': { fontSize: 56 } }}>{KIND_ICONS[item.kind] || KIND_ICONS.other}</Box>}
      <Button size="small" startIcon={<OpenIcon />} href={src || ''} target="_blank" rel="noopener">
        Open file
      </Button>
    </Box>
  );
}

function VersionRow({ version: v, busy, onRestore }: { version: LibraryVersionInfo; busy: boolean; onRestore: () => void }) {
  const thumb = librarySrc(v.thumbnailUrl);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, border: '1px solid', borderColor: v.isCurrent ? 'var(--border-strong)' : 'var(--border)', borderRadius: 'var(--r-card)' }}>
      <Box sx={{ width: 56, height: 42, flexShrink: 0, borderRadius: 'var(--r-nav)', overflow: 'hidden', bgcolor: 'var(--bg-subtle)' }}>
        {thumb && <img src={thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)' }}>
          Version {v.number}
          {v.isCurrent && <Chip size="small" label="Current" sx={{ ml: 1, height: 18, fontSize: 'var(--fs-3xs)' }} />}
        </Typography>
        <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[
            formatItemDate(v.createdAt),
            v.restoredFrom ? `restored from version ${v.restoredFrom}` : SOURCE_LABELS[v.source || ''] || v.source,
            v.note,
            `${v.originalName} · ${formatBytes(v.size)}`
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      </Box>
      <Button size="small" href={librarySrc(v.downloadUrl) || ''}>
        Download
      </Button>
      {!v.isCurrent && (
        <Button size="small" disabled={busy} onClick={onRestore}>
          Make current
        </Button>
      )}
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ borderTop: '1px solid var(--border)', pt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</Typography>
      {children}
    </Box>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Typography sx={{ fontSize: 'var(--fs-xs)' }}>
      <Box component="span" sx={{ color: 'var(--text-muted)' }}>
        {label}:{' '}
      </Box>
      {value}
    </Typography>
  );
}

function LinkRow({ label, to }: { label: string; to: string }) {
  return (
    <Link component={RouterLink} to={to} sx={{ fontSize: 'var(--fs-sm)' }}>
      {label}
    </Link>
  );
}
