import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress, IconButton, LinearProgress, Tooltip, Typography } from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as DoneIcon,
  RadioButtonUnchecked as TodoIcon,
  Close as CloseIcon,
  ArrowForward as GoIcon,
  ErrorOutline as AttentionIcon,
  Inbox as InboxIcon,
  Schedule as ScheduledIcon,
  EditNote as NotReadyIcon
} from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import PostCard, { type PlannerPost } from '../../components/posts/PostCard';
import { useNewPost, useOpenPost, usePostEvents } from '../../components/posts/PostPanelHost';
import { BlueMark } from '../../components/Blue/BluePanel';
import { useBlueStore } from '../../store/blueStore';
import { useAuthStore } from '../../store/authStore';
import { useInboxStore } from '../../store/inboxStore';
import api, { campaignAPI, taskAPI } from '../../services/api';
import { publishingAPI, type PublishingStatus } from '../../services/publishing';
import { addDays, dayKey, dayToISO, formatDay, formatDayRange, formatTime, todayKey } from '../../lib/dates';
import { paths } from '../../lib/paths';
import { campaignColor } from '../../lib/colors';
import { campaignStatusMeta, toPostStatus } from '../../lib/status';
import { MetaChip } from '../../components/ui/StatusChip';
import { errorMessage } from '../../store/toastStore';

/**
 * Today: what needs you now and what's coming up. Replaces the old Dashboard.
 * - First steps (until done or hidden)
 * - Needs attention: failed or overdue publishing, Inbox actions
 * - The next 7 days of posts, by day
 * - Counts that lead to the right filtered view, and the campaigns running now
 */

const WEEK = 7;

interface Campaign {
  _id: string;
  name: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  archived?: boolean;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function TodayPage() {
  const { user } = useAuthStore();
  const inbox = useInboxStore((s) => s.summary);
  const openPost = useOpenPost();
  const toggleBlue = useBlueStore((s) => s.toggle);
  const blueAllowed = user?.assistantEnabled !== false;
  const publishingOn = user?.publishingEnabled !== false;

  const today = todayKey();
  const [week, setWeek] = useState<PlannerPost[] | null>(null);
  const [attention, setAttention] = useState<PlannerPost[]>([]);
  const [notReady, setNotReady] = useState<number | null>(null);
  const [anyPost, setAnyPost] = useState<boolean | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [status, setStatus] = useState<PublishingStatus | null>(null);
  const [accounts, setAccounts] = useState<number | null>(null);
  const [brandDone, setBrandDone] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const newPost = useNewPost();
  const dismissKey = `bp.setup.hidden.${user?._id || user?.id || ''}`;
  const [setupHidden, setSetupHidden] = useState(() => {
    try {
      return localStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  });

  const load = useCallback(async () => {
    setError(null);
    const end = addDays(today, WEEK - 1);
    try {
      const [weekRes, attentionRes, notReadyRes, anyRes, campaignRes] = await Promise.all([
        taskAPI.getAll({ dateFrom: dayToISO(today), dateTo: `${end}T23:59:59.999Z`, include: 'publishing', excludeArchived: 'true', limit: 500 }),
        taskAPI.getAll({ status: 'Needs attention', include: 'publishing', excludeArchived: 'true', limit: 50 }),
        taskAPI.getAll({ status: 'Idea,Draft', dateFrom: dayToISO(today), dateTo: `${addDays(today, 13)}T23:59:59.999Z`, excludeArchived: 'true', limit: 500 }),
        taskAPI.getAll({ limit: 1 }),
        campaignAPI.getAll({ limit: 200 })
      ]);
      setWeek(weekRes.data.tasks || []);
      setAttention(attentionRes.data.tasks || []);
      setNotReady((notReadyRes.data.tasks || []).length);
      setAnyPost((anyRes.data.tasks || []).length > 0);
      setCampaigns(campaignRes.data.campaigns || []);
    } catch (e) {
      setError(errorMessage(e, 'Today couldn’t load. Try again.'));
    }
    api
      .get('/users/me/company-info')
      .then((r) => setBrandDone(Boolean(r.data.companyInfo?.companyName?.trim() && r.data.companyInfo?.about?.trim())))
      .catch(() => setBrandDone(false));
    if (publishingOn) {
      publishingAPI.status().then(setStatus).catch(() => setStatus(null));
      publishingAPI
        .channels()
        .then((c) => setAccounts(c.filter((x) => x.status !== 'disabled').length))
        .catch(() => setAccounts(null));
    }
  }, [today, publishingOn]);

  useEffect(() => {
    load();
  }, [load]);
  usePostEvents(() => load());

  const days = useMemo(() => {
    const out: { key: string; posts: PlannerPost[] }[] = [];
    for (let i = 0; i < WEEK; i++) out.push({ key: addDays(today, i), posts: [] });
    for (const p of week || []) {
      const k = dayKey(p.taskDate);
      const d = out.find((x) => x.key === k);
      if (d) d.posts.push(p);
    }
    for (const d of out) d.posts.sort((a, b) => (a.publishing?.nextAt || '9').localeCompare(b.publishing?.nextAt || '9') || a.name.localeCompare(b.name));
    return out;
  }, [week, today]);

  const live = (campaigns || []).filter((c) => !c.archived && (c.status === 'active' || c.status === 'planning'));
  const steps: { label: string; hint: string; done: boolean; to?: string; onClick?: () => void }[] = [
    { label: 'Tell Blueprint about your brand', hint: 'Name, what you do, your tone. AI uses it in every caption and image.', done: Boolean(brandDone), to: paths.settings('brand') },
    { label: 'Add your first post', hint: 'Say what it’s about, give it a day, then let AI write the caption and make the picture (or add your own).', done: Boolean(anyPost), onClick: () => newPost({}) }
  ];
  if (publishingOn) {
    steps.push({ label: 'Connect a social account', hint: 'So Blueprint can publish for you, or remind you to post.', done: (accounts || 0) > 0, to: paths.publishing('accounts') });
    steps.push({
      label: 'Schedule a post',
      hint: 'Open a Ready post and choose Publish or schedule.',
      done: Boolean(status?.counts && status.counts.upcoming + status.counts.published > 0)
    });
  }
  const loadedSetup = campaigns !== null && anyPost !== null && brandDone !== null && (!publishingOn || accounts !== null);
  const doneCount = steps.filter((s) => s.done).length;
  const showSetup = loadedSetup && !setupHidden && doneCount < steps.length;

  const hideSetup = () => {
    setSetupHidden(true);
    try {
      localStorage.setItem(dismissKey, '1');
    } catch {
      /* private mode: hidden for this visit only */
    }
  };

  const first = (user?.firstName || '').trim();
  const weekCount = (week || []).length;
  const upcoming = status?.counts?.upcoming ?? null;

  return (
    <Box>
      <PageHeader
        title={`${greeting()}${first ? `, ${first}` : ''}`}
        subtitle={formatDay(dayToISO(today), { weekday: true })}
        actions={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {blueAllowed && (
              <Button variant="outlined" startIcon={<BlueMark size={18} />} onClick={toggleBlue}>
                Ask Blue
              </Button>
            )}
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => newPost({})}>
              New post
            </Button>
          </Box>
        }
      />

      {error && (
        <Panel>
          <Typography sx={{ fontSize: 14, color: 'var(--text-strong)', mb: 1 }}>{error}</Typography>
          <Button onClick={load}>Try again</Button>
        </Panel>
      )}

      {showSetup && (
        <Panel
          title="First steps"
          right={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {doneCount} of {steps.length} done
              </Typography>
              <Tooltip title="Hide first steps">
                <IconButton size="small" onClick={hideSetup} aria-label="Hide first steps">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          }
        >
          <LinearProgress variant="determinate" value={(doneCount / steps.length) * 100} sx={{ mb: 1.5, height: 6, borderRadius: 3 }} aria-label="Progress" />
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {steps.map((s) => {
              const actionable = !s.done && (s.to || s.onClick);
              return (
                <Box
                  component="li"
                  key={s.label}
                  sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, p: 1, borderRadius: 'var(--r-card)', '&:hover': actionable ? { bgcolor: 'var(--bg-hover)' } : undefined }}
                >
                  {s.done ? <DoneIcon sx={{ color: 'var(--st-published-dot)', fontSize: 20, mt: '1px' }} /> : <TodoIcon sx={{ color: 'var(--text-faint)', fontSize: 20, mt: '1px' }} />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: s.done ? 'var(--text-muted)' : 'var(--text-strong)', textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</Typography>
                    {!s.done && <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{s.hint}</Typography>}
                  </Box>
                  {actionable &&
                    (s.to ? (
                      <Button size="small" component={RouterLink} to={s.to} endIcon={<GoIcon />}>
                        Start
                      </Button>
                    ) : (
                      <Button size="small" onClick={s.onClick} endIcon={<GoIcon />}>
                        Start
                      </Button>
                    ))}
                </Box>
              );
            })}
          </Box>
        </Panel>
      )}

      {/* At a glance: each leads to the matching view */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5, mb: 2 }}>
        <Stat
          icon={<AttentionIcon />}
          tone={attention.length ? 'attention' : undefined}
          value={week === null ? null : attention.length}
          label="Need attention"
          to={paths.planner({ view: 'list', status: ['Needs attention'] })}
        />
        <Stat icon={<InboxIcon />} tone={inbox.action ? 'attention' : undefined} value={inbox.action} label="Inbox to-dos" to={paths.inbox()} />
        <Stat icon={<NotReadyIcon />} value={notReady} label="Not ready, next 2 weeks" to={paths.planner({ view: 'list', status: ['Idea', 'Draft'] })} />
        {publishingOn ? (
          <Stat icon={<ScheduledIcon />} value={upcoming} label="Scheduled to publish" to={paths.publishing('queue')} />
        ) : (
          <Stat icon={<ScheduledIcon />} value={week === null ? null : weekCount} label="Posts this week" to={paths.planner({ view: 'week' })} />
        )}
      </Box>

      {attention.length > 0 && (
        <Panel title="Needs attention" right={<SmallLink to={paths.publishing('queue')}>Open Publishing</SmallLink>}>
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mb: 1 }}>These posts failed to publish or are waiting for you to post them by hand.</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {attention.map((p) => (
              <PostCard key={p._id} post={p} onOpen={openPost} variant="row" showDate draggable={false} />
            ))}
          </Box>
        </Panel>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 2fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
        <Panel title="Next 7 days" subtitle={formatDayRange(today, addDays(today, WEEK - 1))} right={<SmallLink to={paths.planner({ view: 'week' })}>Open the Planner</SmallLink>}>
          {week === null && !error ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress size={20} sx={{ color: 'var(--text-muted)' }} />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {days.map((d, i) => (
                <Box key={d.key} sx={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: 1.5, py: 1, borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: i === 0 ? 'var(--st-scheduled-fg)' : 'var(--text-strong)' }}>{formatDay(dayToISO(d.key), { relative: true })}</Typography>
                    {i > 1 && <Typography sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{formatDay(dayToISO(d.key))}</Typography>}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
                    {d.posts.map((p) => (
                      <PostCard key={p._id} post={p} onOpen={openPost} variant="row" draggable={false} />
                    ))}
                    {d.posts.length === 0 && (
                      <Button size="small" startIcon={<AddIcon />} onClick={() => newPost({ day: d.key })} sx={{ alignSelf: 'flex-start', color: 'var(--text-muted)' }}>
                        Add a post
                      </Button>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Panel>

        <Panel title="Campaigns running" right={<SmallLink to={paths.campaigns()}>All campaigns</SmallLink>}>
          {campaigns === null && !error ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 3 }}>
              <CircularProgress size={18} sx={{ color: 'var(--text-muted)' }} />
            </Box>
          ) : live.length === 0 ? (
            <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>No campaigns are running right now.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {live.map((c) => (
                <Box
                  key={c._id}
                  component={RouterLink}
                  to={paths.campaign(c._id)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 'var(--r-card)', color: 'inherit', textDecoration: 'none', '&:hover': { bgcolor: 'var(--bg-hover)' } }}
                >
                  <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: campaignColor(c._id), flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>{c.name}</Typography>
                    <Typography noWrap sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDayRange(c.startDate, c.endDate)}</Typography>
                  </Box>
                  <MetaChip meta={campaignStatusMeta(c.status)} size="xs" />
                </Box>
              ))}
            </Box>
          )}
          {weekCount > 0 && (
            <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 1.5 }}>
              {weekCount} post{weekCount === 1 ? '' : 's'} this week, {(week || []).filter((p) => ['Ready', 'Scheduled', 'Published'].includes(toPostStatus(p.status))).length} ready or scheduled.
              {upcoming ? ` Next to go out: ${nextOut(week)}` : ''}
            </Typography>
          )}
        </Panel>
      </Box>

    </Box>
  );
}

function nextOut(posts: PlannerPost[] | null): string {
  const next = (posts || [])
    .map((p) => p.publishing?.nextAt)
    .filter((x): x is string => Boolean(x))
    .sort()[0];
  return next ? `${formatDay(next, { relative: true })} at ${formatTime(next)}.` : '';
}

function Panel({ title, subtitle, right, children }: { title?: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Box component="section" sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-panel)', p: 2, mb: 2 }}>
      {(title || right) && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
          {title && (
            <Typography component="h2" sx={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
              {title}
            </Typography>
          )}
          {subtitle && <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{subtitle}</Typography>}
          <Box sx={{ flex: 1 }} />
          {right}
        </Box>
      )}
      {children}
    </Box>
  );
}

function SmallLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button size="small" component={RouterLink} to={to} endIcon={<GoIcon sx={{ fontSize: 16 }} />} sx={{ fontSize: 12.5 }}>
      {children}
    </Button>
  );
}

function Stat({ icon, value, label, to, tone }: { icon: ReactNode; value: number | null; label: string; to: string; tone?: 'attention' }) {
  const hot = tone === 'attention' && (value || 0) > 0;
  return (
    <Box
      component={RouterLink}
      to={to}
      sx={{
        display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.5, borderRadius: 'var(--r-panel)', textDecoration: 'none', color: 'inherit',
        border: '1px solid', borderColor: hot ? 'var(--st-attention-dot)' : 'var(--border)', bgcolor: hot ? 'var(--st-attention-bg)' : 'var(--bg-panel)',
        '&:hover': { borderColor: 'var(--border-strong)' }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: hot ? 'var(--st-attention-fg)' : 'var(--text-muted)', '& svg': { fontSize: 18 } }}>
        {icon}
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: hot ? 'var(--st-attention-fg)' : 'var(--text-strong)' }}>{value === null ? '–' : value}</Typography>
    </Box>
  );
}
