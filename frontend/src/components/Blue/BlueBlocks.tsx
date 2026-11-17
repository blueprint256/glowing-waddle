import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import {
  CheckCircleOutline as DoneIcon,
  ErrorOutline as ErrorIcon,
  CalendarMonth as CalendarIcon,
  OpenInNew as OpenIcon,
  Visibility as PreviewIcon,
  ChatBubbleOutline as CommentIcon
} from '@mui/icons-material';
import SocialPreviewModal from '../SocialPreviewModal';
import BlueText from './BlueText';
import type { BlueItem } from '../../services/blue';
import { librarySrc } from '../../services/library';

/**
 * Turns Blue's tool results into cards: tasks, campaigns, projects, calendars, comments, users.
 * Every card links into the normal app screens.
 */

type ToolItem = Extract<BlueItem, { kind: 'tool' }>;

const LIST_LIMIT = 6;

function pathFrom(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return null;
  }
}

/** Dates are stored as UTC midnight, so format in UTC to avoid showing the day before. */
function day(value?: string | null, withWeekday = true): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { ...(withWeekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function range(start?: string | null, end?: string | null): string | null {
  const a = day(start, false);
  const b = day(end, false);
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  Pending: { bg: 'var(--accent-amber-bg)', fg: 'var(--accent-amber-fg)' },
  'In Progress': { bg: 'var(--accent-blue-bg)', fg: 'var(--accent-blue-fg)' },
  Completed: { bg: 'var(--accent-green-bg)', fg: 'var(--accent-green-fg)' },
  active: { bg: 'var(--accent-green-bg)', fg: 'var(--accent-green-fg)' },
  completed: { bg: 'var(--accent-green-bg)', fg: 'var(--accent-green-fg)' },
  in_progress: { bg: 'var(--accent-blue-bg)', fg: 'var(--accent-blue-fg)' },
  review: { bg: 'var(--accent-violet-bg)', fg: 'var(--accent-violet-fg)' },
  paused: { bg: 'var(--accent-amber-bg)', fg: 'var(--accent-amber-fg)' },
  on_hold: { bg: 'var(--accent-amber-bg)', fg: 'var(--accent-amber-fg)' }
};

function StatusChip({ status }: { status?: string }) {
  if (!status) return null;
  const c = STATUS_COLORS[status] || { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' };
  return (
    <Chip
      size="small"
      label={status.replace('_', ' ')}
      sx={{ height: 20, fontSize: 11, fontWeight: 600, bgcolor: c.bg, color: c.fg, textTransform: 'capitalize', '& .MuiChip-label': { px: 0.75 } }}
    />
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
        if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
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
  return <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{children}</Typography>;
}

function Title({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.35, minWidth: 0, overflowWrap: 'anywhere' }}>
      {children}
    </Typography>
  );
}

function useOpen() {
  const navigate = useNavigate();
  return (url?: string) => {
    const path = pathFrom(url);
    return path ? () => navigate(path) : undefined;
  };
}

// ---------------------------------------------------------------------------
// Entity cards
// ---------------------------------------------------------------------------

function libDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function LibraryThumb({ item, size }: { item: any; size: number | string }) {
  const [broken, setBroken] = useState(false);
  const src = !broken ? librarySrc(item.thumbnail_url) : undefined;
  return (
    <Box sx={{ width: size, aspectRatio: '1 / 1', flexShrink: 0, borderRadius: 'var(--r-nav)', overflow: 'hidden', bgcolor: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Typography sx={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{item.kind || 'file'}</Typography>
      )}
    </Box>
  );
}

function LibraryGallery({ items, total }: { items: any[]; total?: number }) {
  const open = useOpen();
  if (!items.length) return <Step ok text="Nothing in the Library matches" />;
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.75 }}>
        {items.slice(0, 9).map((i) => (
          <Box
            key={i.id}
            onClick={open(i.url)}
            role="link"
            tabIndex={0}
            title={[i.title, i.date, i.event].filter(Boolean).join(' · ')}
            sx={{ cursor: 'pointer', minWidth: 0, '&:hover img': { opacity: 0.85 } }}
          >
            <LibraryThumb item={i} size="100%" />
            <Typography sx={{ fontSize: 11, mt: 0.25, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</Typography>
            <Typography sx={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[libDate(i.date), i.versions > 1 ? `v${i.current_version}` : null].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ))}
      </Box>
      {(total ?? items.length) > Math.min(items.length, 9) && (
        <Meta>
          {total} matches · <Box component="span" sx={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => open('/library')?.()}>open the Library</Box>
        </Meta>
      )}
    </Box>
  );
}

function LibraryItemCard({ item, versions }: { item: any; versions?: any[] }) {
  const open = useOpen();
  return (
    <Card onOpen={open(item.url)}>
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
        <LibraryThumb item={item} size={72} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Title>{item.title}</Title>
          <Meta>{[libDate(item.date), item.event, item.versions > 1 ? `version ${item.current_version} of ${item.versions}` : null].filter(Boolean).join(' · ')}</Meta>
          {item.description && <Meta>{item.description}</Meta>}
        </Box>
      </Box>
      {versions && versions.length > 1 && (
        <Meta>
          Versions: {versions.slice(0, 5).map((v: any) => `v${v.number}${v.current ? ' (current)' : ''} ${v.added}`).join(', ')}
          {versions.length > 5 ? ', …' : ''}
        </Meta>
      )}
    </Card>
  );
}

function PublishPostsCard({ posts, title }: { posts: any[]; title?: string }) {
  const open = useOpen();
  if (!posts.length) return <Step ok text="No posts found" />;
  return (
    <Card onOpen={open('/publishing')}>
      {title && <Title>{title}</Title>}
      {posts.slice(0, LIST_LIMIT).map((p: any) => (
        <Meta key={p.id}>
          <strong>{p.platform}</strong>
          {p.account ? ` · ${p.account}` : ''} · {p.status}
          {p.when ? ` · ${new Date(p.when).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          {p.task?.name ? ` · ${p.task.name}` : ''}
          {p.test_account ? ' (test)' : ''}
          {p.problem ? ` — ${p.problem}` : ''}
        </Meta>
      ))}
      {posts.length > LIST_LIMIT && <Meta>…and {posts.length - LIST_LIMIT} more</Meta>}
    </Card>
  );
}

function ChannelsCard({ data }: { data: any }) {
  const open = useOpen();
  return (
    <Card onOpen={open('/publishing?tab=channels')}>
      <Title>Connected accounts</Title>
      {(data.accounts || []).length ? (
        data.accounts.map((a: any) => (
          <Meta key={a.id}>
            {a.platform} · {a.name}
            {a.test_account ? ' (test)' : ''}
            {a.needs_reconnect ? ' — needs reconnecting' : ''}
          </Meta>
        ))
      ) : (
        <Meta>None yet. Platforms can still be used as “post by hand” reminders.</Meta>
      )}
    </Card>
  );
}

function LibraryOverviewCard({ data }: { data: any }) {
  const open = useOpen();
  return (
    <Card onOpen={open('/library')}>
      <Title>Library · {data.total_items} items</Title>
      {(data.timeline || []).slice(0, 4).map((y: any) => (
        <Meta key={y.year}>
          {y.year}: {y.items} · {y.months.slice(0, 4).map((m: any) => `${m.month.slice(0, 3)} ${m.items}`).join(', ')}
          {y.months.length > 4 ? ', …' : ''}
        </Meta>
      ))}
    </Card>
  );
}

function TaskCard({ task, compact }: { task: any; compact?: boolean }) {
  const open = useOpen();
  const [preview, setPreview] = useState(false);
  const when = day(task.task_date);
  const where = [task.project?.name, task.campaign?.name].filter(Boolean).join(' · ');
  return (
    <Card onOpen={open(task.url)}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Title>{task.name}</Title>
        <StatusChip status={task.status} />
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
      {!compact && task.designed_image_url && (
        <Box component="img" src={task.designed_image_url} alt="" sx={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 'var(--r-ctl)', mt: 0.5 }} />
      )}
      {!compact && task.content && (
        <Typography
          sx={{
            fontSize: 12.5, color: 'var(--text)', mt: 0.25, whiteSpace: 'pre-wrap',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}
        >
          {task.content}
        </Typography>
      )}
      {!compact && (task.content || task.designed_image_url) && (
        <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }} onClick={(e) => e.stopPropagation()}>
          <Button size="small" startIcon={<PreviewIcon sx={{ fontSize: 16 }} />} onClick={() => setPreview(true)} sx={{ fontSize: 12, py: 0.25 }}>
            Preview post
          </Button>
          {task.url && (
            <Button size="small" startIcon={<OpenIcon sx={{ fontSize: 16 }} />} onClick={open(task.url)} sx={{ fontSize: 12, py: 0.25 }}>
              Open
            </Button>
          )}
        </Box>
      )}
      {preview && (
        <Box onClick={(e) => e.stopPropagation()}>
          <SocialPreviewModal
            open={preview}
            onClose={() => setPreview(false)}
            task={{ _id: task.id, name: task.name, description: task.description, content: task.content, designedImage: task.designed_image_url, taskDate: task.task_date || undefined }}
          />
        </Box>
      )}
    </Card>
  );
}

function CampaignCard({ campaign, extra }: { campaign: any; extra?: string }) {
  const open = useOpen();
  const when = range(campaign.start_date, campaign.end_date);
  return (
    <Card onOpen={open(campaign.url)} accent="var(--accent-violet-fg)">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Title>{campaign.name}</Title>
        {campaign.archived ? <StatusChip status="archived" /> : <StatusChip status={campaign.status} />}
      </Box>
      <Meta>{['Campaign', when, extra].filter(Boolean).join(' · ')}</Meta>
    </Card>
  );
}

function ProjectCard({ project, extra }: { project: any; extra?: string }) {
  const open = useOpen();
  const when = range(project.start_date, project.due_date);
  return (
    <Card onOpen={open(project.url)} accent="var(--accent-blue-fg)">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Title>{project.name}</Title>
        <StatusChip status={project.status} />
      </Box>
      <Meta>{['Project', project.campaign?.name, when, extra].filter(Boolean).join(' · ')}</Meta>
    </Card>
  );
}

function ListOf<T>({ items, render, total, label }: { items: T[]; render: (item: T, i: number) => ReactNode; total?: number; label: string }) {
  if (!items.length) return <Step ok text={`No ${label} found`} />;
  const shown = items.slice(0, LIST_LIMIT);
  const more = (total ?? items.length) - shown.length;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {shown.map(render)}
      {more > 0 && <Meta>and {more} more {label}</Meta>}
    </Box>
  );
}

function Calendar({ data }: { data: any }) {
  const open = useOpen();
  const days = Object.keys(data.days || {}).sort();
  if (!days.length) return <Step ok text="Nothing scheduled in that period" />;
  return (
    <Card>
      <Meta>
        {data.total_tasks} task{data.total_tasks === 1 ? '' : 's'} · {day(data.date_from, false)} – {day(data.date_to, false)}
      </Meta>
      {days.map((d) => (
        <Box key={d} sx={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', gap: 1, py: 0.5, borderTop: '1px solid var(--border)' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)' }}>{d === 'undated' ? 'No date' : day(d)}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {data.days[d].map((t: any) => (
              <Box
                key={t.id}
                onClick={open(t.url)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer', '&:hover .t': { textDecoration: 'underline' } }}
              >
                <Typography className="t" noWrap sx={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{t.name}</Typography>
                <StatusChip status={t.status} />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
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

function UserRow({ user }: { user: any }) {
  const open = useOpen();
  return (
    <Card onOpen={open(`/admin/users/${user.id}`)}>
      <Title>
        {user.first_name} {user.last_name}
      </Title>
      <Meta>
        {[user.email, user.role?.replace('_', ' '), user.part === 'part_two' ? 'Part two' : 'Part one', user.active === false ? 'inactive' : null]
          .filter(Boolean)
          .join(' · ')}
      </Meta>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Steps (running / done / failed)
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<string, string> = {
  get_my_account: 'Checked your account',
  get_company_info: 'Read your company info',
  update_company_info: 'Updated your company info',
  delete_task: 'Task deleted',
  delete_library_item: 'Moved to the trash',
  cancel_post: 'Post cancelled',
  delete_comment: 'Comment deleted',
  remove_user_from_project: 'Removed from the project',
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
      return d.task ? <TaskCard task={d.task} compact /> : <Step ok text="Done" />;
    case 'create_tasks': {
      const created = (d.results || []).filter((r: any) => r.created).map((r: any) => r.task);
      const failed = (d.results || []).filter((r: any) => !r.created);
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Step ok={failed.length === 0} text={d.message || `Created ${created.length} tasks`} />
          <ListOf items={created} label="tasks" render={(t: any) => <TaskCard key={t.id} task={t} compact />} />
          {failed.map((f: any) => (
            <Step key={f.index} ok={false} text={`${f.name}: ${f.error}`} />
          ))}
        </Box>
      );
    }
    case 'list_tasks':
      return <ListOf items={d.tasks || []} total={d.pagination?.total} label="tasks" render={(t: any) => <TaskCard key={t.id} task={t} compact />} />;
    case 'get_calendar':
      return <Calendar data={d} />;
    case 'create_campaign':
    case 'update_campaign':
    case 'archive_campaign':
    case 'restore_campaign':
      return d.campaign ? <CampaignCard campaign={d.campaign} /> : <Step ok text="Done" />;
    case 'get_campaign':
      return d.campaign ? (
        <CampaignCard campaign={d.campaign} extra={`${(d.projects || []).length} projects · ${d.total_tasks ?? 0} tasks`} />
      ) : (
        <Step ok text="Done" />
      );
    case 'list_campaigns':
      return <ListOf items={d.campaigns || []} total={d.pagination?.total} label="campaigns" render={(c: any) => <CampaignCard key={c.id} campaign={c} />} />;
    case 'create_project':
    case 'update_project':
    case 'assign_user_to_project':
      return d.project ? <ProjectCard project={d.project} /> : <Step ok text="Done" />;
    case 'get_project':
      return d.project ? <ProjectCard project={d.project} extra={`${(d.tasks || []).length} tasks`} /> : <Step ok text="Done" />;
    case 'list_projects':
      return <ListOf items={d.projects || []} total={d.pagination?.total} label="projects" render={(p: any) => <ProjectCard key={p.id} project={p} />} />;
    case 'add_comment':
    case 'update_comment':
      return d.comment ? <CommentCard comment={d.comment} /> : <Step ok text="Done" />;
    case 'list_comments':
      return <ListOf items={d.comments || []} label="comments" render={(c: any) => <CommentCard key={c.id} comment={c} />} />;
    case 'list_users':
      return <ListOf items={d.users || []} total={d.pagination?.total} label="users" render={(u: any) => <UserRow key={u.id} user={u} />} />;
    case 'get_user':
      return <UserRow user={d} />;
    case 'create_user':
    case 'update_user':
      return d.user ? <UserRow user={d.user} /> : <Step ok text="Done" />;
    case 'generate_campaign_content':
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Step ok text={d.message || 'Generated'} />
          <ListOf items={d.projects || []} label="projects" render={(p: any) => <ProjectCard key={p.id} project={p} extra={`${p.tasks_created ?? 0} tasks`} />} />
        </Box>
      );
    case 'schedule_post':
      return <PublishPostsCard posts={d.posts || []} title={d.message} />;
    case 'list_posts':
      return <PublishPostsCard posts={d.posts || []} />;
    case 'list_publishing_channels':
      return <ChannelsCard data={d} />;
    case 'search_library':
      return <LibraryGallery items={d.items || []} total={d.total_matches} />;
    case 'get_library_item':
      return <LibraryItemCard item={d.item} versions={d.versions} />;
    case 'update_library_item':
    case 'restore_library_version':
      return d.item ? <LibraryItemCard item={d.item} /> : <Step ok text={d.message || 'Done'} />;
    case 'library_overview':
      return <LibraryOverviewCard data={d} />;
    case 'refine_task_description':
      return (
        <Card>
          <Meta>Suggested description</Meta>
          <BlueText text={d.suggested_description || ''} />
        </Card>
      );
    default:
      return <Step ok text={STEP_LABELS[item.name] || d.message || 'Done'} />;
  }
}
