import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import { Close as CloseIcon, ArrowBack as BackIcon, OpenInNew as OpenIcon, Download as DownloadIcon } from '@mui/icons-material';
import { campaignAPI, taskAPI } from '../../services/api';
import { libraryAPI, librarySrc, type LibraryItem } from '../../services/library';
import { useBlueStore, type BlueDetailRef } from '../../store/blueStore';
import PostEditor from '../posts/PostEditor';
import { useUnsavedGuard } from '../posts/UnsavedGuard';
import { MetaChip, PostStatusChip } from '../ui/StatusChip';
import { campaignStatusMeta } from '../../lib/status';
import { formatDay, formatDayRange } from '../../lib/dates';
import { paths } from '../../lib/paths';
import { ImageLightbox } from './BlueSurface';

/**
 * The right-hand panel of the full-screen Blue page: whatever you clicked in the chat (a post, a
 * Library item or a campaign), so you can check or change it without leaving the
 * conversation. A post opens in the full post editor. Links inside open in the same panel (Back
 * returns); "Open page" goes to the item's own page.
 */

function day(value?: string | null): string | null {
  return value ? formatDay(value) || null : null;
}


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
// Campaign
// ---------------------------------------------------------------------------

function CampaignView({ id, preview, go }: { id: string; preview?: any; go: (ref: BlueDetailRef) => void }) {
  const c = useRecord<any>(() => campaignAPI.getById(id).then((r: any) => r.data.campaign), [id]);
  const p = useRecord<any[]>(() => taskAPI.getAll({ campaignId: id, limit: 500 }).then((r: any) => r.data.tasks || []), [id]);
  const camp: any = c.data || { name: preview?.name, status: preview?.status, startDate: preview?.start_date, endDate: preview?.end_date };
  if (!camp.name && c.loading) return <Loading />;
  if (c.error && !camp.name) return <Failed text={c.error} />;
  return (
    <>
      <Typography sx={{ fontSize: 17, fontWeight: 600, color: 'var(--text-strong)' }}>{camp.name}</Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <MetaChip meta={campaignStatusMeta(camp.archived ? 'archived' : camp.status)} />
        <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>{formatDayRange(camp.startDate, camp.endDate)}</Typography>
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
      <Section label={`Posts${p.data ? ` (${p.data.length})` : ''}`}>
        {p.loading && !p.data ? (
          <Loading small />
        ) : (p.data || []).length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>No posts yet.</Typography>
        ) : (
          (p.data as any[]).slice(0, 60).map((t) => (
            <LinkRow
              key={t._id}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Thumb src={t.designedImage} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 13, color: 'var(--text-strong)' }}>{t.name}</Typography>
                    <Typography noWrap sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{day(t.taskDate) || 'No day yet'}</Typography>
                  </Box>
                </Box>
              }
              right={<PostStatusChip status={t.status} />}
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

const LABEL: Record<BlueDetailRef['type'], string> = { task: 'Post', library: 'Library item', campaign: 'Campaign' };

export default function BlueDetail() {
  const navigate = useNavigate();
  const { detail, showDetail, closeDetail } = useBlueStore();
  const [stack, setStack] = useState<BlueDetailRef[]>([]);
  const inner = useRef(false);
  const unsaved = useUnsavedGuard();
  const bump = () => useBlueStore.setState((s) => ({ refreshKey: s.refreshKey + 1 }));

  // Opening something from the chat starts fresh; links inside the panel can go Back.
  useEffect(() => {
    if (!inner.current) setStack([]);
    inner.current = false;
  }, [detail]);

  if (!detail) return null;

  // Leaving a post with unsaved edits asks first.
  const go = (ref: BlueDetailRef) =>
    unsaved.guard(() => {
      inner.current = true;
      setStack((s) => [...s, detail]);
      showDetail(ref);
    });
  const back = () =>
    unsaved.guard(() => {
      const prev = stack[stack.length - 1];
      if (!prev) return;
      inner.current = true;
      setStack((s) => s.slice(0, -1));
      showDetail(prev);
    });
  const close = () => unsaved.guard(closeDetail);

  const pageOf = (ref: BlueDetailRef): string => {
    if (ref.type === 'task') return paths.post(ref.id);
    if (ref.type === 'library') return paths.libraryItem(ref.id);
    return paths.campaign(ref.id);
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
        <Button size="small" startIcon={<OpenIcon sx={{ fontSize: 16 }} />} onClick={() => unsaved.guard(() => navigate(pageOf(detail)))} sx={{ fontSize: 12 }}>
          Open page
        </Button>
        <Tooltip title="Close">
          <IconButton size="small" onClick={close} aria-label="Close panel">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box key={`${detail.type}:${detail.id}`} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {detail.type === 'task' && (
          <PostEditor
            taskId={detail.id}
            variant="panel"
            onDirtyChange={unsaved.setDirty}
            registerSave={unsaved.registerSave}
            onDeleted={() => {
              window.dispatchEvent(new CustomEvent('post:deleted', { detail: detail.id }));
              unsaved.reset();
              bump();
              closeDetail();
            }}
          />
        )}
        {detail.type === 'library' && <LibraryView id={detail.id} preview={detail.preview} />}
        {detail.type === 'campaign' && <CampaignView id={detail.id} preview={detail.preview} go={go} />}
      </Box>
      {unsaved.dialog}
    </Box>
  );
}
