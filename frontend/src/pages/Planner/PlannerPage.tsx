import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Drawer, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery } from '@mui/material';
import {
  Add as AddIcon,
  ChevronLeft as PrevIcon,
  ChevronRight as NextIcon,
  CalendarMonth as MonthIcon,
  ViewWeek as WeekIcon,
  ViewList as ListIcon,
  Inbox as TrayIcon,
  Close as CloseIcon,
  EventNote as EmptyIcon
} from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import FilterBar, { type Facet } from '../../components/ui/FilterBar';
import EmptyState from '../../components/ui/EmptyState';
import PostCard, { canMovePost, type PlannerPost } from '../../components/posts/PostCard';
import NewPostDialog, { type NewPostDefaults } from '../../components/posts/NewPostDialog';
import { useOpenPost, usePostEvents } from '../../components/posts/PostPanelHost';
import { ListView, MonthView, WeekView, monthGridStart, useDropTarget, weekStart, type ListGroup } from '../../components/planner/PlannerViews';
import { campaignAPI, taskAPI, userAPI } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import { addDays, dayToISO, formatDay, formatDayRange, formatMonth, todayKey } from '../../lib/dates';
import { POST_STATUSES, postStatusMeta, toPostStatus } from '../../lib/status';
import { campaignColor } from '../../lib/colors';
import { paths } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';
import { announcePostChanged } from '../../store/aiJobsStore';

/**
 * Planner: every post in one place, as a calendar (month or week) or a list. Replaces the old
 * Calendar, Tasks Sheet and Details Sheet. Everything you choose (view, date, filters) is kept in the
 * address, so Back and shared links work. Drag a card to another day to move it (with Undo); posts
 * without a day wait in "No day yet".
 */

type View = 'month' | 'week' | 'list';

const QUICK: { key: string; label: string; statuses: string[] }[] = [
  { key: 'attention', label: 'Needs attention', statuses: ['Needs attention'] },
  { key: 'todo', label: 'Not ready', statuses: ['Idea', 'Draft'] },
  { key: 'ready', label: 'Ready', statuses: ['Ready'] },
  { key: 'scheduled', label: 'Scheduled', statuses: ['Scheduled'] }
];

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export default function PlannerPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const [params, setParams] = useSearchParams();
  const phone = !useMediaQuery('(min-width: 48em)');
  const wide = useMediaQuery('(min-width: 75em)');
  const openPost = useOpenPost();

  const view: View = (['month', 'week', 'list'].includes(params.get('view') || '') ? params.get('view') : phone ? 'list' : 'month') as View;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date')! : todayKey();
  const q = params.get('q') || '';
  const campaigns = list(params.get('campaign'));
  const themes = list(params.get('theme'));
  const statuses = list(params.get('status'));
  const accounts = list(params.get('account'));
  const group = (['day', 'campaign', 'theme'].includes(params.get('group') || '') ? params.get('group') : 'day') as ListGroup;

  const [posts, setPosts] = useState<PlannerPost[] | null>(null);
  const [unscheduled, setUnscheduled] = useState<PlannerPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [allCampaigns, setAllCampaigns] = useState<{ _id: string; name: string }[] | null>(null);
  const [users, setUsers] = useState<{ _id: string; name: string }[]>([]);
  const [search, setSearch] = useState(q);
  const [newPost, setNewPost] = useState<NewPostDefaults | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const loadSeq = useRef(0);

  /** Updates the address (replace for typing/filters; push for view and date). */
  const update = useCallback(
    (changes: Record<string, string | string[] | null>, push = false) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(changes)) {
        const value = Array.isArray(v) ? v.join(',') : v;
        if (value) next.set(k, value);
        else next.delete(k);
      }
      setParams(next, { replace: !push });
    },
    [params, setParams]
  );

  // Search is typed freely and applied after a short pause.
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim() || null }), 350);
    return () => clearTimeout(t);
  }, [search, q, update]);

  const range = useMemo(() => {
    if (view === 'month') {
      const start = monthGridStart(anchor);
      return { from: start, to: addDays(start, 41) };
    }
    if (view === 'week') {
      const start = weekStart(anchor);
      return { from: start, to: addDays(start, 6) };
    }
    return null;
  }, [view, anchor]);

  const filters = useMemo(
    () => ({
      ...(campaigns.length ? { campaignId: campaigns.join(',') } : {}),
      ...(themes.length ? { projectId: themes.join(',') } : {}),
      ...(statuses.length ? { status: statuses.join(',') } : {}),
      ...(accounts.length && isAdmin ? { createdBy: accounts.join(',') } : {}),
      ...(q ? { search: q } : {}),
      excludeArchived: 'true',
      include: 'publishing'
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.get('campaign'), params.get('theme'), params.get('status'), params.get('account'), q, isAdmin]
  );

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(null);
    try {
      const [main, tray] = await Promise.all([
        taskAPI.getAll({
          ...filters,
          ...(range ? { dateFrom: dayToISO(range.from), dateTo: `${range.to}T23:59:59.999Z` } : {}),
          limit: 3000
        }),
        view === 'list' ? Promise.resolve(null) : taskAPI.getAll({ ...filters, unscheduled: 'true', limit: 500 })
      ]);
      if (seq !== loadSeq.current) return; // a newer request is on its way
      setPosts(main.data.tasks || []);
      setUnscheduled(tray ? tray.data.tasks || [] : []);
    } catch (e) {
      if (seq === loadSeq.current) setError(errorMessage(e, 'The Planner couldn’t load. Try again.'));
    }
  }, [filters, range, view]);

  useEffect(() => {
    load();
  }, [load]);

  // A post changed or was deleted elsewhere (its panel, Blue, Publishing): refresh quietly.
  usePostEvents(() => load());

  useEffect(() => {
    campaignAPI
      .getAll({ limit: 500 })
      .then((r) => setAllCampaigns((r.data.campaigns || []).map((c: any) => ({ _id: c._id, name: c.name }))))
      .catch(() => setAllCampaigns([]));
    if (isAdmin) {
      userAPI
        .getAll({ limit: 500 })
        .then((r) => setUsers((r.data.users || []).map((u: any) => ({ _id: u._id || u.id, name: `${u.firstName} ${u.lastName}`.trim() || u.email }))))
        .catch(() => setUsers([]));
    }
  }, [isAdmin]);

  // ← / → move through months or weeks; T jumps to today (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || view === 'list') return;
      if (document.querySelector('[role="dialog"], .MuiDrawer-root')) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key.toLowerCase() === 't') update({ date: null }, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const step = (dir: number) => {
    if (view === 'month') {
      const [y, m] = anchor.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      update({ date: d.toISOString().slice(0, 10) }, true);
    } else {
      update({ date: addDays(anchor, dir * 7) }, true);
    }
  };

  /** Move a post to a day (or out of the calendar), with Undo. */
  const move = async (id: string, day: string | null) => {
    const all = [...(posts || []), ...unscheduled];
    const post = all.find((p) => p._id === id);
    if (!post) return;
    if (!canMovePost(post)) {
      notify(`“${post.name}” is ${postStatusMeta(post.status).label.toLowerCase()}. Change its time in Publishing.`, { tone: 'info' });
      return;
    }
    const before = post.taskDate || null;
    const after = day ? dayToISO(day) : null;
    const apply = (value: string | null) => {
      const moved = { ...post, taskDate: value };
      const rest = (posts || []).filter((p) => p._id !== id);
      const restTray = unscheduled.filter((p) => p._id !== id);
      if (value) {
        setPosts([...rest, moved]);
        setUnscheduled(restTray);
      } else {
        setPosts(rest);
        setUnscheduled([moved, ...restTray]);
      }
    };
    apply(after);
    try {
      await taskAPI.update(id, { taskDate: after });
      announcePostChanged(id);
      notify(day ? `Moved “${post.name}” to ${formatDay(after, { relative: true })}` : `“${post.name}” no longer has a day`, {
        undo: async () => {
          try {
            await taskAPI.update(id, { taskDate: before });
            announcePostChanged(id);
            load();
          } catch (e) {
            notify(errorMessage(e, 'Couldn’t undo.'), { tone: 'error' });
          }
        }
      });
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t move the post.'), { tone: 'error' });
      load();
    }
  };

  const addPost = (day?: string) => setNewPost({ day, campaignId: campaigns.length === 1 ? campaigns[0] : undefined, projectId: themes.length === 1 ? themes[0] : undefined });

  // Filter menu (counts are for what's loaded in this view).
  const loaded = useMemo(() => [...(posts || []), ...unscheduled], [posts, unscheduled]);
  const facets: Facet[] = useMemo(() => {
    const count = (fn: (p: PlannerPost) => boolean) => loaded.filter(fn).length;
    const themeOptions = new Map<string, { label: string; campaign: string }>();
    for (const p of loaded) {
      const t = p.projectId && typeof p.projectId === 'object' ? p.projectId : null;
      const c = p.campaignId && typeof p.campaignId === 'object' ? p.campaignId : null;
      if (t) themeOptions.set(t._id, { label: campaigns.length === 1 ? t.name : `${c?.name || ''} › ${t.name}`, campaign: c?._id || '' });
    }
    const out: Facet[] = [
      {
        key: 'campaign',
        label: 'Campaign',
        options: (allCampaigns || []).map((c) => ({ value: c._id, label: c.name, color: campaignColor(c._id), count: count((p) => (p.campaignId as any)?._id === c._id) }))
      },
      {
        key: 'theme',
        label: 'Theme',
        options: [...themeOptions.entries()].map(([value, o]) => ({ value, label: o.label, count: count((p) => (p.projectId as any)?._id === value) }))
      },
      {
        key: 'status',
        label: 'Status',
        options: POST_STATUSES.map((s) => ({ value: s, label: postStatusMeta(s).label, color: postStatusMeta(s).dot, count: count((p) => toPostStatus(p.status) === s) }))
      }
    ];
    if (isAdmin && users.length) out.push({ key: 'account', label: 'Account', options: users.map((u) => ({ value: u._id, label: u.name })) });
    return out;
  }, [loaded, allCampaigns, users, isAdmin, campaigns.length]);

  const values = { campaign: campaigns, theme: themes, status: statuses, account: accounts };

  const rangeLabel = view === 'month' ? formatMonth(anchor) : view === 'week' ? formatDayRange(weekStart(anchor), addDays(weekStart(anchor), 6)) : 'All posts';
  const showsToday = view === 'month' ? anchor.slice(0, 7) === todayKey().slice(0, 7) : view === 'week' ? weekStart(anchor) === weekStart(todayKey()) : true;
  const noCampaigns = allCampaigns !== null && allCampaigns.length === 0;
  const filtered = Boolean(q || campaigns.length || themes.length || statuses.length || accounts.length);

  const viewSwitch = (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={view}
      onChange={(_, v) => v && update({ view: v }, true)}
      aria-label="View"
      sx={{ '& .MuiToggleButton-root': { textTransform: 'none', px: 1.25, py: 0.4, gap: 0.5, fontSize: 13 } }}
    >
      <ToggleButton value="month" aria-label="Month">
        <MonthIcon sx={{ fontSize: 16 }} /> {!phone && 'Month'}
      </ToggleButton>
      <ToggleButton value="week" aria-label="Week">
        <WeekIcon sx={{ fontSize: 16 }} /> {!phone && 'Week'}
      </ToggleButton>
      <ToggleButton value="list" aria-label="List">
        <ListIcon sx={{ fontSize: 16 }} /> {!phone && 'List'}
      </ToggleButton>
    </ToggleButtonGroup>
  );

  const trayDrop = useDropTarget((id, from) => from && move(id, null));

  const tray = (
    <Box
      {...trayDrop.bind}
      aria-label="No day yet"
      sx={{
        display: 'flex', flexDirection: 'column', gap: 0.75, p: 1, borderRadius: 'var(--r-card)', border: '1px solid var(--border)', minHeight: 160,
        bgcolor: trayDrop.over ? 'var(--bg-hover)' : 'var(--bg-subtle)', outline: trayDrop.over ? '2px dashed var(--border-strong)' : 'none', outlineOffset: -3
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)' }}>No day yet · {unscheduled.length}</Typography>
      <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mb: 0.5 }}>{phone ? 'Open a post to give it a day.' : 'Drag a post onto a day to plan it.'}</Typography>
      {unscheduled.map((p) => (
        <PostCard key={p._id} post={p} onOpen={openPost} variant="compact" draggable={!phone} />
      ))}
      {unscheduled.length === 0 && <Typography sx={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Every post has a day.</Typography>}
    </Box>
  );

  return (
    <Box>
      <PageHeader
        title="Planner"
        subtitle="Every post by day. Hover a post to preview it, click to open it, drag it to another day."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => addPost()} disabled={noCampaigns}>
            New post
          </Button>
        }
      />

      <Box sx={{ mb: 2 }}>
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search posts"
          quick={QUICK.map((c) => ({
            key: c.key,
            label: c.label,
            active: sameSet(statuses, c.statuses),
            onToggle: () => update({ status: sameSet(statuses, c.statuses) ? null : c.statuses })
          }))}
          facets={facets}
          values={values}
          onChange={(key, v) => update({ [key]: v })}
          onClear={() => {
            setSearch('');
            update({ q: null, campaign: null, theme: null, status: null, account: null });
          }}
          right={viewSwitch}
        />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        {view !== 'list' ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Tooltip title={view === 'month' ? 'Previous month (←)' : 'Previous week (←)'}>
                <IconButton size="small" onClick={() => step(-1)} aria-label={view === 'month' ? 'Previous month' : 'Previous week'}>
                  <PrevIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={view === 'month' ? 'Next month (→)' : 'Next week (→)'}>
                <IconButton size="small" onClick={() => step(1)} aria-label={view === 'month' ? 'Next month' : 'Next week'}>
                  <NextIcon />
                </IconButton>
              </Tooltip>
            </Box>
            <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }} aria-live="polite">
              {rangeLabel}
            </Typography>
            {!showsToday && (
              <Button size="small" onClick={() => update({ date: null }, true)}>
                Today
              </Button>
            )}
          </>
        ) : (
          <>
            <Typography component="h2" sx={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>
              {rangeLabel}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={group}
              onChange={(_, v) => v && update({ group: v === 'day' ? null : v })}
              aria-label="Group by"
              sx={{ ml: 1, '& .MuiToggleButton-root': { textTransform: 'none', px: 1, py: 0.25, fontSize: 12.5 } }}
            >
              <ToggleButton value="day">By day</ToggleButton>
              <ToggleButton value="campaign">By campaign</ToggleButton>
              <ToggleButton value="theme">By theme</ToggleButton>
            </ToggleButtonGroup>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {posts === null && !error && <CircularProgress size={16} sx={{ color: 'var(--text-muted)' }} />}
        {view !== 'list' && !wide && (
          <Button size="small" startIcon={<TrayIcon />} onClick={() => setTrayOpen(true)}>
            No day yet ({unscheduled.length})
          </Button>
        )}
      </Box>

      {error ? (
        <EmptyState title="The Planner couldn’t load" text={error} action={<Button onClick={load}>Try again</Button>} />
      ) : noCampaigns ? (
        <EmptyState icon={<EmptyIcon />} title="Plan your first posts" text="Posts live in campaigns. Create a campaign, then add posts here or let AI plan them." action={<Button variant="contained" component={RouterLink} to={paths.campaigns()}>Go to Campaigns</Button>} />
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: view !== 'list' && wide ? 'minmax(0, 1fr) 240px' : 'minmax(0, 1fr)', gap: 1.5, alignItems: 'start' }}>
          <Box sx={{ minWidth: 0, opacity: posts === null ? 0.6 : 1, transition: 'opacity var(--t-fast)' }}>
            {view === 'month' && <MonthView posts={posts || []} anchor={anchor} onOpen={openPost} onMove={move} onAdd={(d) => addPost(d)} />}
            {view === 'week' && <WeekView posts={posts || []} anchor={anchor} onOpen={openPost} onMove={move} onAdd={(d) => addPost(d)} />}
            {view === 'list' &&
              (posts && posts.length === 0 ? (
                <EmptyState
                  icon={<EmptyIcon />}
                  title={filtered ? 'No posts match' : 'No posts yet'}
                  text={filtered ? 'Try fewer filters.' : 'Add a post, or open a campaign and plan posts with AI.'}
                  action={filtered ? <Button onClick={() => update({ q: null, campaign: null, theme: null, status: null, account: null })}>Clear filters</Button> : <Button variant="contained" onClick={() => addPost()}>New post</Button>}
                />
              ) : (
                <ListView posts={posts || []} onOpen={openPost} group={group} />
              ))}
          </Box>
          {view !== 'list' && wide && <Box sx={{ position: 'sticky', top: 8 }}>{tray}</Box>}
        </Box>
      )}

      <Drawer anchor={phone ? 'bottom' : 'right'} open={trayOpen && !wide} onClose={() => setTrayOpen(false)} PaperProps={{ sx: { width: phone ? 'auto' : 320, maxHeight: phone ? '80dvh' : undefined, p: 1.5, bgcolor: 'var(--bg-panel)', backgroundImage: 'none' } }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <IconButton size="small" aria-label="Close" onClick={() => setTrayOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        {tray}
      </Drawer>

      <NewPostDialog open={Boolean(newPost)} defaults={newPost || undefined} onClose={() => setNewPost(null)} onCreated={() => load()} />
    </Box>
  );
}
