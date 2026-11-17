import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { DeleteOutline as DeleteIcon, Send as SendIcon } from '@mui/icons-material';
import { outreachAPI, timeAgo, type Announcement, type Audience, type MessageTemplate, type Thread } from '../../services/inbox';
import { userAPI } from '../../services/api';
import { toLocalInput } from '../../services/publishing';
import { useInboxStore } from '../../store/inboxStore';
import PageHeader from '../../components/ui/PageHeader';
import { useConfirm } from '../../components/ui/useConfirm';
import { notify } from '../../store/toastStore';

type TabId = 'overview' | 'compose' | 'sent' | 'support' | 'templates';

const CATEGORIES = [
  { value: 'announcement', label: 'Announcement' },
  { value: 'event', label: 'Upcoming day / event' },
  { value: 'tip', label: 'Tip' },
  { value: 'trend', label: 'News & trends' },
  { value: 'billing', label: 'Billing' }
];

const STATUS_LABEL: Record<Announcement['status'], string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending…',
  sent: 'Sent',
  cancelled: 'Cancelled',
  withdrawn: 'Withdrawn'
};

const emptyAudience = (): Audience => ({ everyone: false, roles: [], accessModes: [], sectors: [], tags: [], userIds: [] });

/**
 * Outreach (System Admin): message chosen groups of users, see what happened, answer support
 * conversations, and keep reusable templates. Users receive everything in their Inbox.
 */
export default function OutreachPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId) || 'overview';
  const setToast = (m: string) => notify(m);
  const [draftFrom, setDraftFrom] = useState<{ title: string; body: string; category: string } | null>(null);
  const setTab = (t: TabId) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  return (
    <Box>
      <PageHeader title="Outreach" subtitle="Send messages to chosen users (they arrive in their Inbox), follow up on what they do with them, and answer their questions." />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mb: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}>
        <Tab value="overview" label="Overview" />
        <Tab value="compose" label="New message" />
        <Tab value="sent" label="Sent & scheduled" />
        <Tab value="support" label="Support" />
        <Tab value="templates" label="Templates" />
      </Tabs>
      {tab === 'overview' && <Overview onGo={setTab} />}
      {tab === 'compose' && (
        <Compose
          initial={draftFrom}
          onDone={(m) => {
            setToast(m);
            setDraftFrom(null);
            setTab('sent');
          }}
          onToast={setToast}
        />
      )}
      {tab === 'sent' && <Sent onToast={setToast} />}
      {tab === 'support' && <Support onToast={setToast} />}
      {tab === 'templates' && (
        <Templates
          onUse={(t) => {
            setDraftFrom({ title: t.title, body: t.body, category: t.category });
            setTab('compose');
          }}
          onToast={setToast}
        />
      )}
    </Box>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <Box sx={{ p: 2, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-raised)' }}>{children}</Box>;
}

// ---------------------------------------------------------------------------

function Overview({ onGo }: { onGo: (t: TabId) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof outreachAPI.overview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    outreachAPI.overview().then(setData).catch((e) => setError(e?.response?.data?.message || 'Could not load the overview'));
  }, []);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <CircularProgress size={22} />;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
      <Card>
        <Typography sx={{ fontWeight: 'var(--fw-semibold)', mb: 1 }}>Support</Typography>
        <Typography sx={{ fontSize: 'var(--fs-sm)' }}>
          {data.support.open} open conversation{data.support.open === 1 ? '' : 's'}
          {data.support.unread ? `, ${data.support.unread} waiting for a reply` : ''}
        </Typography>
        <Button size="small" sx={{ mt: 1 }} onClick={() => onGo('support')}>
          Open support
        </Button>
      </Card>
      <Card>
        <Typography sx={{ fontWeight: 'var(--fw-semibold)', mb: 1 }}>Messages</Typography>
        <Typography sx={{ fontSize: 'var(--fs-sm)' }}>{data.scheduledMessages} scheduled to go out</Typography>
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Button size="small" variant="contained" onClick={() => onGo('compose')}>
            New message
          </Button>
          <Button size="small" onClick={() => onGo('sent')}>
            See results
          </Button>
        </Box>
      </Card>
      <Box sx={{ gridColumn: { md: '1 / span 2' } }}>
        <Card>
          <Typography sx={{ fontWeight: 'var(--fw-semibold)', mb: 0.5 }}>What users have waiting</Typography>
          <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mb: 1 }}>Totals only; users’ own reminders stay private.</Typography>
          {data.attention.length ? (
            data.attention.map((a) => (
              <Typography key={a.category} sx={{ fontSize: 'var(--fs-sm)' }}>
                {a.items} {a.label} ({a.users} user{a.users === 1 ? '' : 's'})
              </Typography>
            ))
          ) : (
            <Typography sx={{ fontSize: 'var(--fs-sm)' }}>Nothing waiting.</Typography>
          )}
        </Card>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------

function Compose({ initial, onDone, onToast }: { initial: { title: string; body: string; category: string } | null; onDone: (m: string) => void; onToast: (m: string) => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const [title, setTitle] = useState(initial?.title || '');
  const [body, setBody] = useState(initial?.body || '');
  const [category, setCategory] = useState(initial?.category || 'announcement');
  const [audience, setAudience] = useState<Audience>(emptyAudience());
  const [offerPost, setOfferPost] = useState(false);
  const [allowReplies, setAllowReplies] = useState(true);
  const [when, setWhen] = useState<'now' | 'schedule' | 'draft'>('now');
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setHours(9, 0, 0, 0);
    return toLocalInput(d);
  });
  const [options, setOptions] = useState<{ sectors: { value: string; count: number }[]; tags: { value: string; count: number }[] }>({ sectors: [], tags: [] });
  const [users, setUsers] = useState<{ id: string; label: string }[]>([]);
  const [count, setCount] = useState<{ count: number; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    outreachAPI.audienceOptions().then(setOptions).catch(() => undefined);
    userAPI
      .getAll({ limit: 1000 })
      .then((r) => setUsers((r.data?.users || []).filter((u: any) => u.isActive !== false).map((u: any) => ({ id: u._id || u.id, label: `${u.firstName || ''} ${u.lastName || ''}`.trim() + (u.email ? ` · ${u.email}` : '') }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      outreachAPI.audienceCount(audience).then(setCount).catch(() => setCount(null));
    }, 300);
    return () => clearTimeout(t);
  }, [audience]);

  const set = (patch: Partial<Audience>) => setAudience((a) => ({ ...a, ...patch }));
  const chosenUsers = useMemo(() => users.filter((u) => audience.userIds.includes(u.id)), [users, audience.userIds]);

  const submit = async () => {
    if (when === 'now' && count && !(await confirm({ title: `Send “${title}” now?`, body: `It goes to ${count.count} user${count.count === 1 ? '' : 's'}’ Inbox straight away.`, action: 'Send' }))) return;
    setBusy(true);
    setError(null);
    try {
      const a = await outreachAPI.create({ title, body, category, audience, offerPost, allowReplies, when, scheduledAt: when === 'schedule' ? new Date(at).toISOString() : undefined });
      onDone(a.status === 'sent' ? `Sent to ${a.recipientCount} user${a.recipientCount === 1 ? '' : 's'}` : a.status === 'scheduled' ? 'Scheduled' : 'Saved as a draft');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not save the message');
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    const name = window.prompt('Template name', title);
    if (!name) return;
    try {
      await outreachAPI.saveTemplate({ name, title, body, category });
      onToast('Template saved');
    } catch (e: any) {
      onToast(e?.response?.data?.message || 'Could not save the template');
    }
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, gap: 3, alignItems: 'start' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} inputProps={{ maxLength: 200 }} placeholder="e.g. World AIDS Day is on 1 December" />
        <TextField label="Message" value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={7} inputProps={{ maxLength: 10000 }} placeholder="What should they know, and what could they post?" />
        <TextField select label="Kind" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ maxWidth: 280 }}>
          {CATEGORIES.map((c) => (
            <MenuItem key={c.value} value={c.value}>
              {c.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel control={<Switch checked={offerPost} onChange={(e) => setOfferPost(e.target.checked)} />} label="Offer “Create a post from this” (Blue drafts it in each user’s brand voice)" />
        <FormControlLabel control={<Switch checked={allowReplies} onChange={(e) => setAllowReplies(e.target.checked)} />} label="Allow replies (they arrive under Support)" />

        <Box>
          <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mb: 0.5 }}>When</Typography>
          <RadioGroup row value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
            <FormControlLabel value="now" control={<Radio size="small" />} label="Send now" />
            <FormControlLabel value="schedule" control={<Radio size="small" />} label="Schedule" />
            <FormControlLabel value="draft" control={<Radio size="small" />} label="Save as draft" />
          </RadioGroup>
          {when === 'schedule' && <TextField type="datetime-local" size="small" value={at} onChange={(e) => setAt(e.target.value)} InputLabelProps={{ shrink: true }} />}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <SendIcon />} onClick={submit} disabled={busy || !title.trim() || !body.trim() || (when !== 'draft' && !count?.count)}>
            {when === 'now' ? 'Send' : when === 'schedule' ? 'Schedule' : 'Save draft'}
          </Button>
          <Button onClick={saveTemplate} disabled={!title.trim() || !body.trim()}>
            Save as template
          </Button>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Card>
          <Typography sx={{ fontWeight: 'var(--fw-semibold)', mb: 1 }}>Who gets it</Typography>
          <FormControlLabel control={<Checkbox checked={audience.everyone} onChange={(e) => set({ everyone: e.target.checked })} />} label="Everyone" />
          {!audience.everyone && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
              <Autocomplete
                multiple
                freeSolo
                size="small"
                options={options.sectors.map((s) => s.value)}
                value={audience.sectors}
                onChange={(_e, v) => set({ sectors: v })}
                getOptionLabel={(o) => {
                  const c = options.sectors.find((s) => s.value === o)?.count;
                  return c ? `${o} (${c})` : o;
                }}
                renderInput={(p) => <TextField {...p} label="Sector (from company info)" placeholder="e.g. Health" />}
              />
              <Autocomplete
                multiple
                freeSolo
                size="small"
                options={options.tags.map((t) => t.value)}
                value={audience.tags}
                onChange={(_e, v) => set({ tags: v.map((x) => x.toLowerCase()) })}
                renderInput={(p) => <TextField {...p} label="Tags" placeholder="e.g. pharmacy" />}
              />
              <Box>
                <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Part</Typography>
                {[
                  ['part_one', 'Part one (AI on)'],
                  ['part_two', 'Part two']
                ].map(([v, l]) => (
                  <FormControlLabel
                    key={v}
                    control={<Checkbox size="small" checked={audience.accessModes.includes(v)} onChange={(e) => set({ accessModes: e.target.checked ? [...audience.accessModes, v] : audience.accessModes.filter((x) => x !== v) })} />}
                    label={l}
                  />
                ))}
              </Box>
              <Autocomplete
                multiple
                size="small"
                options={users}
                value={chosenUsers}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_e, v) => set({ userIds: v.map((u) => u.id) })}
                getOptionLabel={(o) => o.label}
                renderInput={(p) => <TextField {...p} label="Also these users" />}
              />
              <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                Users must match every filter you fill in (any value within a filter). Users picked by name always get it.
              </Typography>
            </Box>
          )}
          <Alert severity={count?.count ? 'info' : 'warning'} sx={{ mt: 1.5, py: 0 }}>
            {count ? `${count.count} user${count.count === 1 ? '' : 's'} · ${count.description}` : 'Counting…'}
          </Alert>
        </Card>
        <Card>
          <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mb: 1 }}>Preview in a user’s Inbox</Typography>
          <Typography sx={{ fontWeight: 'var(--fw-semibold)' }}>{title || 'Title'}</Typography>
          <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mb: 1 }}>Blueprint team · now</Typography>
          <Typography sx={{ fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap' }}>{body || 'Your message'}</Typography>
          {offerPost && (
            <Button size="small" variant="contained" sx={{ mt: 1.5 }} disabled>
              Create a post from this
            </Button>
          )}
        </Card>
      </Box>
      {confirmDialog}
    </Box>
  );
}

// ---------------------------------------------------------------------------

function Sent({ onToast }: { onToast: (m: string) => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const [list, setList] = useState<Announcement[] | null>(null);
  const load = useCallback(() => {
    outreachAPI.announcements().then(setList).catch(() => setList([]));
  }, []);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      onToast(msg);
      load();
    } catch (e: any) {
      onToast(e?.response?.data?.message || 'That didn’t work');
    }
  };
  if (!list) return <CircularProgress size={22} />;
  if (!list.length) return <Typography sx={{ color: 'var(--text-muted)' }}>No messages yet.</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {list.map((a) => {
        const pct = (n: number) => (a.recipientCount ? `${Math.round((n / a.recipientCount) * 100)}%` : '0%');
        return (
          <Card key={a.id}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 'var(--fw-semibold)', flex: 1 }}>{a.title}</Typography>
              <Chip size="small" label={STATUS_LABEL[a.status]} color={a.status === 'sent' ? 'success' : a.status === 'scheduled' ? 'primary' : 'default'} />
            </Box>
            <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {a.audienceText}
              {a.status === 'scheduled' && a.scheduledAt ? ` · goes out ${new Date(a.scheduledAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
              {a.sentAt ? ` · sent ${timeAgo(a.sentAt)}` : ''}
            </Typography>
            {a.stats && (
              <Typography sx={{ fontSize: 'var(--fs-sm)', mt: 0.5 }}>
                {a.recipientCount} received · {a.stats.read} read ({pct(a.stats.read)}) · {a.stats.acted} acted ({pct(a.stats.acted)}) · {a.stats.replies} repl{a.stats.replies === 1 ? 'y' : 'ies'}
              </Typography>
            )}
            {a.error && <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--danger-text)' }}>Last attempt failed: {a.error}</Typography>}
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              {['draft', 'scheduled'].includes(a.status) && (
                <Button size="small" variant="outlined" onClick={async () => (await confirm({ title: `Send “${a.title}” now?`, action: 'Send' })) && act(() => outreachAPI.send(a.id), 'Sent')}>
                  Send now
                </Button>
              )}
              {['draft', 'scheduled'].includes(a.status) && (
                <Button size="small" onClick={() => act(() => outreachAPI.cancel(a.id), 'Cancelled')}>
                  Cancel
                </Button>
              )}
              {a.status === 'sent' && (
                <Button size="small" color="error" onClick={async () => (await confirm({ title: 'Withdraw this message?', body: 'It’s removed from everyone’s Inbox.', action: 'Withdraw', danger: true })) && act(() => outreachAPI.withdraw(a.id), 'Withdrawn')}>
                  Withdraw
                </Button>
              )}
              {['draft', 'cancelled'].includes(a.status) && (
                <Button size="small" onClick={() => act(() => outreachAPI.remove(a.id), 'Deleted')}>
                  Delete
                </Button>
              )}
            </Box>
          </Card>
        );
      })}
      {confirmDialog}
    </Box>
  );
}

// ---------------------------------------------------------------------------

function Support({ onToast }: { onToast: (m: string) => void }) {
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [current, setCurrent] = useState<Thread | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshBadge = useInboxStore((s) => s.refresh);

  const load = useCallback(() => {
    outreachAPI.threads(status).then(setThreads).catch(() => setThreads([]));
  }, [status]);
  useEffect(load, [load]);

  const openThread = async (id: string) => {
    setCurrent(await outreachAPI.thread(id));
    load();
    refreshBadge(true);
  };

  const send = async () => {
    if (!current || !reply.trim()) return;
    setBusy(true);
    try {
      setCurrent(await outreachAPI.reply(current.id, reply.trim()));
      setReply('');
      load();
    } catch (e: any) {
      onToast(e?.response?.data?.message || 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  const toggleResolved = async () => {
    if (!current) return;
    setCurrent(await outreachAPI.setThreadStatus(current.id, current.status === 'open' ? 'resolved' : 'open'));
    load();
    refreshBadge(true);
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 340px) 1fr' }, gap: 2, alignItems: 'start' }}>
      <Card>
        <TextField select size="small" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} sx={{ mb: 1, minWidth: 160 }}>
          <MenuItem value="open">Open</MenuItem>
          <MenuItem value="resolved">Resolved</MenuItem>
          <MenuItem value="all">All</MenuItem>
        </TextField>
        {!threads ? (
          <CircularProgress size={20} />
        ) : !threads.length ? (
          <Typography sx={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>No conversations.</Typography>
        ) : (
          threads.map((t) => (
            <Box
              key={t.id}
              component="button"
              type="button"
              onClick={() => openThread(t.id)}
              sx={{ all: 'unset', boxSizing: 'border-box', display: 'block', width: '100%', cursor: 'pointer', py: 1, borderBottom: '1px solid var(--border)', bgcolor: current?.id === t.id ? 'var(--bg-hover)' : 'transparent' }}
            >
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {t.unread > 0 && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--link)' }} />}
                <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: t.unread ? 'var(--fw-semibold)' : undefined, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</Typography>
                <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{timeAgo(t.lastMessageAt)}</Typography>
              </Box>
              <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.user.name}
                {t.user.company ? ` · ${t.user.company}` : ''} — {t.preview}
              </Typography>
            </Box>
          ))
        )}
      </Card>
      <Card>
        {!current ? (
          <Typography sx={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Choose a conversation.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 'var(--fw-semibold)' }}>{current.subject}</Typography>
                <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  {current.user.name}
                  {current.user.email ? ` · ${current.user.email}` : ''}
                  {current.user.company ? ` · ${current.user.company}` : ''}
                </Typography>
              </Box>
              <Button size="small" onClick={toggleResolved}>
                {current.status === 'open' ? 'Mark resolved' : 'Reopen'}
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 440, overflowY: 'auto' }}>
              {current.messages?.map((m) => (
                <Box key={m.id} sx={{ alignSelf: m.fromAdmin ? 'flex-end' : 'flex-start', maxWidth: '85%', px: 1.5, py: 1, borderRadius: 'var(--r-card)', bgcolor: m.fromAdmin ? 'var(--bg-hover)' : 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
                  <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                    {m.author} · {timeAgo(m.at)}
                  </Typography>
                  <Typography sx={{ fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap' }}>{m.body}</Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <TextField fullWidth multiline maxRows={6} size="small" placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
              <IconButton color="primary" onClick={send} disabled={busy || !reply.trim()} aria-label="Send">
                {busy ? <CircularProgress size={18} /> : <SendIcon />}
              </IconButton>
            </Box>
          </Box>
        )}
      </Card>
    </Box>
  );
}

// ---------------------------------------------------------------------------

function Templates({ onUse, onToast }: { onUse: (t: MessageTemplate) => void; onToast: (m: string) => void }) {
  const [list, setList] = useState<MessageTemplate[] | null>(null);
  const load = useCallback(() => {
    outreachAPI.templates().then(setList).catch(() => setList([]));
  }, []);
  useEffect(load, [load]);
  if (!list) return <CircularProgress size={22} />;
  if (!list.length) return <Typography sx={{ color: 'var(--text-muted)' }}>No templates yet. Write a message and press “Save as template”.</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {list.map((t) => (
        <Card key={t.id}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 'var(--fw-semibold)' }}>{t.name}</Typography>
              <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title} — {t.body}
              </Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={() => onUse(t)}>
              Use
            </Button>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                onClick={async () => {
                  await outreachAPI.deleteTemplate(t.id);
                  onToast('Template deleted');
                  load();
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Card>
      ))}
    </Box>
  );
}
