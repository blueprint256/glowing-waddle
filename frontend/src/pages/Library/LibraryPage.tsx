import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Search as SearchIcon,
  CloudUpload as UploadIcon,
  DriveFolderUpload as FolderUploadIcon,
  Sync as ImportIcon,
  Close as CloseIcon,
  ExpandMore as ExpandIcon,
  ChevronRight as CollapseIcon,
  Image as ImageIcon,
  Movie as VideoIcon,
  Audiotrack as AudioIcon,
  Description as DocIcon,
  Notes as TextIcon,
  Brush as DesignIcon,
  InsertDriveFile as FileIcon,
  AutoAwesome as AiIcon,
  History as VersionsIcon,
  Campaign as CampaignIcon
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import {
  libraryAPI,
  librarySrc,
  filesFromDrop,
  importable,
  newBatchId,
  uploadFiles,
  formatBytes,
  formatItemDate,
  KIND_LABELS,
  CATEGORY_LABELS,
  type LibraryItem,
  type LibraryOverview,
  type LibraryStatus,
  type PickedFile,
  type UploadResult,
  type BatchProgress
} from '../../services/library';
import { paths } from '../../lib/paths';
import PageHeader from '../../components/ui/PageHeader';
import { errorMessage, notify } from '../../store/toastStore';

const PAGE_SIZE = 30;

export const KIND_ICONS: Record<string, JSX.Element> = {
  image: <ImageIcon />,
  video: <VideoIcon />,
  audio: <AudioIcon />,
  document: <DocIcon />,
  text: <TextIcon />,
  design: <DesignIcon />,
  other: <FileIcon />
};

type View = 'all' | 'review' | 'trash';

interface UploadState {
  batchId: string;
  files: number;
  sent: number;
  total: number;
  results: UploadResult[];
  uploading: boolean;
  progress?: BatchProgress;
}

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [params, setParams] = useSearchParams();

  // Filters live in the URL so Back, refresh and shared links keep the view.
  const q = params.get('q') || '';
  const kind = params.get('kind') || '';
  const category = params.get('category') || '';
  const event = params.get('event') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const sort = params.get('sort') || '';
  const view = (params.get('view') as View) || 'all';
  const batchFilter = params.get('batch') || '';

  const setFilter = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState(q);
  const [openYears, setOpenYears] = useState<Record<number, boolean>>({});
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmCampaign, setConfirmCampaign] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);

  const canMakeCampaign = user?.role === UserRole.SYSTEM_ADMIN || user?.role === UserRole.HYBRID;

  const loadOverview = useCallback(async () => {
    try {
      const o = await libraryAPI.overview();
      setOverview(o);
      setOpenYears((prev) => (Object.keys(prev).length || !o.years.length ? prev : { [o.years[0].year]: true }));
    } catch {
      /* the grid shows the error */
    }
  }, []);

  useEffect(() => {
    libraryAPI
      .status()
      .then((s) => {
        setStatus(s);
        if (s.available) loadOverview();
      })
      .catch((e) => setStatusError(e?.response?.data?.message || 'Could not open the Library'));
  }, [loadOverview]);

  const query = useMemo(
    () => ({
      q: q || undefined,
      kind: kind || undefined,
      category: category || undefined,
      event: event || undefined,
      from: from || undefined,
      to: to || undefined,
      sort: (sort || undefined) as any,
      needsReview: view === 'review',
      trash: view === 'trash',
      batchId: batchFilter || undefined,
      limit: PAGE_SIZE
    }),
    [q, kind, category, event, from, to, sort, view, batchFilter]
  );

  const load = useCallback(
    async (pageToLoad: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await libraryAPI.search({ ...query, page: pageToLoad });
        setItems((prev) => (pageToLoad === 1 ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
        setPage(pageToLoad);
      } catch (e: any) {
        setError(e?.response?.data?.message || 'Could not load the Library');
      } finally {
        setLoading(false);
      }
    },
    [query]
  );

  useEffect(() => {
    if (status?.available) load(1);
  }, [status?.available, load]);

  // Debounced search box → URL
  useEffect(() => setSearchText(q), [q]);
  useEffect(() => {
    if (searchText === q) return;
    const t = setTimeout(() => setFilter({ q: searchText.trim() || null }), 350);
    return () => clearTimeout(t);
  }, [searchText, q, setFilter]);

  // While the AI is reading a batch, poll its progress and refresh the grid as items finish.
  useEffect(() => {
    if (!upload || upload.uploading || upload.progress?.done) return;
    let stop = false;
    const tick = async () => {
      try {
        const progress = await libraryAPI.progress(upload.batchId);
        if (stop) return;
        setUpload((u) => (u && u.batchId === progress.batchId ? { ...u, progress } : u));
        if (progress.done) {
          load(1);
          loadOverview();
        }
      } catch {
        /* try again next tick */
      }
    };
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [upload?.batchId, upload?.uploading, upload?.progress?.done, load, loadOverview]);

  const startUpload = useCallback(
    async (picked: PickedFile[]) => {
      const files = importable(picked);
      if (!files.length) {
        notify('Nothing to import there');
        return;
      }
      const tooBig = status ? files.filter((f) => f.file.size > status.maxFileBytes) : [];
      const ok = files.filter((f) => !tooBig.includes(f));
      const batchId = newBatchId();
      const controller = new AbortController();
      abortRef.current = controller;
      const preFailed: UploadResult[] = tooBig.map((f) => ({ name: f.relativePath, status: 'failed', error: `Larger than ${formatBytes(status?.maxFileBytes)}` }));
      setUpload({ batchId, files: files.length, sent: 0, total: ok.reduce((s, f) => s + f.file.size, 0), results: preFailed, uploading: true });
      await uploadFiles(ok, {
        batchId,
        signal: controller.signal,
        onProgress: (sent, totalBytes) => setUpload((u) => (u && u.batchId === batchId ? { ...u, sent, total: totalBytes } : u)),
        onResults: (results) => setUpload((u) => (u && u.batchId === batchId ? { ...u, results: [...u.results, ...results] } : u))
      });
      abortRef.current = null;
      setUpload((u) => (u && u.batchId === batchId ? { ...u, uploading: false } : u));
      load(1);
      loadOverview();
    },
    [status, load, loadOverview]
  );

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    startUpload(list.map((file) => ({ file, relativePath: (file as any).webkitRelativePath || file.name })));
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!status?.available || view === 'trash') return;
    startUpload(await filesFromDrop(e.dataTransfer));
  };

  const importFromApp = async () => {
    setBusy(true);
    try {
      const res = await libraryAPI.importApp();
      notify(res.message);
      setUpload({ batchId: res.batchId, files: 0, sent: 0, total: 0, results: [], uploading: false });
    } catch (e) {
      notify(errorMessage(e, 'Could not start the import.'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const makeCampaign = async () => {
    setConfirmCampaign(false);
    if (!event) return;
    const year = from ? Number(from.slice(0, 4)) : undefined;
    setBusy(true);
    try {
      const res = await libraryAPI.makeCampaign(event, year);
      notify(`Created "${res.campaign.name}" and linked ${res.linked} item${res.linked === 1 ? '' : 's'}`);
      navigate(paths.campaign(res.campaign.id));
    } catch (e) {
      notify(errorMessage(e, 'Could not create the campaign.'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (statusError) return <Alert severity="error">{statusError}</Alert>;
  if (!status) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }
  if (!status.available) {
    return (
      <Box>
        <PageHeader title="Library" />
        <Alert severity="info">{status.reason || 'The Library isn’t available on your account.'}</Alert>
      </Box>
    );
  }

  const hasFilters = Boolean(q || kind || category || event || from || to || batchFilter);
  const activeMonth = from && to ? `${from.slice(0, 7)}` : '';
  const uploadedCount = upload?.results.filter((r) => r.status === 'created' || r.status === 'version_added').length || 0;
  const duplicateCount = upload?.results.filter((r) => r.status === 'duplicate').length || 0;
  const failed = upload?.results.filter((r) => r.status === 'failed') || [];

  return (
    <Box
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={onDrop}
      sx={{ position: 'relative', minHeight: '70vh' }}
    >
      {dragging && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            border: '2px dashed var(--link)',
            borderRadius: 'var(--r-panel)',
            bgcolor: 'var(--glass-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none'
          }}
        >
          <Typography sx={{ fontSize: 'var(--fs-lg)', color: 'var(--text-strong)' }}>Drop files or folders to add them to your Library</Typography>
        </Box>
      )}

      {/* Header */}
      <PageHeader
        title="Library"
        subtitle={
          <>
            {overview ? `${overview.total.toLocaleString()} item${overview.total === 1 ? '' : 's'}` : 'Your pictures, captions, logos and files, with every version.'}
            {status.ai.enabled && status.ai.monthlyLimit > 0 && ` · AI reading ${status.ai.usedThisMonth.toLocaleString()} of ${status.ai.monthlyLimit.toLocaleString()} this month`}
            {!status.ai.enabled && ' · AI reading is off (search uses file names, folders and text in files)'}
          </>
        }
        actions={
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<UploadIcon />} onClick={() => fileInput.current?.click()} disabled={upload?.uploading}>
            Upload files
          </Button>
          <Button variant="outlined" startIcon={<FolderUploadIcon />} onClick={() => folderInput.current?.click()} disabled={upload?.uploading}>
            Upload folder
          </Button>
          <Tooltip title="Bring in the post images, AI images, logos and files already in the app">
            <span>
              <Button variant="outlined" startIcon={<ImportIcon />} onClick={importFromApp} disabled={busy || upload?.uploading}>
                Import from app
              </Button>
            </span>
          </Tooltip>
          <input ref={fileInput} type="file" multiple hidden onChange={onPick} />
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            onChange={onPick}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
        </Box>
        }
      />

      {/* Upload / processing progress */}
      {upload && (
        <Box sx={{ mb: 2, p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-raised)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 'var(--fs-sm)', flex: 1 }}>
              {upload.uploading
                ? `Uploading ${upload.files} file${upload.files === 1 ? '' : 's'} · ${formatBytes(upload.sent)} of ${formatBytes(upload.total)}`
                : upload.progress && !upload.progress.done
                  ? `AI is reading your files · ${upload.progress.processed} of ${upload.progress.total} done`
                  : upload.progress?.done
                    ? `Import finished · ${upload.progress.total} item${upload.progress.total === 1 ? '' : 's'} ready${upload.progress.needsReview ? ` · ${upload.progress.needsReview} to review` : ''}`
                    : 'Import started…'}
              {!upload.uploading && upload.files > 0 && (
                <Box component="span" sx={{ color: 'var(--text-muted)' }}>
                  {` · ${uploadedCount} added`}
                  {duplicateCount ? ` · ${duplicateCount} already in your Library` : ''}
                  {failed.length ? ` · ${failed.length} failed` : ''}
                </Box>
              )}
            </Typography>
            {!upload.uploading && (upload.progress?.total || 0) > 0 && (
              <Button size="small" onClick={() => setFilter({ batch: upload.batchId, view: null })}>
                Show these
              </Button>
            )}
            <IconButton
              size="small"
              aria-label={upload.uploading ? 'Cancel upload' : 'Close'}
              onClick={() => {
                abortRef.current?.abort();
                setUpload(null);
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <LinearProgress
            sx={{ mt: 1, borderRadius: 2 }}
            variant={upload.uploading || upload.progress ? 'determinate' : 'indeterminate'}
            value={
              upload.uploading
                ? (upload.sent / Math.max(1, upload.total)) * 100
                : upload.progress
                  ? (upload.progress.processed / Math.max(1, upload.progress.total)) * 100
                  : 0
            }
          />
          {failed.length > 0 && !upload.uploading && (
            <Box sx={{ mt: 1, maxHeight: 120, overflow: 'auto' }}>
              {failed.slice(0, 50).map((f, i) => (
                <Typography key={i} sx={{ fontSize: 'var(--fs-xs)', color: 'var(--danger-text)' }}>
                  {f.name}: {f.error}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        {/* Timeline tree */}
        <Box
          component="nav"
          aria-label="Library timeline"
          sx={{ width: 210, flexShrink: 0, display: { xs: 'none', md: 'block' }, position: 'sticky', top: 8, maxHeight: 'calc(100vh - 120px)', overflow: 'auto' }}
        >
          <TreeRow label="Everything" count={overview?.total} active={!from && !to && !event} onClick={() => setFilter({ from: null, to: null, event: null })} />
          {overview?.years.map((y) => (
            <Box key={y.year}>
              <TreeRow
                label={String(y.year)}
                count={y.count}
                expandable
                open={!!openYears[y.year]}
                onToggle={() => setOpenYears((o) => ({ ...o, [y.year]: !o[y.year] }))}
                active={from === `${y.year}-01-01` && to === `${y.year}-12-31` && !event}
                onClick={() => setFilter({ from: `${y.year}-01-01`, to: `${y.year}-12-31`, event: null })}
              />
              {openYears[y.year] &&
                y.months.map((m) => {
                  const r = monthRange(y.year, m.month);
                  return (
                    <Box key={m.month} sx={{ pl: 2 }}>
                      <TreeRow label={m.name} count={m.count} active={from === r.from && to === r.to && !event} onClick={() => setFilter({ ...r, event: null })} />
                      {m.events.map((ev) => (
                        <Box key={ev.name} sx={{ pl: 2 }}>
                          <TreeRow
                            label={ev.name}
                            count={ev.count}
                            subtle
                            active={event === ev.name && from === r.from}
                            onClick={() => setFilter({ ...r, event: ev.name })}
                          />
                        </Box>
                      ))}
                    </Box>
                  );
                })}
            </Box>
          ))}
          {overview && overview.topEvents.length > 0 && (
            <>
              <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', textTransform: 'uppercase', mt: 2, mb: 0.5, px: 1 }}>Events</Typography>
              {overview.topEvents.slice(0, 12).map((ev) => (
                <TreeRow key={ev.name} label={ev.name} count={ev.count} active={event === ev.name && !from} onClick={() => setFilter({ event: ev.name, from: null, to: null })} />
              ))}
            </>
          )}
        </Box>

        {/* Results */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Tabs value={view} onChange={(_e, v) => setFilter({ view: v === 'all' ? null : v })} sx={{ mb: 1.5, minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}>
            <Tab value="all" label="All items" />
            <Tab value="review" label={`Needs review${overview?.needsReview ? ` (${overview.needsReview})` : ''}`} />
            <Tab value="trash" label={`Trash${overview?.inTrash ? ` (${overview.inTrash})` : ''}`} />
          </Tabs>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            <TextField
              size="small"
              placeholder={status.semanticSearch ? 'Search by words or meaning, e.g. "pink women\'s day picture"' : 'Search titles, text in images, captions, tags…'}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              sx={{ flex: 1, minWidth: 220 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                )
              }}
            />
            <TextField select size="small" value={kind} onChange={(e) => setFilter({ kind: e.target.value || null })} sx={{ minWidth: 140 }} SelectProps={{ displayEmpty: true }}>
              <MenuItem value="">All types</MenuItem>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <MenuItem key={k} value={k}>
                  {label}
                  {overview?.kinds[k] ? ` (${overview.kinds[k]})` : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" value={category} onChange={(e) => setFilter({ category: e.target.value || null })} sx={{ minWidth: 140 }} SelectProps={{ displayEmpty: true }}>
              <MenuItem value="">Any kind of work</MenuItem>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <MenuItem key={k} value={k}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" value={sort} onChange={(e) => setFilter({ sort: e.target.value || null })} sx={{ minWidth: 130 }} SelectProps={{ displayEmpty: true }}>
              <MenuItem value="">{q ? 'Best match' : 'Newest first'}</MenuItem>
              <MenuItem value="oldest">Oldest first</MenuItem>
              <MenuItem value="recent">Recently changed</MenuItem>
            </TextField>
          </Box>

          {(hasFilters || event) && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
              {activeMonth && <Chip size="small" label={from.slice(5) === '01-01' && to.slice(5) === '12-31' ? from.slice(0, 4) : `${from} → ${to}`} onDelete={() => setFilter({ from: null, to: null })} />}
              {event && <Chip size="small" label={`Event: ${event}`} onDelete={() => setFilter({ event: null })} />}
              {kind && <Chip size="small" label={KIND_LABELS[kind] || kind} onDelete={() => setFilter({ kind: null })} />}
              {category && <Chip size="small" label={CATEGORY_LABELS[category] || category} onDelete={() => setFilter({ category: null })} />}
              {batchFilter && <Chip size="small" label="This import" onDelete={() => setFilter({ batch: null })} />}
              {q && <Chip size="small" label={`“${q}”`} onDelete={() => setFilter({ q: null })} />}
              <Button size="small" onClick={() => setParams(view === 'all' ? {} : { view }, { replace: true })}>
                Clear all
              </Button>
              {event && canMakeCampaign && view === 'all' && (
                <Button size="small" variant="outlined" startIcon={<CampaignIcon />} onClick={() => setConfirmCampaign(true)} disabled={busy} sx={{ ml: 'auto' }}>
                  Make this a past campaign
                </Button>
              )}
            </Box>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {!loading && !error && items.length === 0 && (
            <EmptyState view={view} filtered={hasFilters} totalInLibrary={overview?.total || 0} onUpload={() => fileInput.current?.click()} />
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 1.5 }}>
            {items.map((item) => (
              <ItemCard key={item.id} item={item} onOpen={() => navigate(paths.libraryItem(item.id))} />
            ))}
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            {loading ? (
              <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
            ) : (
              items.length < total && (
                <Button onClick={() => load(page + 1)}>
                  Show more ({(total - items.length).toLocaleString()} left)
                </Button>
              )
            )}
          </Box>
        </Box>
      </Box>

      <Dialog open={confirmCampaign} onClose={() => setConfirmCampaign(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Make “{event}” a past campaign?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            A finished campaign called “{event}{from ? ` ${from.slice(0, 4)}` : ''}” is created and these items are linked to it. They stay in your Library.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCampaign(false)}>Cancel</Button>
          <Button variant="contained" onClick={makeCampaign} disabled={busy}>
            Create campaign
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function TreeRow(props: {
  label: string;
  count?: number;
  active?: boolean;
  subtle?: boolean;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onClick: () => void;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        height: 28,
        px: 0.5,
        borderRadius: 'var(--r-nav)',
        cursor: 'pointer',
        bgcolor: props.active ? 'var(--bg-hover)' : 'transparent',
        color: props.active ? 'var(--text-strong)' : props.subtle ? 'var(--text-muted)' : 'var(--text)',
        fontSize: props.subtle ? 'var(--fs-xs)' : 'var(--fs-sm)',
        '&:hover': { bgcolor: 'var(--bg-hover)' }
      }}
      onClick={props.onClick}
      role="button"
      aria-pressed={props.active}
    >
      {props.expandable ? (
        <IconButton
          size="small"
          sx={{ p: 0.25 }}
          aria-label={props.open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle?.();
          }}
        >
          {props.open ? <ExpandIcon sx={{ fontSize: 16 }} /> : <CollapseIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      ) : (
        <Box sx={{ width: 4 }} />
      )}
      <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {props.label}
      </Box>
      {props.count !== undefined && (
        <Box component="span" sx={{ color: 'var(--text-faint)', fontSize: 'var(--fs-2xs)' }}>
          {props.count.toLocaleString()}
        </Box>
      )}
    </Box>
  );
}

export function ItemCard({ item, onOpen }: { item: LibraryItem; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const thumb = !broken && librarySrc(item.thumbnailUrl);
  return (
    <Box
      component="button"
      onClick={onOpen}
      sx={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-card)',
        overflow: 'hidden',
        bgcolor: 'var(--bg-raised)',
        transition: 'border-color var(--t-fast)',
        '&:hover, &:focus-visible': { borderColor: 'var(--border-strong)' }
      }}
    >
      <Box sx={{ position: 'relative', aspectRatio: '4 / 3', bgcolor: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : item.kind === 'text' && item.textPreview ? (
          <Typography sx={{ p: 1.5, fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', overflow: 'hidden', height: '100%', boxSizing: 'border-box', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
            {item.textPreview}
          </Typography>
        ) : (
          <Box sx={{ '& svg': { fontSize: 40 } }}>{KIND_ICONS[item.kind] || KIND_ICONS.other}</Box>
        )}
        <Box sx={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 0.5 }}>
          {item.aiStatus === 'pending' && <Badge icon={<AiIcon sx={{ fontSize: 12 }} />} label="Reading" />}
          {item.aiStatus === 'failed' && <Badge label="AI failed" danger />}
          {item.needsReview && <Badge label="Review" />}
          {item.versionCount > 1 && <Badge icon={<VersionsIcon sx={{ fontSize: 12 }} />} label={`v${item.currentVersion?.number ?? item.versionCount}`} />}
        </Box>
      </Box>
      <Box sx={{ p: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>
          {item.title}
        </Typography>
        <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[formatItemDate(item.capturedAt), item.event || CATEGORY_LABELS[item.category]].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
    </Box>
  );
}

function Badge({ label, icon, danger }: { label: string; icon?: JSX.Element; danger?: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        px: 0.75,
        height: 18,
        borderRadius: 'var(--r-full)',
        fontSize: 'var(--fs-3xs)',
        fontWeight: 'var(--fw-semibold)',
        bgcolor: danger ? 'var(--danger-solid)' : 'rgba(0,0,0,.6)',
        color: '#fff'
      }}
    >
      {icon}
      {label}
    </Box>
  );
}

function EmptyState({ view, filtered, totalInLibrary, onUpload }: { view: View; filtered: boolean; totalInLibrary: number; onUpload: () => void }) {
  if (view === 'trash') return <Hint text="The trash is empty. Deleted items stay here for 30 days." />;
  if (view === 'review') return <Hint text="Nothing to review. When an upload looks like a new version of something you already have, it shows up here." />;
  if (filtered) return <Hint text="Nothing matches. Try fewer words, another date or clear the filters." />;
  if (totalInLibrary > 0) return <Hint text="Your items are still being processed." />;
  return (
    <Box sx={{ textAlign: 'center', py: 8, border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-panel)' }}>
      <UploadIcon sx={{ fontSize: 40, color: 'var(--text-faint)' }} />
      <Typography sx={{ fontSize: 'var(--fs-md)', mt: 1 }}>Bring all your past work into one place</Typography>
      <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mt: 0.5, mb: 2, maxWidth: 460, mx: 'auto' }}>
        Drop posters, photos, logos, captions, drafts, videos, whole folders or zip files here. Each file is dated, read and indexed so you and Blue can find it later.
      </Typography>
      <Button variant="contained" onClick={onUpload}>
        Choose files
      </Button>
    </Box>
  );
}

function Hint({ text }: { text: string }) {
  return <Typography sx={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', textAlign: 'center', py: 6 }}>{text}</Typography>;
}

