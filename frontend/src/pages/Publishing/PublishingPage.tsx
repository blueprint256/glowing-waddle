import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { LinkOff as DisconnectIcon, Add as AddIcon, Science as TestIcon, Send as SendIcon } from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import PostList, { PlatformBadge } from '../../components/Publishing/PostList';
import { publishingAPI, PLATFORM_ORDER, PLATFORM_LABELS, type Channel, type Post, type PublishingStatus, type PlatformId } from '../../services/publishing';
import { paths, type PublishingTab } from '../../lib/paths';
import { timeZoneName } from '../../lib/dates';
import { errorMessage, notify } from '../../store/toastStore';
import { announcePostChanged } from '../../store/aiJobsStore';
import { usePostEvents } from '../../components/posts/PostPanelHost';

/**
 * Publishing (decision 4): three tabs.
 * - Queue: what needs you (failed, post by hand), what's going out, and drafts
 * - Accounts: connected social accounts
 * - History: what went out (and what was cancelled)
 * Older addresses still work (?tab=upcoming|attention|draft → queue, done → history, channels → accounts).
 * ?item=<id> points out one scheduled copy (links from the Inbox and Blue).
 */

const PROVIDER_OF: Record<PlatformId, string> = { x: 'x', linkedin: 'linkedin', facebook: 'meta', instagram: 'meta', tiktok: 'tiktok', youtube: 'google' };
const OLD_TABS: Record<string, PublishingTab> = { upcoming: 'queue', attention: 'queue', draft: 'queue', done: 'history', channels: 'accounts' };
const PAGE = 50;
const ACCOUNT_TYPES: Record<string, string> = { organization: 'Company page', page: 'Page', business: 'Business', creator: 'Creator', channel: 'Channel' };

type HistoryFilter = 'all' | 'published' | 'cancelled';

export default function PublishingPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') || 'queue';
  const tab: PublishingTab = (['queue', 'accounts', 'history'].includes(raw) ? raw : OLD_TABS[raw] || 'queue') as PublishingTab;
  const item = params.get('item');

  const [status, setStatus] = useState<PublishingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attention, setAttention] = useState<Post[] | null>(null);
  const [upcoming, setUpcoming] = useState<Post[] | null>(null);
  const [upcomingTotal, setUpcomingTotal] = useState(0);
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [history, setHistory] = useState<Post[] | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [pointed, setPointed] = useState<Post | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<Channel | null>(null);

  // Old tab names become the new ones in the address.
  useEffect(() => {
    if (raw !== tab) {
      const next = new URLSearchParams(params);
      if (tab === 'queue') next.delete('tab');
      else next.set('tab', tab);
      setParams(next, { replace: true });
    }
  }, [raw, tab, params, setParams]);

  const setTab = (t: PublishingTab) => {
    const next = new URLSearchParams();
    if (t !== 'queue') next.set('tab', t);
    setParams(next, { replace: true });
  };

  // Messages after returning from a platform's sign-in.
  useEffect(() => {
    const c = params.get('connect');
    if (!c) return;
    const count = Number(params.get('count') || 0);
    if (c === 'ok') notify(count ? `Connected ${count} account${count === 1 ? '' : 's'}` : 'Account connected');
    else notify(params.get('message') || 'Couldn’t connect the account.', { tone: 'error' });
    const next = new URLSearchParams(params);
    ['connect', 'count', 'message'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  }, [params, setParams]);

  const loadStatus = useCallback(async () => {
    try {
      const s = await publishingAPI.status();
      setStatus(s);
      return s;
    } catch (e) {
      setError(errorMessage(e, 'Publishing couldn’t load. Try again.'));
      return null;
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const [a, u, d] = await Promise.all([
        publishingAPI.list({ status: 'attention', limit: 100 }),
        publishingAPI.list({ status: 'upcoming', limit: 100 }),
        publishingAPI.list({ status: 'draft', limit: 100 })
      ]);
      setAttention(a.posts);
      setUpcoming(u.posts);
      setUpcomingTotal(u.total);
      setDrafts(d.posts);
    } catch (e) {
      setError(errorMessage(e, 'Publishing couldn’t load. Try again.'));
    }
  }, []);

  const loadHistory = useCallback(
    async (page: number, filter: HistoryFilter) => {
      try {
        const r = await publishingAPI.list({ status: filter === 'all' ? 'published,cancelled' : filter, limit: PAGE, page });
        setHistory((prev) => (page === 1 ? r.posts : [...(prev || []), ...r.posts]));
        setHistoryTotal(r.total);
      } catch (e) {
        setError(errorMessage(e, 'Publishing couldn’t load. Try again.'));
      }
    },
    []
  );

  const loadChannels = useCallback(async () => {
    try {
      setChannels(await publishingAPI.channels());
    } catch (e) {
      setError(errorMessage(e, 'Your accounts couldn’t load. Try again.'));
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    const s = await loadStatus();
    if (!s?.available) return;
    if (tab === 'queue') await loadQueue();
    else if (tab === 'history') {
      setHistoryPage(1);
      await loadHistory(1, historyFilter);
    } else await loadChannels();
  }, [tab, historyFilter, loadStatus, loadQueue, loadHistory, loadChannels]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  usePostEvents(() => {
    if (tab === 'queue') loadQueue();
  });

  // The pointed-out item, even when it isn't in the current tab's first page.
  useEffect(() => {
    if (!item) {
      setPointed(null);
      return;
    }
    publishingAPI
      .get(item)
      .then(setPointed)
      .catch(() => setPointed(null));
  }, [item]);

  // Check back while something is going out or about to.
  useEffect(() => {
    if (tab !== 'queue') return;
    const soon = (upcoming || []).some((p) => ['publishing', 'processing'].includes(p.status) || (p.scheduledAt && new Date(p.scheduledAt).getTime() < Date.now() + 60_000));
    if (!soon) return;
    const t = setInterval(() => {
      loadQueue();
      loadStatus();
    }, 8000);
    return () => clearInterval(t);
  }, [tab, upcoming, loadQueue, loadStatus]);

  const changed = (message?: string, post?: Post) => {
    if (message) notify(message);
    loadStatus();
    if (tab === 'queue') loadQueue();
    else if (tab === 'history') {
      setHistoryPage(1);
      loadHistory(1, historyFilter);
    }
    if (pointed) publishingAPI.get(pointed.id).then(setPointed).catch(() => setPointed(null));
    // The post's own status follows Publishing.
    if (post?.task?.id) announcePostChanged(post.task.id);
  };

  const connect = async (platform: PlatformId) => {
    setBusy(platform);
    try {
      window.location.href = await publishingAPI.connect(PROVIDER_OF[platform], paths.publishing('accounts'));
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t start connecting.'), { tone: 'error' });
      setBusy(null);
    }
  };

  const addTest = async (platform: PlatformId) => {
    setBusy(platform);
    try {
      await publishingAPI.addTestChannel(platform);
      notify(`Test ${PLATFORM_LABELS[platform]} account added`);
      loadChannels();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t add the test account.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (c: Channel) => {
    setDisconnecting(null);
    setBusy(c.id);
    try {
      const r = await publishingAPI.disconnect(c.id);
      notify(r?.message || `Disconnected ${c.platformName} · ${c.name}`);
      loadChannels();
      loadStatus();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t disconnect.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const counts = status?.counts;
  const pointedShown = useMemo(() => {
    if (!pointed) return false;
    const all = [...(attention || []), ...(upcoming || []), ...drafts, ...(history || [])];
    return all.some((p) => p.id === pointed.id);
  }, [pointed, attention, upcoming, drafts, history]);

  const header = (
    <PageHeader
      title="Publishing"
      subtitle={`What goes out where and when. Schedule a post from the post itself (Publish or schedule). Times are in your time zone (${timeZoneName()}).`}
      actions={
        <Button component={RouterLink} to={paths.planner({ view: 'list', status: 'Ready' })} startIcon={<SendIcon />}>
          Ready posts
        </Button>
      }
    />
  );

  if (error) {
    return (
      <Box>
        {header}
        <EmptyState title="Publishing couldn’t load" text={error} action={<Button onClick={refresh}>Try again</Button>} />
      </Box>
    );
  }
  if (status && !status.available) {
    return (
      <Box>
        {header}
        <EmptyState title="Publishing isn’t available" text={status.reason} />
      </Box>
    );
  }

  return (
    <Box>
      {header}

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2, minHeight: 36, borderBottom: '1px solid var(--border)', '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontSize: 14 } }}>
        <Tab value="queue" label={`Queue${counts ? ` (${counts.attention + counts.upcoming})` : ''}`} />
        <Tab value="accounts" label="Accounts" />
        <Tab value="history" label="History" />
      </Tabs>

      {pointed && !pointedShown && (
        <Section title="The item you opened">
          <PostList posts={[pointed]} onChanged={changed} highlight={pointed.id} />
        </Section>
      )}

      {tab === 'queue' &&
        (attention === null || upcoming === null ? (
          <Loading />
        ) : attention.length === 0 && upcoming.length === 0 && drafts.length === 0 ? (
          <EmptyState
            icon={<SendIcon />}
            title="Nothing in the queue"
            text="Open a post that’s Ready and choose “Publish or schedule”. Platforms that aren’t connected still work as reminders to post by hand."
            action={
              <Button variant="contained" component={RouterLink} to={paths.planner({ view: 'list', status: 'Ready' })}>
                See Ready posts
              </Button>
            }
          />
        ) : (
          <>
            {attention.length > 0 && (
              <Section title="Needs you" count={attention.length} tone="attention" hint="Didn’t go out, or waiting for you to post by hand.">
                <PostList posts={attention} onChanged={changed} highlight={item} />
              </Section>
            )}
            <Section title="Going out" count={upcomingTotal} hint={upcomingTotal > upcoming.length ? `Showing the next ${upcoming.length}.` : undefined}>
              <PostList posts={upcoming} onChanged={changed} highlight={item} emptyText="Nothing scheduled." />
            </Section>
            {drafts.length > 0 && (
              <Section title="Drafts" count={drafts.length} hint="Saved in Publishing but not scheduled.">
                <PostList posts={drafts} onChanged={changed} highlight={item} />
              </Section>
            )}
          </>
        ))}

      {tab === 'history' &&
        (history === null ? (
          <Loading />
        ) : (
          <>
            <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }} role="group" aria-label="Show">
              {(['all', 'published', 'cancelled'] as HistoryFilter[]).map((f) => (
                <Chip
                  key={f}
                  label={f === 'all' ? 'All' : f === 'published' ? 'Published' : 'Cancelled'}
                  onClick={() => setHistoryFilter(f)}
                  variant={historyFilter === f ? 'filled' : 'outlined'}
                  aria-pressed={historyFilter === f}
                />
              ))}
            </Box>
            <PostList posts={history} onChanged={changed} highlight={item} emptyText={historyFilter === 'cancelled' ? 'Nothing cancelled.' : 'Nothing has gone out yet.'} />
            {historyTotal > history.length && (
              <Button
                sx={{ mt: 1.5 }}
                onClick={() => {
                  const next = historyPage + 1;
                  setHistoryPage(next);
                  loadHistory(next, historyFilter);
                }}
              >
                Show more ({historyTotal - history.length} left)
              </Button>
            )}
          </>
        ))}

      {tab === 'accounts' &&
        (channels === null ? (
          <Loading />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
            {PLATFORM_ORDER.map((p) => {
              const info = status?.platforms.find((x) => x.id === p);
              const accounts = channels.filter((ch) => ch.platform === p);
              return (
                <Box key={p} component="section" aria-label={PLATFORM_LABELS[p]} sx={{ p: 2, border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-panel)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <PlatformBadge platform={p} />
                    <Typography sx={{ fontWeight: 600, fontSize: 15, flex: 1, color: 'var(--text-strong)' }}>{PLATFORM_LABELS[p]}</Typography>
                    {info?.ready ? (
                      <Button size="small" variant="outlined" startIcon={busy === p ? <CircularProgress size={14} /> : <AddIcon />} disabled={busy === p} onClick={() => connect(p)}>
                        Connect
                      </Button>
                    ) : (
                      <Chip size="small" label="Post by hand for now" />
                    )}
                  </Box>
                  {accounts.map((ch) => (
                    <Box key={ch.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                      <Avatar src={ch.avatarUrl || undefined} sx={{ width: 26, height: 26, fontSize: 12 }}>
                        {ch.name.slice(0, 1)}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: 14 }}>
                          {ch.name}
                          {ch.username ? ` · @${ch.username}` : ''}
                        </Typography>
                        {ch.status !== 'active' && (
                          <Typography sx={{ fontSize: 12.5, color: 'var(--st-attention-fg)' }}>
                            Needs reconnecting{ch.lastError ? `: ${ch.lastError}` : ''}
                          </Typography>
                        )}
                      </Box>
                      {ch.simulated && <Chip size="small" label="Test" sx={{ height: 20 }} />}
                      {ch.accountType !== 'person' && !ch.simulated && <Chip size="small" label={ACCOUNT_TYPES[ch.accountType] || ch.accountType} sx={{ height: 20 }} />}
                      {ch.status !== 'active' && info?.ready && (
                        <Button size="small" onClick={() => connect(p)}>
                          Reconnect
                        </Button>
                      )}
                      <Tooltip title="Disconnect">
                        <span>
                          <IconButton size="small" aria-label={`Disconnect ${ch.name}`} disabled={busy === ch.id} onClick={() => setDisconnecting(ch)}>
                            <DisconnectIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  ))}
                  {!accounts.length && (
                    <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {info?.ready
                        ? 'No accounts connected.'
                        : 'This platform isn’t switched on yet. You can still plan posts for it: Blueprint reminds you when it’s time to post by hand.'}
                    </Typography>
                  )}
                  {status?.testMode && !accounts.some((a) => a.simulated) && (
                    <Button size="small" startIcon={<TestIcon />} sx={{ mt: 1 }} disabled={busy === p} onClick={() => addTest(p)}>
                      Add a test account
                    </Button>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}

      <Dialog open={Boolean(disconnecting)} onClose={() => setDisconnecting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Disconnect {disconnecting?.platformName}?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            “{disconnecting?.name}” will be disconnected and anything scheduled to it will be cancelled. You can connect it again later.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnecting(null)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={() => disconnecting && disconnect(disconnecting)}>
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function Loading() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
      <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
    </Box>
  );
}

function Section({ title, count, hint, tone, children }: { title: string; count?: number; hint?: string; tone?: 'attention'; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Typography component="h2" sx={{ fontSize: 15, fontWeight: 700, color: tone === 'attention' ? 'var(--st-attention-fg)' : 'var(--text-strong)' }}>
          {title}
          {count !== undefined ? ` · ${count}` : ''}
        </Typography>
        {hint && <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{hint}</Typography>}
      </Box>
      {children}
    </Box>
  );
}
