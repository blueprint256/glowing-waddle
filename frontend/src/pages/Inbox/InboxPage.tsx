import { useCallback, useEffect, useMemo, useState } from 'react';
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
  FormControlLabel,
  IconButton,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery
} from '@mui/material';
import { ArrowBack as BackIcon, DoneAll as ReadAllIcon, Edit as ComposeIcon, Send as SendIcon, Tune as PrefsIcon } from '@mui/icons-material';
import { inboxAPI, timeAgo, CATEGORY_LABELS, type InboxAction, type InboxBox, type InboxItem, type Thread } from '../../services/inbox';
import { useInboxStore } from '../../store/inboxStore';
import { useBlueStore } from '../../store/blueStore';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import { useOpenPost } from '../../components/posts/PostPanelHost';
import { appPath } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';

const BOXES: { id: InboxBox; label: string }[] = [
  { id: 'action', label: 'Needs action' },
  { id: 'update', label: 'Updates' },
  { id: 'message', label: 'Messages' }
];

/**
 * The Inbox: reminders that need a decision, updates (including messages from the Blueprint team),
 * and conversations with the team. Each item can be answered with its buttons or a typed reply.
 */
export default function InboxPage() {
  const navigate = useNavigate();
  const narrow = useMediaQuery('(max-width: 900px)');
  const [params, setParams] = useSearchParams();
  const box = (params.get('box') as InboxBox) || 'action';
  const selectedId = params.get('item');
  const { user } = useAuthStore();
  const summary = useInboxStore((s) => s.summary);
  const refreshBadge = useInboxStore((s) => s.refresh);
  const blue = useBlueStore();

  const [items, setItems] = useState<InboxItem[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openPost = useOpenPost();
  // Links in reminders: a post opens beside the Inbox; anything else goes to its page.
  const go = (link: string) => {
    const path = appPath(link);
    if (!path) return;
    const post = path.match(/^\/posts\/([a-f0-9]{24})(?:[?#]|$)/i);
    if (post) openPost(post[1]);
    else navigate(path);
  };
  const [composeOpen, setComposeOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const refreshCounts = useCallback(() => refreshBadge(isAdmin), [refreshBadge, isAdmin]);

  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await inboxAPI.items(box, showClosed ? 'all' : 'open');
      setItems(r.items);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load your Inbox');
    } finally {
      setLoading(false);
    }
  }, [box, showClosed]);

  useEffect(() => {
    load();
  }, [load]);

  // ?item=<id> selects an item in the current box (links from Blue and Claude use this).
  const selected = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId]);

  const updateItem = (next: InboxItem) => {
    setItems((list) => list.map((i) => (i.id === next.id ? next : i)));
  };

  const open = async (item: InboxItem) => {
    setQuery({ item: item.id });
    if (!item.read) {
      try {
        updateItem(await inboxAPI.read(item.id));
        refreshCounts();
      } catch {
        /* not important */
      }
    }
  };

  const afterAction = (message: string, next?: InboxItem, openBlue?: string) => {
    if (message) notify(message);
    if (next) updateItem(next);
    if (openBlue) {
      if (blue.status?.available) {
        blue.newChat();
        blue.setOpen(true);
        void blue.send(openBlue);
      } else {
        notify('Blue isn’t available on your account, so the post can’t be drafted automatically.', { tone: 'info' });
      }
    }
    refreshCounts();
  };

  const counts: Record<InboxBox, number> = { action: summary.action, update: summary.updates, message: summary.messages };
  const showList = !narrow || !selected;
  const showDetail = !narrow || Boolean(selected);

  return (
    <Box>
      <PageHeader
        title="Inbox"
        subtitle="Reminders that need you, updates, and messages with the Blueprint team."
        actions={
          <>
            <Tooltip title="Mark everything here as read">
              <IconButton
                aria-label="Mark everything here as read"
                onClick={async () => {
                  try {
                    await inboxAPI.readAll(box);
                    load();
                    refreshCounts();
                  } catch (e) {
                    notify(errorMessage(e), { tone: 'error' });
                  }
                }}
              >
                <ReadAllIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reminder settings">
              <IconButton aria-label="Reminder settings" onClick={() => setPrefsOpen(true)}>
                <PrefsIcon />
              </IconButton>
            </Tooltip>
            <Button variant="contained" startIcon={<ComposeIcon />} onClick={() => setComposeOpen(true)}>
              Message support
            </Button>
          </>
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(280px, 380px) 1fr', gap: 2, alignItems: 'start' }}>
        {showList && (
          <Box sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-raised)', overflow: 'hidden' }}>
            <Tabs
              value={box}
              onChange={(_e, v) => setQuery({ box: v === 'action' ? null : v, item: null })}
              variant="fullWidth"
              sx={{ minHeight: 40, borderBottom: '1px solid var(--border)', '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontSize: 'var(--fs-sm)' } }}
            >
              {BOXES.map((b) => (
                <Tab key={b.id} value={b.id} label={counts[b.id] ? `${b.label} (${counts[b.id]})` : b.label} />
              ))}
            </Tabs>
            <Box sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid var(--border)' }}>
              <FormControlLabel control={<Switch size="small" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />} label={<Typography sx={{ fontSize: 'var(--fs-xs)' }}>Show finished</Typography>} />
            </Box>
            {error && (
              <Alert severity="error" sx={{ m: 1 }}>
                {error}
              </Alert>
            )}
            {loading && !items.length ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={20} />
              </Box>
            ) : !items.length ? (
              <Typography sx={{ p: 3, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
                {box === 'action' ? 'Nothing needs you right now.' : box === 'update' ? 'No updates.' : 'No conversations yet. Use “Message support” to ask the Blueprint team anything.'}
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
                {items.map((i) => (
                  <Box
                    key={i.id}
                    component="button"
                    type="button"
                    onClick={() => open(i)}
                    sx={{
                      all: 'unset',
                      boxSizing: 'border-box',
                      width: '100%',
                      cursor: 'pointer',
                      display: 'block',
                      px: 1.5,
                      py: 1.25,
                      borderBottom: '1px solid var(--border)',
                      bgcolor: i.id === selectedId ? 'var(--bg-hover)' : 'transparent',
                      opacity: i.status === 'open' ? 1 : 0.6,
                      '&:hover': { bgcolor: 'var(--bg-hover)' }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {!i.read && i.status === 'open' && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--link)', flexShrink: 0 }} aria-label="Unread" />}
                      <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: i.read ? 'var(--fw-regular, 400)' : 'var(--fw-semibold)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</Typography>
                      <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', flexShrink: 0 }}>{timeAgo(i.box === 'message' ? i.updatedAt : i.createdAt)}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mt: 0.25 }}>
                      {CATEGORY_LABELS[i.category] ? `${CATEGORY_LABELS[i.category]} · ` : ''}
                      {i.status !== 'open' ? i.resultMessage || 'Finished' : i.body.replace(/\s+/g, ' ')}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        {showDetail && (
          <Box sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-raised)', minHeight: 320, p: 2.5 }}>
            {selected ? (
              <ItemDetail key={selected.id} item={selected} narrow={narrow} onBack={() => setQuery({ item: null })} onDone={afterAction} onNavigate={go} />
            ) : (
              <Typography sx={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', textAlign: 'center', mt: 10 }}>Choose an item to see it here.</Typography>
            )}
          </Box>
        )}
      </Box>

      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={() => {
          setComposeOpen(false);
          notify('Sent to the Blueprint team');
          setQuery({ box: 'message', item: null });
          refreshCounts();
        }}
      />
      <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} onSaved={() => notify('Saved')} />
    </Box>
  );
}

function ItemDetail({
  item,
  narrow,
  onBack,
  onDone,
  onNavigate
}: {
  item: InboxItem;
  narrow: boolean;
  onBack: () => void;
  onDone: (message: string, next?: InboxItem, openBlue?: string) => void;
  onNavigate: (path: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputFor, setInputFor] = useState<InboxAction | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [reply, setReply] = useState('');
  const [thread, setThread] = useState<Thread | null>(null);
  const [confirming, setConfirming] = useState<{ action: InboxAction; value?: string } | null>(null);

  const loadThread = useCallback(async () => {
    if (!item.threadId) return;
    try {
      setThread(await inboxAPI.thread(item.threadId));
    } catch {
      setThread(null);
    }
  }, [item.threadId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  const run = async (action: InboxAction, value?: string, confirmed = false) => {
    if (action.link) {
      onNavigate(action.link);
      return;
    }
    if (action.input && value === undefined) {
      setInputFor(action);
      setInputValue('');
      return;
    }
    if (action.confirm && !confirmed) {
      setConfirming({ action, value });
      return;
    }
    setConfirming(null);
    setBusy(action.id);
    setError(null);
    try {
      const r = await inboxAPI.act(item.id, action.id, value);
      setInputFor(null);
      onDone(r.message, r.item, r.openBlue);
    } catch (e) {
      setError(errorMessage(e, 'That didn’t work. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    setBusy('reply');
    setError(null);
    try {
      if (item.threadId && item.box === 'message') {
        setThread(await inboxAPI.sendMessage(item.threadId, text));
        setReply('');
        onDone('Sent');
      } else {
        const r = await inboxAPI.reply(item.id, text);
        setReply('');
        onDone(r.message, r.item, r.openBlue);
        if (r.threadId) setThread(await inboxAPI.thread(r.threadId));
      }
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t send the reply.'));
    } finally {
      setBusy(null);
    }
  };

  const isSystem = item.source === 'system';
  const canAct = item.status === 'open';
  const replyPlaceholder = item.box === 'message' ? 'Write a reply…' : isSystem ? 'Or type a reply, e.g. “yes”, “remind me later”…' : 'Reply to the Blueprint team…';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        {narrow && (
          <IconButton size="small" onClick={onBack} aria-label="Back to the list">
            <BackIcon fontSize="small" />
          </IconButton>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
            {CATEGORY_LABELS[item.category] && <Chip size="small" label={CATEGORY_LABELS[item.category]} sx={{ height: 20, fontSize: 'var(--fs-3xs)' }} />}
            {item.status !== 'open' && <Chip size="small" label={item.status === 'expired' ? 'Expired' : 'Finished'} sx={{ height: 20, fontSize: 'var(--fs-3xs)' }} />}
            {item.snoozedUntil && <Chip size="small" label={`Snoozed until ${new Date(item.snoozedUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`} sx={{ height: 20, fontSize: 'var(--fs-3xs)' }} />}
          </Box>
          <Typography sx={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)' }}>{item.title}</Typography>
          <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            {item.fromName} · {new Date(item.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </Typography>
        </Box>
      </Box>

      {!thread && item.body && <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>{item.body}</Typography>}

      {thread?.messages && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 420, overflowY: 'auto' }}>
          {thread.messages.map((m) => (
            <Box
              key={m.id}
              sx={{
                alignSelf: m.fromAdmin ? 'flex-start' : 'flex-end',
                maxWidth: '85%',
                px: 1.5,
                py: 1,
                borderRadius: 'var(--r-card)',
                bgcolor: m.fromAdmin ? 'var(--bg-subtle)' : 'var(--bg-hover)',
                border: '1px solid var(--border)'
              }}
            >
              <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', mb: 0.25 }}>
                {m.fromAdmin ? m.author : 'You'} · {timeAgo(m.at)}
              </Typography>
              <Typography sx={{ fontSize: 'var(--fs-sm)', whiteSpace: 'pre-wrap' }}>{m.body}</Typography>
            </Box>
          ))}
          {thread.status === 'resolved' && <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', textAlign: 'center' }}>Marked as resolved. Reply to reopen it.</Typography>}
        </Box>
      )}

      {item.status !== 'open' && item.resultMessage && <Alert severity="success">{item.resultMessage}</Alert>}

      {canAct && item.actions.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {item.actions.map((a) => (
            <Button
              key={a.id}
              variant={a.style === 'primary' ? 'contained' : 'outlined'}
              color={a.style === 'danger' ? 'error' : 'primary'}
              disabled={busy !== null}
              startIcon={busy === a.id ? <CircularProgress size={14} color="inherit" /> : undefined}
              onClick={() => run(a)}
            >
              {a.label}
            </Button>
          ))}
          {isSystem && !item.actions.some((a) => a.id === 'keep') && (
            <Button variant="text" disabled={busy !== null} onClick={() => run({ id: 'dismiss', label: 'Close' })}>
              Close
            </Button>
          )}
        </Box>
      )}
      {!isSystem && canAct && item.box === 'update' && item.actions.length === 0 && (
        <Box>
          <Button variant="text" disabled={busy !== null} onClick={() => run({ id: 'dismiss', label: 'Close' })}>
            Close
          </Button>
        </Box>
      )}

      {inputFor && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            autoFocus
            label={inputFor.input?.label}
            placeholder={inputFor.input?.placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            sx={{ flex: 1, minWidth: 240 }}
            helperText={inputFor.input?.optional ? 'Optional' : undefined}
          />
          <Button variant="contained" disabled={busy !== null || (!inputFor.input?.optional && !inputValue.trim())} onClick={() => run(inputFor, inputValue.trim())}>
            {inputFor.label}
          </Button>
          <Button onClick={() => setInputFor(null)}>Cancel</Button>
        </Box>
      )}

      {confirming && (
        <Box role="alertdialog" aria-label="Confirm" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1.5, borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
          <Typography sx={{ flex: 1, minWidth: 200, fontSize: 14 }}>{confirming.action.confirm}</Typography>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy !== null} onClick={() => run(confirming.action, confirming.value, true)}>
            {confirming.action.label}
          </Button>
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {(canAct || item.box === 'message' || !isSystem) && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', borderTop: '1px solid var(--border)', pt: 2 }}>
          <TextField
            fullWidth
            multiline
            maxRows={6}
            size="small"
            placeholder={replyPlaceholder}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendReply();
              }
            }}
          />
          <IconButton color="primary" onClick={sendReply} disabled={busy !== null || !reply.trim()} aria-label="Send">
            {busy === 'reply' ? <CircularProgress size={18} /> : <SendIcon />}
          </IconButton>
        </Box>
      )}
    </Box>
  );
}

function ComposeDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setSubject('');
      setBody('');
      setError(null);
    }
  }, [open]);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await inboxAPI.startThread(subject, body);
      onSent();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not send the message');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Message the Blueprint team</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} inputProps={{ maxLength: 200 }} autoFocus />
        <TextField label="Message" value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={5} inputProps={{ maxLength: 5000 }} />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={send} disabled={busy || !subject.trim() || !body.trim()}>
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PreferencesDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [muted, setMuted] = useState<string[]>([]);
  useEffect(() => {
    if (open) inboxAPI.preferences().then((p) => setMuted(p.muted)).catch(() => undefined);
  }, [open]);
  const save = async () => {
    await inboxAPI.savePreferences(muted);
    onSaved();
    onClose();
  };
  const upcoming = !muted.includes('post_upcoming');
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reminder settings</DialogTitle>
      <DialogContent>
        <FormControlLabel
          control={<Switch checked={upcoming} onChange={(e) => setMuted(e.target.checked ? muted.filter((m) => m !== 'post_upcoming') : [...muted, 'post_upcoming'])} />}
          label="Remind me the day before a scheduled post goes out"
        />
        <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mt: 1 }}>
          Failed posts, posts due by hand, accounts to reconnect and messages from the Blueprint team always appear.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
