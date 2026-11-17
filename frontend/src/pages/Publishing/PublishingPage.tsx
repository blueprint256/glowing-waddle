import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Avatar, Box, Button, Chip, CircularProgress, IconButton, Snackbar, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { LinkOff as DisconnectIcon, Add as AddIcon, Science as TestIcon } from '@mui/icons-material';
import PostList, { PlatformBadge } from '../../components/Publishing/PostList';
import { publishingAPI, PLATFORM_ORDER, PLATFORM_LABELS, type Channel, type Post, type PublishingStatus, type PlatformId } from '../../services/publishing';

type TabId = 'upcoming' | 'attention' | 'done' | 'draft' | 'channels';

const PROVIDER_OF: Record<PlatformId, string> = { x: 'x', linkedin: 'linkedin', facebook: 'meta', instagram: 'meta', tiktok: 'tiktok', youtube: 'google' };

/**
 * Publishing: what's going out, what needs attention (failed / post by hand), what went out, and the
 * connected accounts. Platforms the admin hasn't switched on yet still work as "post by hand".
 */
export default function PublishingPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId) || 'upcoming';
  const [status, setStatus] = useState<PublishingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const setTab = (t: TabId) => {
    const next = new URLSearchParams();
    if (t !== 'upcoming') next.set('tab', t);
    setParams(next, { replace: true });
  };

  // Messages after returning from a platform's sign-in.
  useEffect(() => {
    const c = params.get('connect');
    if (!c) return;
    setToast(c === 'ok' ? `Connected ${params.get('count') || ''} account${params.get('count') === '1' ? '' : 's'}`.replace('  ', ' ') : params.get('message') || 'Could not connect the account');
    const next = new URLSearchParams(params);
    ['connect', 'count', 'message'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  }, [params, setParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await publishingAPI.status();
      setStatus(s);
      if (!s.available) return;
      if (tab === 'channels') {
        setChannels(await publishingAPI.channels());
      } else {
        const r = await publishingAPI.list({ status: tab === 'draft' ? 'draft' : tab, limit: 100 });
        setPosts(r.posts);
        setTotal(r.total);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load publishing');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh while something is being published.
  useEffect(() => {
    if (tab !== 'upcoming' || !posts.some((p) => p.status === 'publishing' || p.status === 'processing' || (p.scheduledAt && new Date(p.scheduledAt).getTime() < Date.now() + 60_000))) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [tab, posts, load]);

  const connect = async (platform: PlatformId) => {
    setBusy(platform);
    try {
      window.location.href = await publishingAPI.connect(PROVIDER_OF[platform], '/publishing?tab=channels');
    } catch (e: any) {
      setToast(e?.response?.data?.message || 'Could not start connecting');
      setBusy(null);
    }
  };

  const addTest = async (platform: PlatformId) => {
    setBusy(platform);
    try {
      await publishingAPI.addTestChannel(platform);
      setToast(`Test ${PLATFORM_LABELS[platform]} account added`);
      load();
    } catch (e: any) {
      setToast(e?.response?.data?.message || 'Could not add the test account');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (c: Channel) => {
    if (!window.confirm(`Disconnect ${c.platformName} · ${c.name}? Scheduled posts to it will be cancelled.`)) return;
    setBusy(c.id);
    try {
      await publishingAPI.disconnect(c.id);
      setToast('Disconnected');
      load();
    } catch (e: any) {
      setToast(e?.response?.data?.message || 'Could not disconnect');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Alert severity="error">{error}</Alert>;
  if (status && !status.available) {
    return (
      <Box>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Publishing
        </Typography>
        <Alert severity="info">{status.reason}</Alert>
      </Box>
    );
  }

  const c = status?.counts;
  return (
    <Box>
      <Typography variant="h4">Publishing</Typography>
      <Typography sx={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', mt: 0.5, mb: 2 }}>
        Schedule tasks from their page with the Publish button. Platforms that aren't connected yet still work as “post by hand” reminders.
      </Typography>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}>
        <Tab value="upcoming" label={`Upcoming${c?.upcoming ? ` (${c.upcoming})` : ''}`} />
        <Tab value="attention" label={`Needs attention${c?.attention ? ` (${c.attention})` : ''}`} />
        <Tab value="done" label="Published" />
        <Tab value="draft" label={`Drafts${c?.drafts ? ` (${c.drafts})` : ''}`} />
        <Tab value="channels" label="Accounts" />
      </Tabs>

      {loading && !posts.length && !channels.length ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={22} />
        </Box>
      ) : tab === 'channels' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          {PLATFORM_ORDER.map((p) => {
            const info = status?.platforms.find((x) => x.id === p);
            const accounts = channels.filter((ch) => ch.platform === p);
            return (
              <Box key={p} sx={{ p: 2, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-raised)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <PlatformBadge platform={p} />
                  <Typography sx={{ fontWeight: 'var(--fw-semibold)', flex: 1 }}>{PLATFORM_LABELS[p]}</Typography>
                  {info?.ready ? (
                    <Button size="small" variant="outlined" startIcon={busy === p ? <CircularProgress size={14} /> : <AddIcon />} disabled={busy === p} onClick={() => connect(p)}>
                      Connect
                    </Button>
                  ) : (
                    <Chip size="small" label="Not switched on yet" />
                  )}
                </Box>
                {accounts.map((ch) => (
                  <Box key={ch.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                    <Avatar src={ch.avatarUrl || undefined} sx={{ width: 24, height: 24, fontSize: 12 }}>
                      {ch.name.slice(0, 1)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ch.name}
                        {ch.username ? ` · @${ch.username}` : ''}
                      </Typography>
                      {ch.status !== 'active' && (
                        <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--danger-text)' }}>
                          Needs reconnecting{ch.lastError ? `: ${ch.lastError}` : ''}
                        </Typography>
                      )}
                    </Box>
                    {ch.simulated && <Chip size="small" label="Test" sx={{ height: 20 }} />}
                    {ch.accountType !== 'person' && !ch.simulated && <Chip size="small" label={ch.accountType} sx={{ height: 20 }} />}
                    {ch.status !== 'active' && info?.ready && (
                      <Button size="small" onClick={() => connect(p)}>
                        Reconnect
                      </Button>
                    )}
                    <Tooltip title="Disconnect">
                      <IconButton size="small" disabled={busy === ch.id} onClick={() => disconnect(ch)}>
                        <DisconnectIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
                {!accounts.length && (
                  <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                    {info?.ready ? 'No accounts connected.' : 'Your administrator switches this on once the platform approves the app. Until then, use “post by hand”.'}
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
      ) : (
        <>
          <PostList
            posts={posts}
            onChanged={(m) => {
              if (m) setToast(m);
              load();
            }}
            emptyText={
              tab === 'upcoming'
                ? 'Nothing scheduled. Open a task and press Publish.'
                : tab === 'attention'
                  ? 'All good: no failed posts and nothing waiting to be posted by hand.'
                  : tab === 'done'
                    ? 'Nothing published yet.'
                    : 'No drafts.'
            }
          />
          {total > posts.length && <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mt: 1 }}>Showing the first {posts.length} of {total}.</Typography>}
        </>
      )}

      <Snackbar open={!!toast} autoHideDuration={5000} onClose={() => setToast(null)} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
