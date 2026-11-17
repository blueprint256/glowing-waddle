import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import {
  publishingAPI,
  toLocalInput,
  PLATFORM_ORDER,
  PLATFORM_LABELS,
  type Channel,
  type PlatformId,
  type PublishingStatus,
  type MediaChoice,
  type TargetCheck,
  type PostPayload
} from '../../services/publishing';
import { librarySrc } from '../../services/library';
import { PlatformBadge } from './PostList';

interface Props {
  open: boolean;
  taskId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

const TIKTOK_PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me'
};

interface TikTokState {
  privacy: string;
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  disclose: boolean;
  brandOrganic: boolean;
  brandedContent: boolean;
}

function defaultTime(taskDate: string | null): string {
  const now = new Date();
  if (taskDate) {
    const d = new Date(taskDate);
    // Task dates are stored as UTC midnight: post at 9:00 local time that day.
    const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0);
    if (local.getTime() > now.getTime() + 5 * 60_000) return toLocalInput(local);
  }
  const next = new Date(now.getTime() + 60 * 60_000);
  next.setMinutes(0, 0, 0);
  return toLocalInput(next);
}

/**
 * Publish a task: choose accounts (or "post by hand" reminders), caption, files and time. Each
 * platform's rules are checked live; TikTok shows the creator's own settings as its review requires.
 */
export default function PublishDialog({ open, taskId, onClose, onDone }: Props) {
  const [status, setStatus] = useState<PublishingStatus | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [media, setMedia] = useState<MediaChoice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<Set<PlatformId>>(new Set());
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Set<number>>(new Set());
  const [when, setWhen] = useState<'now' | 'schedule' | 'draft'>('schedule');
  const [at, setAt] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const [ytPrivacy, setYtPrivacy] = useState('public');
  const [ytKids, setYtKids] = useState(false);
  const [tt, setTt] = useState<TikTokState>({ privacy: '', allowComments: true, allowDuet: true, allowStitch: true, disclose: false, brandOrganic: false, brandedContent: false });
  const [ttInfo, setTtInfo] = useState<Record<string, any> | null>(null);

  const [checks, setChecks] = useState<TargetCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const checkSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    setSubmitError(null);
    setChecks([]);
    Promise.all([publishingAPI.status(), publishingAPI.channels(), publishingAPI.taskMedia(taskId)])
      .then(([s, ch, tm]) => {
        setStatus(s);
        setChannels(ch.filter((c) => c.status === 'active'));
        setMedia(tm.media);
        setText(tm.task.content || '');
        setYtTitle(tm.task.name.slice(0, 100));
        setFiles(new Set(tm.media.map((m, i) => (m.isMain ? i : -1)).filter((i) => i >= 0)));
        setAt(defaultTime(tm.task.taskDate));
        setSelected(new Set());
        setManual(new Set());
        setWhen('schedule');
      })
      .catch((e) => setLoadError(e?.response?.data?.message || 'Could not open publishing'))
      .finally(() => setLoading(false));
  }, [open, taskId]);

  const selectedChannels = channels.filter((c) => selected.has(c.id));
  const tiktokChannel = selectedChannels.find((c) => c.platform === 'tiktok');
  const hasYouTube = selectedChannels.some((c) => c.platform === 'youtube');
  const platformsInPlay = useMemo(() => {
    const set = new Set<PlatformId>(selectedChannels.map((c) => c.platform));
    manual.forEach((p) => set.add(p));
    return PLATFORM_ORDER.filter((p) => set.has(p));
  }, [selectedChannels, manual]);

  // TikTok: the creator's own settings (privacy choices, disabled interactions) must drive the form.
  useEffect(() => {
    setTtInfo(null);
    if (!tiktokChannel) return;
    publishingAPI
      .channelOptions(tiktokChannel.id)
      .then((info) => {
        setTtInfo(info);
        setTt((s) => ({ ...s, allowComments: info.commentDisabled ? false : s.allowComments, allowDuet: info.duetDisabled ? false : s.allowDuet, allowStitch: info.stitchDisabled ? false : s.allowStitch }));
      })
      .catch((e) => setTtInfo({ error: e?.response?.data?.message || 'Could not load the TikTok account settings' }));
  }, [tiktokChannel?.id]);

  const payload = (): PostPayload => ({
    taskId,
    text,
    media: media.filter((_m, i) => files.has(i)).map((m) => ({ source: m.source, url: m.url, assetId: m.assetId })),
    targets: [...selectedChannels.map((c) => ({ channelId: c.id })), ...[...manual].map((platform) => ({ platform }))],
    when,
    scheduledAt: when === 'schedule' && at ? new Date(at).toISOString() : undefined,
    options: {
      ...(hasYouTube ? { youtube: { title: ytTitle, privacy: ytPrivacy, madeForKids: ytKids } } : {}),
      ...(tiktokChannel
        ? {
            tiktok: {
              privacy: tt.privacy || undefined,
              disableComments: !tt.allowComments,
              disableDuet: !tt.allowDuet,
              disableStitch: !tt.allowStitch,
              brandOrganic: tt.disclose && tt.brandOrganic,
              brandedContent: tt.disclose && tt.brandedContent
            }
          }
        : {})
    }
  });

  // Live rule checks (debounced).
  useEffect(() => {
    if (!open || loading || (!selected.size && !manual.size)) {
      setChecks([]);
      return;
    }
    const seq = ++checkSeq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await publishingAPI.check(payload());
        if (seq === checkSeq.current) setChecks(r.targets);
      } catch (e: any) {
        if (seq === checkSeq.current) setChecks([{ key: 'error', label: 'Problem', platform: 'x', mode: 'auto', problems: [{ level: 'error', message: e?.response?.data?.message || 'Could not check the post' }] }]);
      } finally {
        if (seq === checkSeq.current) setChecking(false);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, selected, manual, text, files, ytTitle, tt.privacy]);

  const ttProblems: string[] = [];
  if (tiktokChannel) {
    if (!tt.privacy) ttProblems.push('Choose who can see the TikTok post.');
    if (tt.disclose && !tt.brandOrganic && !tt.brandedContent) ttProblems.push('Say whether the TikTok post promotes your brand, someone else’s, or both.');
    if (tt.disclose && tt.brandedContent && tt.privacy === 'SELF_ONLY') ttProblems.push('Branded content can’t be private on TikTok.');
  }
  const errors = checks.some((c) => c.problems.some((p) => p.level === 'error')) || ttProblems.length > 0;
  const nothingChosen = !selected.size && !manual.size;

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const posts = await publishingAPI.create(payload());
      const n = posts.length;
      onDone(when === 'now' ? `Publishing to ${n} place${n === 1 ? '' : 's'} now` : when === 'draft' ? 'Saved as a draft' : `Scheduled ${n} post${n === 1 ? '' : 's'}`);
    } catch (e: any) {
      const details: TargetCheck[] | undefined = e?.response?.data?.details;
      if (Array.isArray(details)) setChecks(details);
      setSubmitError(e?.response?.data?.message || 'Could not schedule the post');
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Publish</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} />
          </Box>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : status && !status.available ? (
          <Alert severity="info">{status.reason}</Alert>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '260px 1fr' }, gap: 3 }}>
            {/* Where */}
            <Box>
              <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', mb: 1 }}>Where</Typography>
              {PLATFORM_ORDER.map((p) => {
                const accounts = channels.filter((c) => c.platform === p);
                return (
                  <Box key={p} sx={{ mb: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                      <PlatformBadge platform={p} size={20} />
                      <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)' }}>{PLATFORM_LABELS[p]}</Typography>
                    </Box>
                    {accounts.map((c) => (
                      <FormControlLabel
                        key={c.id}
                        sx={{ display: 'flex', ml: 0.5, '& .MuiFormControlLabel-label': { fontSize: 'var(--fs-sm)' } }}
                        control={<Checkbox size="small" checked={selected.has(c.id)} onChange={() => toggle(selected, c.id, setSelected)} />}
                        label={`${c.name}${c.simulated ? ' (test)' : ''}`}
                      />
                    ))}
                    <FormControlLabel
                      sx={{ display: 'flex', ml: 0.5, '& .MuiFormControlLabel-label': { fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' } }}
                      control={<Checkbox size="small" checked={manual.has(p)} onChange={() => toggle(manual, p, setManual)} />}
                      label="Post by hand (reminder)"
                    />
                  </Box>
                );
              })}
              <Link component={RouterLink} to="/publishing?tab=channels" sx={{ fontSize: 'var(--fs-xs)' }}>
                Connect accounts
              </Link>
            </Box>

            {/* What & when */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <Box>
                <TextField label="Caption" multiline minRows={4} maxRows={12} fullWidth value={text} onChange={(e) => setText(e.target.value)} />
                {platformsInPlay.length > 0 && (
                  <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', mt: 0.5 }}>
                    {[...text].length.toLocaleString()} characters ·{' '}
                    {platformsInPlay
                      .map((p) => {
                        const max = status?.platforms.find((x) => x.id === p)?.rules.maxText;
                        return max ? `${PLATFORM_LABELS[p]} max ${max.toLocaleString()}` : '';
                      })
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                )}
              </Box>

              <Box>
                <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mb: 1 }}>Files</Typography>
                {media.length === 0 ? (
                  <Typography sx={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>This task has no pictures yet. Text-only posts work on X, LinkedIn and Facebook.</Typography>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {media.map((m, i) => (
                      <Box
                        key={i}
                        onClick={() => toggle(files, i, setFiles)}
                        role="checkbox"
                        aria-checked={files.has(i)}
                        tabIndex={0}
                        title={m.label}
                        sx={{
                          width: 88,
                          height: 88,
                          borderRadius: 'var(--r-card)',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          position: 'relative',
                          border: '2px solid',
                          borderColor: files.has(i) ? 'var(--link)' : 'var(--border)',
                          bgcolor: 'var(--bg-subtle)'
                        }}
                      >
                        {m.kind === 'image' && m.previewUrl ? (
                          <img src={librarySrc(m.previewUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: files.has(i) ? 1 : 0.55 }} />
                        ) : (
                          <Typography sx={{ fontSize: 'var(--fs-2xs)', p: 1 }}>{m.label}</Typography>
                        )}
                        <Checkbox size="small" checked={files.has(i)} sx={{ position: 'absolute', top: -4, right: -4, pointerEvents: 'none' }} />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              {hasYouTube && (
                <Box sx={{ p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)' }}>YouTube</Typography>
                  <TextField size="small" label="Video title" value={ytTitle} onChange={(e) => setYtTitle(e.target.value.slice(0, 100))} />
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TextField select size="small" label="Visibility" value={ytPrivacy} onChange={(e) => setYtPrivacy(e.target.value)} sx={{ minWidth: 160 }}>
                      <MenuItem value="public">Public</MenuItem>
                      <MenuItem value="unlisted">Unlisted</MenuItem>
                      <MenuItem value="private">Private</MenuItem>
                    </TextField>
                    <FormControlLabel control={<Switch checked={ytKids} onChange={(e) => setYtKids(e.target.checked)} />} label="Made for kids" />
                  </Box>
                </Box>
              )}

              {tiktokChannel && (
                <Box sx={{ p: 1.5, border: '1px solid var(--border)', borderRadius: 'var(--r-card)', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography sx={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)' }}>
                    TikTok{ttInfo?.creatorName ? ` · posting as ${ttInfo.creatorName}` : ''}
                  </Typography>
                  {ttInfo?.error ? (
                    <Alert severity="warning">{ttInfo.error}</Alert>
                  ) : !ttInfo ? (
                    <CircularProgress size={18} />
                  ) : (
                    <>
                      <TextField
                        select
                        size="small"
                        label="Who can see this post"
                        value={tt.privacy}
                        onChange={(e) => setTt({ ...tt, privacy: e.target.value })}
                        sx={{ maxWidth: 260 }}
                        SelectProps={{ displayEmpty: true }}
                        InputLabelProps={{ shrink: true }}
                      >
                        <MenuItem value="" disabled>
                          Choose…
                        </MenuItem>
                        {(ttInfo.privacyOptions || []).map((o: string) => (
                          <MenuItem key={o} value={o} disabled={tt.disclose && tt.brandedContent && o === 'SELF_ONLY'}>
                            {TIKTOK_PRIVACY_LABELS[o] || o}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <FormControlLabel control={<Checkbox size="small" checked={tt.allowComments} disabled={ttInfo.commentDisabled} onChange={(e) => setTt({ ...tt, allowComments: e.target.checked })} />} label="Allow comments" />
                        <FormControlLabel control={<Checkbox size="small" checked={tt.allowDuet} disabled={ttInfo.duetDisabled} onChange={(e) => setTt({ ...tt, allowDuet: e.target.checked })} />} label="Allow Duet" />
                        <FormControlLabel control={<Checkbox size="small" checked={tt.allowStitch} disabled={ttInfo.stitchDisabled} onChange={(e) => setTt({ ...tt, allowStitch: e.target.checked })} />} label="Allow Stitch" />
                      </Box>
                      <FormControlLabel control={<Switch checked={tt.disclose} onChange={(e) => setTt({ ...tt, disclose: e.target.checked })} />} label="This post promotes a brand, product or service" />
                      {tt.disclose && (
                        <Box sx={{ pl: 2, display: 'flex', flexDirection: 'column' }}>
                          <FormControlLabel control={<Checkbox size="small" checked={tt.brandOrganic} onChange={(e) => setTt({ ...tt, brandOrganic: e.target.checked })} />} label="Your brand (labelled “Promotional content”)" />
                          <FormControlLabel control={<Checkbox size="small" checked={tt.brandedContent} onChange={(e) => setTt({ ...tt, brandedContent: e.target.checked })} />} label="Branded content for someone else (labelled “Paid partnership”)" />
                        </Box>
                      )}
                      <Typography sx={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                        By posting, you agree to TikTok’s{' '}
                        <Link href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">
                          Music Usage Confirmation
                        </Link>
                        {tt.disclose && tt.brandedContent && (
                          <>
                            {' '}and{' '}
                            <Link href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">
                              Branded Content Policy
                            </Link>
                          </>
                        )}
                        . It may take a few minutes for the video to appear on the profile.
                      </Typography>
                    </>
                  )}
                </Box>
              )}

              <Box>
                <Typography sx={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', mb: 0.5 }}>When</Typography>
                <RadioGroup row value={when} onChange={(e) => setWhen(e.target.value as typeof when)}>
                  <FormControlLabel value="schedule" control={<Radio size="small" />} label="Schedule" />
                  <FormControlLabel value="now" control={<Radio size="small" />} label="Now" />
                  <FormControlLabel value="draft" control={<Radio size="small" />} label="Save as draft" />
                </RadioGroup>
                {when === 'schedule' && (
                  <TextField type="datetime-local" size="small" value={at} onChange={(e) => setAt(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ mt: 0.5 }} />
                )}
              </Box>

              {(checks.length > 0 || ttProblems.length > 0) && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {checks.map((c) =>
                    c.problems.length === 0 ? (
                      <Typography key={c.key} sx={{ fontSize: 'var(--fs-xs)', color: 'var(--success-text, var(--text-muted))' }}>
                        ✓ {c.label}
                      </Typography>
                    ) : (
                      <Alert key={c.key} severity={c.problems.some((p) => p.level === 'error') ? 'error' : 'warning'} sx={{ py: 0 }}>
                        <strong>{c.label}:</strong> {c.problems.map((p) => p.message).join(' ')}
                      </Alert>
                    )
                  )}
                  {ttProblems.map((m) => (
                    <Alert key={m} severity="error" sx={{ py: 0 }}>
                      {m}
                    </Alert>
                  ))}
                </Box>
              )}
              {submitError && <Alert severity="error">{submitError}</Alert>}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {checking && <CircularProgress size={16} sx={{ mr: 'auto', ml: 2 }} />}
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={loading || !!loadError || nothingChosen || submitting || (when !== 'draft' && (errors || checking))}>
          {submitting ? 'Saving…' : when === 'now' ? 'Publish now' : when === 'draft' ? 'Save draft' : 'Schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
