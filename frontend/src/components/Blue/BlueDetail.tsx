import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, CircularProgress, IconButton, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import {
  Close as CloseIcon,
  ArrowBack as BackIcon,
  OpenInNew as OpenIcon,
  Visibility as PreviewIcon,
  Download as DownloadIcon,
  CalendarMonth as CalendarIcon
} from '@mui/icons-material';
import api, { campaignAPI, projectAPI, taskAPI } from '../../services/api';
import { libraryAPI, librarySrc, type LibraryItem } from '../../services/library';
import { useBlueStore, type BlueDetailRef } from '../../store/blueStore';
import SocialPreviewModal from '../SocialPreviewModal';
import { ImageLightbox } from './BlueSurface';

/**
 * The right-hand panel of the full-screen Blue page: whatever you clicked in the chat (a task, a
 * Library item, a campaign or a project), with its image, details and the main actions, so you can
 * check or change it without leaving the conversation. Links inside open in the same panel (Back
 * returns); "Open page" goes to the item's normal screen.
 */

const STATUS = ['Pending', 'In Progress', 'Completed'];

function day(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function range(a?: string | null, b?: string | null) {
  return [day(a), day(b)].filter(Boolean).join(' – ') || null;
}

const idOf = (v: any): string | undefined => (v && typeof v === 'object' ? v._id || v.id : v) || undefined;

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</Typography>
      {children}
    </Box>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <Typography sx={{ fontSize: 13.5, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</Typography>;
}

function BigImage({ src, title, caption }: { src?: string | null; title: string; caption?: ReactNode }) {
  const [zoom, setZoom] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!src) return null;
  if (broken) {
    return (
      <Box sx={{ bgcolor: 'var(--bg-subtle)', borderRadius: 'var(--r-card)', py: 5, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        This image couldn’t be loaded.
      </Box>
    );
  }
  return (
    <>
      <Box
        component="img"
        src={src}
        alt={title}
        onError={() => setBroken(true)}
        onClick={() => setZoom(true)}
        sx={{ width: '100%', maxHeight: 420, objectFit: 'contain', bgcolor: 'var(--bg-subtle)', borderRadius: 'var(--r-card)', cursor: 'zoom-in', display: 'block' }}
      />
      {zoom && <ImageLightbox src={src} title={title} caption={caption} onClose={() => setZoom(false)} />}
    </>
  );
}

function LinkRow({ label, onClick, right }: { label: ReactNode; onClick?: () => void; right?: ReactNode }) {
  return (
    <Box
      onClick={onClick}
      role={onClick ? 'link' : undefined}
      tabIndex={onClick ? 0 : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, borderRadius: 'var(--r-ctl)', minWidth: 0,
        cursor: onClick ? 'pointer' : 'default', '&:hover': onClick ? { bgcolor: 'var(--bg-hover)' } : undefined
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-strong)' }}>{label}</Box>
      {right}
    </Box>
  );
}

function Thumb({ src }: { src?: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <Box sx={{ width: 32, height: 32, borderRadius: 'var(--r-ctl)', overflow: 'hidden', bgcolor: 'var(--bg-subtle)', flexShrink: 0 }}>
      {src && !broken && <img src={src} alt="" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </Box>
  );
}

function SmallStatus({ status }: { status?: string }) {
  if (!status) return null;
  return <Chip size="small" label={status.replace(/_/g, ' ')} sx={{ height: 20, fontSize: 11, textTransform: 'capitalize' }} />;
}

/** Loads a record; keeps showing what the chat already knew while it loads. */
function useRecord<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e?.response?.data?.message || 'Couldn’t load this.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, error, loading, reload: () => setVersion((v) => v + 1), setData };
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

function TaskView({ id, preview, go }: { id: string; preview?: any; go: (ref: BlueDetailRef) => void }) {
  const { data, error, loading, setData } = useRecord<any>(() => taskAPI.getById(id).then((r: any) => r.data.task), [id]);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);
  const bump = () => useBlueStore.setState((s) => ({ refreshKey: s.refreshKey + 1 }));

  const t: any = data || {
    name: preview?.name,
    status: preview?.status,
    taskDate: preview?.task_date,
    content: preview?.content,
    description: preview?.description,
    designedImage: preview?.designed_image_url
  };

  const setStatus = async (status: string) => {
    setSaving(true);
    try {
      const res = await taskAPI.update(id, { status });
      setData(res.data.task || { ...t, status });
      bump();
    } finally {
      setSaving(false);
    }
  };

  const poster = async (action: 'adopt' | 'discard') => {
    setPosterBusy(true);
    try {
      const res = await api.patch(`/tasks/${id}/${action}-poster`);
      setData(res.data.task || { ...t, pendingGeneratedImage: undefined });
      bump();
    } finally {
      setPosterBusy(false);
    }
  };

  if (!t.name && loading) return <Loading />;
  if (error && !t.name) return <Failed text={error} />;

  const project = t.projectId && typeof t.projectId === 'object' ? t.projectId : preview?.project;
  const campaign = t.campaignId && typeof t.campaignId === 'object' ? t.campaignId : preview?.campaign;

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography sx={{ flex: 1, fontSize: 17, fontWeight: 600, color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{t.name}</Typography>
        {loading && <CircularProgress size={14} sx={{ mt: 0.75, color: 'var(--text-muted)' }} />}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Select
          size="small"
          value={STATUS.includes(t.status) ? t.status : ''}
          onChange={(e) => setStatus(String(e.target.value))}
          disabled={saving || !data}
          sx={{ fontSize: 13, height: 30, minWidth: 140 }}
          inputProps={{ 'aria-label': 'Status' }}
        >
          {STATUS.map((s) => (
            <MenuItem key={s} value={s} sx={{ fontSize: 13 }}>
              {s}
            </MenuItem>
          ))}
        </Select>
        {day(t.taskDate) && (
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CalendarIcon sx={{ fontSize: 15 }} />
            {day(t.taskDate)}
          </Typography>
        )}
      </Box>

      <BigImage src={t.designedImage} title={t.name} caption={t.content} />

      {t.pendingGeneratedImage && (
        <Section label="New AI poster (not used yet)">
          <BigImage src={t.pendingGeneratedImage} title={`${t.name} — new poster`} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="contained" disabled={posterBusy} onClick={() => poster('adopt')}>
              Use this poster
            </Button>
            <Button size="small" variant="outlined" disabled={posterBusy} onClick={() => poster('discard')}>
              Discard
            </Button>
          </Box>
        </Section>
      )}

      {t.content && (
        <Section label="Post copy">
          <Body>{t.content}</Body>
        </Section>
      )}
      {t.description && (
        <Section label="Brief">
          <Body>{t.description}</Body>
        </Section>
      )}

      {(project || campaign) && (
        <Section label="Part of">
          {campaign && idOf(campaign) && (
            <LinkRow label={<>Campaign · {campaign.name}</>} onClick={() => go({ type: 'campaign', id: idOf(campaign)!, preview: campaign })} />
          )}
          {project && idOf(project) && (
            <LinkRow label={<>Project · {project.name}</>} onClick={() => go({ type: 'project', id: idOf(project)!, preview: project })} />
          )}
        </Section>
      )}

      {(t.content || t.designedImage) && (
        <Box>
          <Button size="small" startIcon={<PreviewIcon sx={{ fontSize: 16 }} />} onClick={() => setShowPreview(true)}>
            Preview post
          </Button>
        </Box>
      )}
      {showPreview && (
        <SocialPreviewModal
          open={showPreview}
          onClose={() => setShowPreview(false)}
          task={{ _id: id, name: t.name, description: t.description, content: t.content, designedImage: t.designedImage, taskDate: t.taskDate }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Library item
// ---------------------------------------------------------------------------

function LibraryView({ id, preview }: { id: string; preview?: any }) {
  const { data, error, loading } = useRecord<LibraryItem>(() => libraryAPI.get(id), [id]);
  const item: any = data || { title: preview?.title, kind: preview?.kind, description: preview?.description, tags: preview?.tags || [] };
  if (!item.title && loading) return <Loading />;
  if (error && !item.title) return <Failed text={error} />;
  const mime: string = data?.currentVersion?.mime || '';
  const file = librarySrc(`/api/library/items/${id}/file`);
  const versions = data?.versions || [];

  return (
    <>
      <Typography sx={{ fontSize: 17, fontWeight: 600, color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{item.title}</Typography>
      {item.kind === 'image' || mime.startsWith('image/') ? (
        <BigImage src={file} title={item.title} caption={item.description} />
      ) : mime.startsWith('video/') ? (
        <Box component="video" src={file} controls preload="metadata" sx={{ width: '100%', maxHeight: 420, borderRadius: 'var(--r-card)', bgcolor: '#000' }} />
      ) : data?.thumbnailUrl ? (
        <BigImage src={librarySrc(data.thumbnailUrl)} title={item.title} />
      ) : null}

      <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        {[day(data?.capturedAt), item.event, data?.versionCount && data.versionCount > 1 ? `version ${data.currentVersion?.number} of ${data.versionCount}` : null]
          .filter(Boolean)
          .join(' · ')}
      </Typography>

      {item.description && (
        <Section label="Description">
          <Body>{item.description}</Body>
        </Section>
      )}
      {data?.textContent && (
        <Section label="Text in it">
          <Body>{data.textContent.slice(0, 600)}</Body>
        </Section>
      )}
      {(item.tags || []).length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {(item.tags as string[]).slice(0, 16).map((tag) => (
            <Chip key={tag} size="small" label={tag} sx={{ height: 22, fontSize: 11.5 }} />
          ))}
        </Box>
      )}
      {versions.length > 1 && (
        <Section label="Versions">
          {versions.slice(0, 8).map((v) => (
            <LinkRow
              key={v.id}
              label={`v${v.number}${v.isCurrent ? ' (current)' : ''}${v.note ? ` · ${v.note}` : ''}`}
              right={<Typography sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{day(v.createdAt)}</Typography>}
            />
          ))}
        </Section>
      )}
      {data && (
        <Box>
          <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 16 }} />} href={librarySrc(`/api/library/items/${id}/file?variant=download`) || '#'}>
            Download
          </Button>
        </Box>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Campaign and project
// ---------------------------------------------------------------------------

function CampaignView({ id, preview, go }: { id: string; preview?: any; go: (ref: BlueDetailRef) => void }) {
  const c = useRecord<any>(() => campaignAPI.getById(id).then((r: any) => r.data.campaign), [id]);
  const p = useRecord<any[]>(() => projectAPI.getAll({ campaignId: id, limit: 200 }).then((r: any) => r.data.projects || []), [id]);
  const camp: any = c.data || { name: preview?.name, status: preview?.status, startDate: preview?.start_date, endDate: preview?.end_date };
  if (!camp.name && c.loading) return <Loading />;
  if (c.error && !camp.name) return <Failed text={c.error} />;
  return (
    <>
      <Typography sx={{ fontSize: 17, fontWeight: 600, color: 'var(--text-strong)' }}>{camp.name}</Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <SmallStatus status={camp.archived ? 'archived' : camp.status} />
        <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>{range(camp.startDate, camp.endDate)}</Typography>
      </Box>
      {camp.description && (
        <Section label="About">
          <Body>{camp.description}</Body>
        </Section>
      )}
      {camp.coreMessages && (
        <Section label="Core messages">
          <Body>{camp.coreMessages}</Body>
        </Section>
      )}
      <Section label={`Projects${p.data ? ` (${p.data.length})` : ''}`}>
        {p.loading && !p.data ? (
          <Loading small />
        ) : (p.data || []).length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>No projects yet.</Typography>
        ) : (
          (p.data as any[]).map((proj) => (
            <LinkRow
              key={proj._id}
              label={proj.name}
              right={<SmallStatus status={proj.status} />}
              onClick={() => go({ type: 'project', id: proj._id, preview: { name: proj.name, status: proj.status } })}
            />
          ))
        )}
      </Section>
    </>
  );
}

function ProjectView({ id, preview, go }: { id: string; preview?: any; go: (ref: BlueDetailRef) => void }) {
  const pr = useRecord<any>(() => projectAPI.getById(id).then((r: any) => r.data.project), [id]);
  const ts = useRecord<any[]>(() => taskAPI.getAll({ projectId: id, limit: 500 }).then((r: any) => r.data.tasks || []), [id]);
  const proj: any = pr.data || { name: preview?.name, status: preview?.status };
  if (!proj.name && pr.loading) return <Loading />;
  if (pr.error && !proj.name) return <Failed text={pr.error} />;
  const campaign = proj.campaignId && typeof proj.campaignId === 'object' ? proj.campaignId : null;
  return (
    <>
      <Typography sx={{ fontSize: 17, fontWeight: 600, color: 'var(--text-strong)' }}>{proj.name}</Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <SmallStatus status={proj.status} />
        <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>{range(proj.startDate, proj.dueDate)}</Typography>
      </Box>
      {campaign && (
        <LinkRow label={<>Campaign · {campaign.name}</>} onClick={() => go({ type: 'campaign', id: idOf(campaign)!, preview: campaign })} />
      )}
      {proj.description && (
        <Section label="About">
          <Body>{proj.description}</Body>
        </Section>
      )}
      <Section label={`Tasks${ts.data ? ` (${ts.data.length})` : ''}`}>
        {ts.loading && !ts.data ? (
          <Loading small />
        ) : (ts.data || []).length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>No tasks yet.</Typography>
        ) : (
          (ts.data as any[]).map((t) => (
            <LinkRow
              key={t._id}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Thumb src={t.designedImage} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 13, color: 'var(--text-strong)' }}>{t.name}</Typography>
                    <Typography noWrap sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{day(t.taskDate)}</Typography>
                  </Box>
                </Box>
              }
              right={<SmallStatus status={t.status} />}
              onClick={() => go({ type: 'task', id: t._id, preview: { name: t.name, status: t.status, designed_image_url: t.designedImage } })}
            />
          ))
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function Loading({ small }: { small?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: small ? 1 : 6 }}>
      <CircularProgress size={18} sx={{ color: 'var(--text-muted)' }} />
    </Box>
  );
}

function Failed({ text }: { text: string }) {
  return <Typography sx={{ fontSize: 13, color: 'var(--danger-text)', py: 2 }}>{text}</Typography>;
}

const PAGE: Record<BlueDetailRef['type'], (id: string) => string> = {
  task: (id) => `/tasks/${id}`,
  library: (id) => `/library/${id}`,
  campaign: (id) => `/campaigns/${id}`,
  project: (id) => `/projects/${id}`
};

const LABEL: Record<BlueDetailRef['type'], string> = { task: 'Task', library: 'Library item', campaign: 'Campaign', project: 'Project' };

export default function BlueDetail() {
  const navigate = useNavigate();
  const { detail, showDetail, closeDetail } = useBlueStore();
  const [stack, setStack] = useState<BlueDetailRef[]>([]);
  const inner = useRef(false);

  // Opening something from the chat starts fresh; links inside the panel can go Back.
  useEffect(() => {
    if (!inner.current) setStack([]);
    inner.current = false;
  }, [detail]);

  if (!detail) return null;

  const go = (ref: BlueDetailRef) => {
    inner.current = true;
    setStack((s) => [...s, detail]);
    showDetail(ref);
  };
  const back = () => {
    const prev = stack[stack.length - 1];
    if (!prev) return;
    inner.current = true;
    setStack((s) => s.slice(0, -1));
    showDetail(prev);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, height: 48, borderBottom: '1px solid var(--border)', flex: '0 0 auto' }}>
        {stack.length > 0 && (
          <Tooltip title="Back">
            <IconButton size="small" onClick={back} aria-label="Back">
              <BackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', pl: stack.length ? 0 : 0.5 }}>{LABEL[detail.type]}</Typography>
        <Button size="small" startIcon={<OpenIcon sx={{ fontSize: 16 }} />} onClick={() => navigate(PAGE[detail.type](detail.id))} sx={{ fontSize: 12 }}>
          Open page
        </Button>
        <Tooltip title="Close">
          <IconButton size="small" onClick={closeDetail} aria-label="Close panel">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box key={`${detail.type}:${detail.id}`} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {detail.type === 'task' && <TaskView id={detail.id} preview={detail.preview} go={go} />}
        {detail.type === 'library' && <LibraryView id={detail.id} preview={detail.preview} />}
        {detail.type === 'campaign' && <CampaignView id={detail.id} preview={detail.preview} go={go} />}
        {detail.type === 'project' && <ProjectView id={detail.id} preview={detail.preview} go={go} />}
      </Box>
    </Box>
  );
}
