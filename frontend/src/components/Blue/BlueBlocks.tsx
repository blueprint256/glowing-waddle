import { useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import {
  CheckCircleOutline as DoneIcon,
  ErrorOutline as ErrorIcon,
  CalendarMonth as CalendarIcon,
  OpenInNew as OpenIcon,
  ChatBubbleOutline as CommentIcon,
  TaskAlt as MarkDoneIcon,
  ImageOutlined as ImageIcon
} from '@mui/icons-material';
import BlueText from './BlueText';
import type { BlueItem } from '../../services/blue';
import { librarySrc } from '../../services/library';
import { taskAPI } from '../../services/api';
import { useBlueStore } from '../../store/blueStore';
import { ImageLightbox, useBlueOpen, useBlueSurface } from './BlueSurface';
import { MetaChip } from '../ui/StatusChip';
import { campaignStatusMeta, postStatusMeta, publishStatusMeta, themeStatusMeta, toPostStatus, type StatusMeta } from '../../lib/status';
import { announcePostChanged } from '../../store/aiJobsStore';
import { paths } from '../../lib/paths';

/**
 * Turns Blue's tool results into the chat's standard layouts:
 * - lists (posts, scheduled copies, campaigns, themes, users) → compact tables, one row per item
 * - one item (a post, a Library item, a new AI image) → a card with the image large
 * - images → a gallery; clicking shows the full image (side panel) or opens it on the right (full screen)
 * - numbers (AI usage, Inbox, setup) → small tiles
 * Every row and card opens the item in the app.
 */

type ToolItem = Extract<BlueItem, { kind: 'tool' }>;

const ROWS = 8;

/** Dates are stored as UTC midnight, so format in UTC to avoid showing the day before. */
function day(value?: string | null, withWeekday = true): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { ...(withWeekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function dateTime(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function range(start?: string | null, end?: string | null): string | null {
  const a = day(start, false);
  const b = day(end, false);
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

function libDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

type ChipKind = 'post' | 'campaign' | 'theme' | 'publish';

const PLAIN: Record<string, StatusMeta> = {
  inactive: { label: 'Inactive', hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' },
  reconnect: { label: 'Reconnect', hint: 'Sign in to this account again', bg: 'var(--st-attention-bg)', fg: 'var(--st-attention-fg)', dot: 'var(--st-attention-dot)' },
  failed: { label: 'Failed', hint: '', bg: 'var(--st-attention-bg)', fg: 'var(--st-attention-fg)', dot: 'var(--st-attention-dot)' }
};

/** The same status chips as the rest of the app, by what the status belongs to. */
function StatusChip({ status, kind }: { status?: string; kind?: ChipKind }) {
  if (!status) return null;
  const meta =
    kind === 'post'
      ? postStatusMeta(status)
      : kind === 'campaign'
        ? campaignStatusMeta(status)
        : kind === 'theme'
          ? themeStatusMeta(status)
          : kind === 'publish'
            ? publishStatusMeta(status)
            : PLAIN[status] || { label: status.replace(/_/g, ' '), hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' };
  return (
    <Box sx={{ flexShrink: 0 }}>
      <MetaChip meta={meta} size="xs" />
    </Box>
  );
}

function Card({ children, onOpen, accent }: { children: ReactNode; onOpen?: () => void; accent?: string }) {
  return (
    <Box
      sx={{
        border: '1px solid var(--border)',
        borderLeft: accent ? `3px solid ${accent}` : '1px solid var(--border)',
        borderRadius: accent ? 0 : 'var(--r-card)',
        bgcolor: 'var(--bg-raised)',
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        cursor: onOpen ? 'pointer' : 'default',
        transition: 'border-color var(--t-fast)',
        '&:hover': onOpen ? { borderColor: 'var(--border-strong)' } : undefined
      }}
      onClick={onOpen}
      role={onOpen ? 'link' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (onOpen && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {children}
    </Box>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <Typography component="div" sx={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{children}</Typography>;
}

function Title({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.35, minWidth: 0, overflowWrap: 'anywhere' }}>
      {children}
    </Typography>
  );
}

/** A square image with a quiet placeholder when there's none (or it fails to load). */
function Thumb({ src, size, label }: { src?: string | null; size: number | string; label?: string }) {
  const [broken, setBroken] = useState(false);
  const show = src && !broken;
  return (
    <Box
      sx={{
        width: size, aspectRatio: '1 / 1', flexShrink: 0, borderRadius: 'var(--r-nav, 6px)', overflow: 'hidden',
        bgcolor: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)'
      }}
    >
      {show ? (
        <img src={src!} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : label ? (
        <Typography sx={{ fontSize: 10, textTransform: 'uppercase' }}>{label}</Typography>
      ) : (
        <ImageIcon sx={{ fontSize: 16 }} />
      )}
    </Box>
  );
}

/** A large image inside a card; click to see it full size. */
function HeroImage({ src, title, caption }: { src?: string | null; title?: string; caption?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const [zoom, setZoom] = useState(false);
  if (!src || broken) return null;
  return (
    <>
      <Box
        component="img"
        src={src}
        alt=""
        onError={() => setBroken(true)}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          setZoom(true);
        }}
        sx={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 'var(--r-ctl)', mt: 0.5, cursor: 'zoom-in', display: 'block' }}
      />
      {zoom && (
        <Box onClick={(e) => e.stopPropagation()}>
          <ImageLightbox src={src} title={title} caption={caption} onClose={() => setZoom(false)} openUrl={null} />
        </Box>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function Table({ head, children, footer }: { head?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Box sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-raised)', overflow: 'hidden' }}>
      {head && (
        <Box sx={{ px: 1.25, py: 0.75, borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{head}</Box>
      )}
      {children}
      {footer && <Box sx={{ px: 1.25, py: 0.75, borderTop: '1px solid var(--border)' }}>{footer}</Box>}
    </Box>
  );
}

function Row({ onOpen, children }: { onOpen?: () => void; children: ReactNode }) {
  return (
    <Box
      onClick={onOpen}
      role={onOpen ? 'link' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (onOpen && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, minWidth: 0,
        cursor: onOpen ? 'pointer' : 'default',
        '& + &': { borderTop: '1px solid var(--border)' },
        '&:hover': onOpen ? { bgcolor: 'var(--bg-hover)' } : undefined
      }}
    >
      {children}
    </Box>
  );
}

function RowText({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography noWrap sx={{ fontSize: 13, fontWeight: 500, color: 'var(--text-strong)' }}>{primary}</Typography>
      {secondary && <Typography noWrap sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{secondary}</Typography>}
    </Box>
  );
}

/** Shows the first rows; "Show all" reveals the rest that came back; beyond that, a link to the full page. */
function useMore<T>(items: T[]) {
  const [all, setAll] = useState(false);
  return { shown: all ? items : items.slice(0, ROWS), hidden: all ? 0 : Math.max(0, items.length - ROWS), showAll: () => setAll(true) };
}

function MoreFooter({ hidden, onShowAll, total, loaded, pageLabel, pagePath }: { hidden: number; onShowAll: () => void; total?: number; loaded: number; pageLabel: string; pagePath: string }) {
  const navigate = useNavigate();
  const beyond = (total ?? loaded) - loaded;
  if (!hidden && beyond <= 0) return null;
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      {hidden > 0 && (
        <Button size="small" onClick={onShowAll} sx={{ fontSize: 12, py: 0, minWidth: 0 }}>
          Show all {loaded}
        </Button>
      )}
      {beyond > 0 && (
        <Button size="small" onClick={() => navigate(pagePath)} sx={{ fontSize: 12, py: 0, minWidth: 0 }}>
          {total} in total · open {pageLabel}
        </Button>
      )}
    </Box>
  );
}

function TaskTable({ tasks, total, head }: { tasks: any[]; total?: number; head?: string }) {
  const open = useBlueOpen();
  const [done, setDone] = useState<Record<string, 'saving' | 'done' | 'error'>>({});
  const { shown, hidden, showAll } = useMore(tasks);
  if (!tasks.length) return <Step ok text="No posts found" />;

  // Quick action: an Idea or Draft can be marked Ready from the chat.
  const markReady = async (t: any) => {
    setDone((s) => ({ ...s, [t.id]: 'saving' }));
    try {
      await taskAPI.update(t.id, { status: 'Ready' });
      setDone((s) => ({ ...s, [t.id]: 'done' }));
      announcePostChanged(t.id);
      useBlueStore.setState((s) => ({ refreshKey: s.refreshKey + 1 }));
    } catch {
      setDone((s) => ({ ...s, [t.id]: 'error' }));
    }
  };

  return (
    <Table
      head={head ?? `${total ?? tasks.length} post${(total ?? tasks.length) === 1 ? '' : 's'}`}
      footer={<MoreFooter hidden={hidden} onShowAll={showAll} total={total} loaded={tasks.length} pageLabel="the Planner" pagePath={paths.planner({ view: 'list' })} />}
    >
      {shown.map((t) => {
        const state = done[t.id];
        const status = state === 'done' ? 'Ready' : toPostStatus(t.status);
        return (
          <Row key={t.id} onOpen={open(t.url, t)}>
            <Thumb src={t.designed_image_url} size={36} />
            <RowText primary={t.name} secondary={[day(t.task_date), t.project?.name].filter(Boolean).join(' · ') || undefined} />
            <StatusChip status={status} kind="post" />
            {(status === 'Idea' || status === 'Draft') && (
              <Tooltip title={state === 'error' ? 'Couldn’t update. Try again' : 'Mark as ready'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label="Mark as ready"
                    disabled={state === 'saving'}
                    onClick={(e) => {
                      e.stopPropagation();
                      markReady(t);
                    }}
                    sx={{ color: state === 'error' ? 'var(--danger-text)' : 'var(--text-muted)' }}
                  >
                    {state === 'saving' ? <CircularProgress size={14} /> : <MarkDoneIcon sx={{ fontSize: 18 }} />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Row>
        );
      })}
    </Table>
  );
}

function CampaignTable({ campaigns, total }: { campaigns: any[]; total?: number }) {
  const open = useBlueOpen();
  const { shown, hidden, showAll } = useMore(campaigns);
  if (!campaigns.length) return <Step ok text="No campaigns found" />;
  return (
    <Table
      head={`${total ?? campaigns.length} campaign${(total ?? campaigns.length) === 1 ? '' : 's'}`}
      footer={<MoreFooter hidden={hidden} onShowAll={showAll} total={total} loaded={campaigns.length} pageLabel="Campaigns" pagePath={paths.campaigns()} />}
    >
      {shown.map((c) => (
        <Row key={c.id} onOpen={open(c.url, c)}>
          <RowText primary={c.name} secondary={range(c.start_date, c.end_date) || undefined} />
          <StatusChip status={c.archived ? 'archived' : c.status} kind="campaign" />
        </Row>
      ))}
    </Table>
  );
}

function ProjectTable({ projects, total, extra }: { projects: any[]; total?: number; extra?: (p: any) => string | undefined }) {
  const open = useBlueOpen();
  const { shown, hidden, showAll } = useMore(projects);
  if (!projects.length) return <Step ok text="No themes found" />;
  return (
    <Table
      head={`${total ?? projects.length} theme${(total ?? projects.length) === 1 ? '' : 's'}`}
      footer={<MoreFooter hidden={hidden} onShowAll={showAll} total={total} loaded={projects.length} pageLabel="Campaigns" pagePath={paths.campaigns()} />}
    >
      {shown.map((p) => (
        <Row key={p.id} onOpen={open(p.url, p)}>
          <RowText primary={p.name} secondary={[p.campaign?.name, range(p.start_date, p.due_date), extra?.(p)].filter(Boolean).join(' · ') || undefined} />
          <StatusChip status={p.status} kind="theme" />
        </Row>
      ))}
    </Table>
  );
}

function PostTable({ posts, total, head }: { posts: any[]; total?: number; head?: string }) {
  const open = useBlueOpen();
  const { shown, hidden, showAll } = useMore(posts);
  if (!posts.length) return <Step ok text="No posts found" />;
  return (
    <Table
      head={head || `${total ?? posts.length} post${(total ?? posts.length) === 1 ? '' : 's'}`}
      footer={<MoreFooter hidden={hidden} onShowAll={showAll} total={total} loaded={posts.length} pageLabel="Publishing" pagePath={paths.publishing()} />}
    >
      {shown.map((p) => (
        <Row key={p.id} onOpen={open(p.task?.id ? paths.post(p.task.id) : p.url, p.task ? { id: p.task.id, name: p.task.name } : undefined)}>
          <RowText
            primary={`${p.platform}${p.account ? ` · ${p.account}` : ''}${p.test_account ? ' (test)' : ''}`}
            secondary={[dateTime(p.when), p.task?.name, p.problem].filter(Boolean).join(' · ') || undefined}
          />
          <StatusChip status={p.status === 'manual_due' ? 'due' : p.status} kind="publish" />
        </Row>
      ))}
    </Table>
  );
}

function UserTable({ users, total }: { users: any[]; total?: number }) {
  const open = useBlueOpen();
  const { shown, hidden, showAll } = useMore(users);
  if (!users.length) return <Step ok text="No users found" />;
  return (
    <Table
      head={`${total ?? users.length} user${(total ?? users.length) === 1 ? '' : 's'}`}
      footer={<MoreFooter hidden={hidden} onShowAll={showAll} total={total} loaded={users.length} pageLabel="Users" pagePath={paths.adminUsers()} />}
    >
      {shown.map((u) => (
        <Row key={u.id} onOpen={open(paths.adminUser(u.id))}>
          <RowText
            primary={`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email}
            secondary={[u.email, u.role === 'system_admin' ? 'Admin' : null, u.part === 'part_two' ? 'AI off' : 'AI on'].filter(Boolean).join(' · ')}
          />
          {u.active === false && <StatusChip status="inactive" />}
        </Row>
      ))}
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Tiles (numbers)
// ---------------------------------------------------------------------------

function Tiles({ tiles }: { tiles: { label: string; value: ReactNode; tone?: 'warn' | 'bad' }[] }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 0.75 }}>
      {tiles.map((t) => (
        <Box key={t.label} sx={{ bgcolor: 'var(--bg-subtle)', borderRadius: 'var(--r-ctl)', px: 1.25, py: 1 }}>
          <Typography sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t.label}</Typography>
          <Typography
            sx={{ fontSize: 18, fontWeight: 600, color: t.tone === 'bad' ? 'var(--danger-text)' : t.tone === 'warn' ? 'var(--accent-amber-fg)' : 'var(--text-strong)' }}
          >
            {t.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function money(n?: number) {
  if (typeof n !== 'number') return '—';
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Single items
// ---------------------------------------------------------------------------

function TaskCard({ task, compact }: { task: any; compact?: boolean }) {
  const open = useBlueOpen();
  const when = day(task.task_date);
  const where = [task.project?.name, task.campaign?.name].filter(Boolean).join(' · ');
  return (
    <Card onOpen={open(task.url, task)}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Title>{task.name}</Title>
        <StatusChip status={task.status} kind="post" />
      </Box>
      {(when || where) && (
        <Meta>
          {when && (
            <>
              <CalendarIcon sx={{ fontSize: 13, verticalAlign: '-2px', mr: 0.5 }} />
              {when}
            </>
          )}
          {when && where ? ' · ' : ''}
          {where}
        </Meta>
      )}
      <HeroImage src={task.designed_image_url} title={task.name} />
      {!compact && task.content && (
        <Typography
          sx={{ fontSize: 12.5, color: 'var(--text)', mt: 0.25, whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {task.content}
        </Typography>
      )}
      {task.url && (
        <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }} onClick={(e) => e.stopPropagation()}>
          <Button size="small" startIcon={<OpenIcon sx={{ fontSize: 16 }} />} onClick={open(task.url, task)} sx={{ fontSize: 12, py: 0.25 }}>
            Open post
          </Button>
        </Box>
      )}
    </Card>
  );
}

function CampaignCard({ campaign, extra }: { campaign: any; extra?: string }) {
  const open = useBlueOpen();
  const when = range(campaign.start_date, campaign.end_date);
  return (
    <Card onOpen={open(campaign.url, campaign)} accent="var(--accent-violet-fg)">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Title>{campaign.name}</Title>
        <StatusChip status={campaign.archived ? 'archived' : campaign.status} kind="campaign" />
      </Box>
      <Meta>{['Campaign', when, extra].filter(Boolean).join(' · ')}</Meta>
    </Card>
  );
}

function ProjectCard({ project, extra }: { project: any; extra?: string }) {
  const open = useBlueOpen();
  const when = range(project.start_date, project.due_date);
  return (
    <Card onOpen={open(project.url, project)} accent="var(--accent-blue-fg)">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Title>{project.name}</Title>
        <StatusChip status={project.status} kind="theme" />
      </Box>
      <Meta>{['Theme', project.campaign?.name, when, extra].filter(Boolean).join(' · ')}</Meta>
    </Card>
  );
}

function CommentCard({ comment }: { comment: any }) {
  return (
    <Card>
      <Meta>
        <CommentIcon sx={{ fontSize: 13, verticalAlign: '-2px', mr: 0.5 }} />
        {comment.author?.name || 'Comment'}
      </Meta>
      <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{comment.content}</Typography>
    </Card>
  );
}

function UserCard({ user }: { user: any }) {
  return <UserTable users={[user]} />;
}

/** Full-size file URL of a Library item (the thumbnail URL without "?variant=thumb"). */
function libraryFull(item: any): string | undefined {
  if (item.id) return librarySrc(`/api/library/items/${item.id}/file`);
  return librarySrc(item.thumbnail_url?.replace(/\?variant=thumb$/, ''));
}

function LibraryGallery({ items, total }: { items: any[]; total?: number }) {
  const open = useBlueOpen();
  const surface = useBlueSurface();
  const navigate = useNavigate();
  const [zoom, setZoom] = useState<any | null>(null);
  if (!items.length) return <Step ok text="Nothing in the Library matches" />;
  const shown = items.slice(0, 12);
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 0.75 }}>
        {shown.map((i) => (
          <Box
            key={i.id}
            onClick={surface === 'page' ? open(i.url, i) : () => setZoom(i)}
            role="button"
            tabIndex={0}
            title={[i.title, libDate(i.date), i.event].filter(Boolean).join(' · ')}
            sx={{ cursor: 'pointer', minWidth: 0, '&:hover img': { opacity: 0.85 } }}
          >
            <Thumb src={librarySrc(i.thumbnail_url)} size="100%" label={i.kind || 'file'} />
            <Typography sx={{ fontSize: 11, mt: 0.25, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</Typography>
            <Typography sx={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[libDate(i.date), i.versions > 1 ? `v${i.current_version}` : null].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ))}
      </Box>
      {(total ?? items.length) > shown.length && (
        <Meta>
          {total ?? items.length} matches ·{' '}
          <Box component="span" sx={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate('/library')}>
            open the Library
          </Box>
        </Meta>
      )}
      {zoom && (
        <ImageLightbox
          src={zoom.kind === 'image' || !zoom.kind ? libraryFull(zoom) || null : librarySrc(zoom.thumbnail_url) || null}
          title={zoom.title}
          caption={[libDate(zoom.date), zoom.event, zoom.versions > 1 ? `version ${zoom.current_version} of ${zoom.versions}` : null].filter(Boolean).join(' · ')}
          openUrl={zoom.url}
          onClose={() => setZoom(null)}
        />
      )}
    </Box>
  );
}

function LibraryItemCard({ item, versions }: { item: any; versions?: any[] }) {
  const open = useBlueOpen();
  const isImage = item.kind === 'image';
  return (
    <Card onOpen={open(item.url, item)}>
      {isImage ? (
        <HeroImage src={libraryFull(item)} title={item.title} caption={item.description} />
      ) : (
        <Thumb src={librarySrc(item.thumbnail_url)} size={72} label={item.kind} />
      )}
      <Title>{item.title}</Title>
      <Meta>{[libDate(item.date), item.event, item.versions > 1 ? `version ${item.current_version} of ${item.versions}` : null].filter(Boolean).join(' · ')}</Meta>
      {item.description && <Meta>{item.description}</Meta>}
      {versions && versions.length > 1 && (
        <Meta>
          Versions: {versions.slice(0, 5).map((v: any) => `v${v.number}${v.current ? ' (current)' : ''} ${v.added}`).join(', ')}
          {versions.length > 5 ? ', …' : ''}
        </Meta>
      )}
    </Card>
  );
}

function PosterCard({ src, title, note, taskUrl }: { src?: string; title: string; note: string; taskUrl?: string }) {
  const open = useBlueOpen();
  const taskId = taskUrl?.match(/(?:tasks|posts)\/([a-f0-9]{24})/i)?.[1];
  return (
    <Card onOpen={open(taskUrl, taskId ? { id: taskId } : undefined)}>
      <Title>{title}</Title>
      <HeroImage src={src} title={title} />
      <Meta>{note}</Meta>
    </Card>
  );
}

function InboxCard({ data }: { data: any }) {
  const open = useBlueOpen();
  const items: any[] = data.items || [];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Tiles
        tiles={[
          { label: 'Need you', value: data.counts?.needs_action || 0, tone: data.counts?.needs_action ? 'warn' : undefined },
          { label: 'Unread updates', value: data.counts?.unread_updates || 0 },
          { label: 'Messages', value: data.counts?.unread_messages || 0 }
        ]}
      />
      {items.length > 0 && (
        <Table>
          {items.slice(0, ROWS).map((i: any) => (
            <Row key={i.id} onOpen={open(paths.inbox({ item: i.id }))}>
              <RowText primary={i.title} secondary={i.actions?.length ? i.actions.map((a: any) => a.label).join(' · ') : i.body} />
            </Row>
          ))}
        </Table>
      )}
    </Box>
  );
}

function ChannelsCard({ data }: { data: any }) {
  const open = useBlueOpen();
  const accounts: any[] = data.accounts || [];
  if (!accounts.length) return <Step ok text="No connected accounts yet. Platforms can still be used as “post by hand” reminders." />;
  return (
    <Table head="Connected accounts">
      {accounts.map((a: any) => (
        <Row key={a.id} onOpen={open(paths.publishing('accounts'))}>
          <RowText primary={`${a.platform} · ${a.name}`} secondary={a.test_account ? 'Test account' : undefined} />
          {a.needs_reconnect && <StatusChip status="reconnect" />}
        </Row>
      ))}
    </Table>
  );
}

function LibraryOverviewCard({ data }: { data: any }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Tiles tiles={[{ label: 'Items', value: data.total_items ?? 0 }, ...(data.timeline || []).slice(0, 3).map((y: any) => ({ label: String(y.year), value: y.items }))]} />
    </Box>
  );
}

function Calendar({ data }: { data: any }) {
  const open = useBlueOpen();
  const days = Object.keys(data.days || {}).sort();
  if (!days.length) return <Step ok text="Nothing scheduled in that period" />;
  return (
    <Table head={`${data.total_tasks} post${data.total_tasks === 1 ? '' : 's'} · ${day(data.date_from, false)} – ${day(data.date_to, false)}`}>
      {days.map((d) => (
        <Box key={d} sx={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', gap: 1, px: 1.25, py: 0.75, '& + &': { borderTop: '1px solid var(--border)' } }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)', pt: '6px' }}>{d === 'undated' ? 'No day yet' : day(d)}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {data.days[d].map((t: any) => (
              <Box
                key={t.id}
                onClick={open(t.url, t)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', borderRadius: 'var(--r-ctl)', '&:hover': { bgcolor: 'var(--bg-hover)' } }}
              >
                <Thumb src={t.designed_image_url} size={28} />
                <Typography noWrap sx={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{t.name}</Typography>
                <StatusChip status={t.status} kind="post" />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Steps (running / done / failed)
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<string, string> = {
  get_my_account: 'Checked your account',
  get_company_info: 'Read your company info',
  update_company_info: 'Updated your company info',
  delete_task: 'Post deleted',
  delete_library_item: 'Moved to the trash',
  cancel_post: 'Scheduled post cancelled',
  delete_comment: 'Comment deleted',
  remove_user_from_project: 'Removed from the theme',
  deactivate_user: 'Account deactivated'
};

function Step({ ok, text, running }: { ok: boolean; text: string; running?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, color: ok ? 'var(--text-muted)' : 'var(--danger-text)', fontSize: 12.5 }}>
      {running ? (
        <CircularProgress size={13} sx={{ color: 'var(--text-muted)', mt: '2px' }} />
      ) : ok ? (
        <DoneIcon sx={{ fontSize: 15, color: 'var(--success)', mt: '1px' }} />
      ) : (
        <ErrorIcon sx={{ fontSize: 15, mt: '1px' }} />
      )}
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{text}</Box>
    </Box>
  );
}

export function BlueToolItem({ item }: { item: ToolItem }) {
  if (item.running) return <Step ok running text={`${item.title || 'Working'}…`} />;
  if (!item.ok) return <Step ok={false} text={item.error || 'That didn’t work'} />;

  const d = item.data;
  if (d === undefined || d === null) return <Step ok text={STEP_LABELS[item.name] || 'Done'} />;

  switch (item.name) {
    case 'create_task':
    case 'update_task':
      return d.task ? <TaskCard task={d.task} /> : <Step ok text="Done" />;
    case 'get_task':
      return d.task ? <TaskCard task={d.task} /> : <Step ok text="Done" />;
    case 'create_tasks': {
      const created = (d.results || []).filter((r: any) => r.created).map((r: any) => r.task);
      const failed = (d.results || []).filter((r: any) => !r.created);
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Step ok={failed.length === 0} text={d.message || `Created ${created.length} posts`} />
          {created.length > 0 && <TaskTable tasks={created} head={`${created.length} new post${created.length === 1 ? '' : 's'}`} />}
          {failed.map((f: any) => (
            <Step key={f.index} ok={false} text={`${f.name}: ${f.error}`} />
          ))}
        </Box>
      );
    }
    case 'list_tasks':
      return <TaskTable tasks={d.tasks || []} total={d.pagination?.total} />;
    case 'get_calendar':
      return <Calendar data={d} />;
    case 'create_campaign':
    case 'update_campaign':
    case 'archive_campaign':
    case 'restore_campaign':
      return d.campaign ? <CampaignCard campaign={d.campaign} /> : <Step ok text="Done" />;
    case 'get_campaign':
      return d.campaign ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <CampaignCard campaign={d.campaign} extra={`${(d.projects || []).length} themes · ${d.total_tasks ?? 0} posts`} />
          {(d.projects || []).length > 0 && (
            <ProjectTable projects={d.projects} extra={(p) => (p.task_counts ? `${p.task_counts.total} posts` : undefined)} />
          )}
        </Box>
      ) : (
        <Step ok text="Done" />
      );
    case 'list_campaigns':
      return <CampaignTable campaigns={d.campaigns || []} total={d.pagination?.total} />;
    case 'create_project':
    case 'update_project':
    case 'assign_user_to_project':
      return d.project ? <ProjectCard project={d.project} /> : <Step ok text="Done" />;
    case 'get_project':
      return d.project ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <ProjectCard project={d.project} />
          <TaskTable tasks={d.tasks || []} />
        </Box>
      ) : (
        <Step ok text="Done" />
      );
    case 'list_projects':
      return <ProjectTable projects={d.projects || []} total={d.pagination?.total} />;
    case 'add_comment':
    case 'update_comment':
      return d.comment ? <CommentCard comment={d.comment} /> : <Step ok text="Done" />;
    case 'list_comments':
      return (d.comments || []).length ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {(d.comments as any[]).slice(0, ROWS).map((c) => (
            <CommentCard key={c.id} comment={c} />
          ))}
        </Box>
      ) : (
        <Step ok text="No comments" />
      );
    case 'list_users':
      return <UserTable users={d.users || []} total={d.pagination?.total} />;
    case 'get_user':
      return <UserCard user={d.user || d} />;
    case 'create_user':
    case 'update_user':
      return d.user ? <UserCard user={d.user} /> : <Step ok text="Done" />;
    case 'generate_campaign_content':
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Step ok text={d.message || 'Planned'} />
          <ProjectTable projects={d.themes || d.projects || []} extra={(p) => `${p.posts_created ?? p.tasks_created ?? 0} posts`} />
        </Box>
      );
    case 'schedule_post':
      return <PostTable posts={d.posts || []} head={d.message} />;
    case 'list_posts':
      return <PostTable posts={d.posts || []} total={d.total} />;
    case 'list_inbox':
      return <InboxCard data={d} />;
    case 'list_publishing_channels':
      return <ChannelsCard data={d} />;
    case 'search_library':
      return <LibraryGallery items={d.items || []} total={d.total_matches} />;
    case 'get_library_item':
      return d.item ? <LibraryItemCard item={d.item} versions={d.versions} /> : <Step ok text="Done" />;
    case 'update_library_item':
    case 'restore_library_version':
      return d.item ? <LibraryItemCard item={d.item} /> : <Step ok text={d.message || 'Done'} />;
    case 'library_overview':
      return <LibraryOverviewCard data={d} />;
    case 'refine_task_description':
      return (
        <Card>
          <Meta>Suggested brief</Meta>
          <BlueText text={d.suggested_description || ''} />
        </Card>
      );
    case 'improve_caption':
      return (
        <Card>
          <Meta>{d.style ? `Suggested caption · ${d.style}` : 'Suggested caption'}</Meta>
          <BlueText text={d.suggested_caption || ''} />
        </Card>
      );
    case 'generate_task_poster':
      return <PosterCard src={d.pending_image_url} title="New AI image" note="Open the post to use it or discard it." taskUrl={d.task_url} />;
    case 'adopt_task_poster':
      return d.image_url ? <PosterCard src={d.image_url} title="This is now the post’s image" note={d.message || 'Saved'} /> : <Step ok text={d.message || 'Done'} />;
    case 'ai_usage':
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Tiles
            tiles={[
              { label: 'AI calls', value: d.totals?.calls ?? 0 },
              { label: 'Failed', value: d.totals?.failed ?? 0, tone: d.totals?.failed ? 'bad' : undefined },
              { label: 'Tokens', value: (d.totals?.tokens ?? 0).toLocaleString() },
              { label: 'Est. cost', value: money(d.totals?.estimated_cost_usd) }
            ]}
          />
          {(d.recent || []).length > 0 && (
            <Table head="Recent">
              {(d.recent as any[]).slice(0, ROWS).map((u, i) => (
                <Row key={i}>
                  <RowText primary={u.feature || 'AI call'} secondary={[u.model, dateTime(u.at), u.seconds ? `${u.seconds}s` : null, u.error].filter(Boolean).join(' · ')} />
                  <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{money(u.cost_usd)}</Typography>
                  {!u.ok && <StatusChip status="failed" />}
                </Row>
              ))}
            </Table>
          )}
        </Box>
      );
    case 'ai_setup_status': {
      const keys = Object.entries(d.api_keys || {}).filter(([, v]) => v).map(([k]) => k);
      const missing: any[] = d.app_commands_missing || [];
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Tiles
            tiles={[
              { label: 'AI keys', value: keys.length ? keys.join(', ') : 'None', tone: keys.length ? undefined : 'bad' },
              { label: 'Prompts', value: (d.prompts || []).length },
              { label: 'Commands', value: (d.commands || []).length },
              { label: 'Missing', value: missing.length, tone: missing.length ? 'warn' : undefined }
            ]}
          />
          {missing.map((m) => (
            <Step key={m.command} ok={false} text={`${m.command} is not set up (${m.used_by})`} />
          ))}
        </Box>
      );
    }
    case 'run_prompt':
      return (
        <Card>
          <Meta>AI reply{d.usage?.total_tokens ? ` · ${d.usage.total_tokens} tokens` : ''}</Meta>
          <BlueText text={String(d.reply || '')} />
        </Card>
      );
    default:
      return <Step ok text={STEP_LABELS[item.name] || d.message || 'Done'} />;
  }
}
