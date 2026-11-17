import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery
} from '@mui/material';
import { AutoAwesome as AiIcon, ExpandMore as MoreIcon, ExpandLess as LessIcon, WarningAmber as WarnIcon } from '@mui/icons-material';
import { campaignAPI, type PlanDraft, type PlanTheme } from '../../services/api';
import { addDays, dayKey, formatDay, formatDayRange, todayKey } from '../../lib/dates';
import { paths } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * Plan with AI (decision 17): describe what you want → the AI drafts themes and posts → you review,
 * edit, untick what you don't want → only then are they created.
 */

type Step = 'setup' | 'working' | 'review';

interface Row {
  include: boolean;
  open: boolean;
}

export interface PlanCampaign {
  _id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
}

const PER_WEEK = [0, 1, 2, 3, 4, 5, 7, 10, 14];

export default function PlanWithAIDialog({ open, campaign, onClose, onCreated }: { open: boolean; campaign: PlanCampaign; onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const phone = !useMediaQuery('(min-width: 48em)');
  const [step, setStep] = useState<Step>('setup');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [perWeek, setPerWeek] = useState(0);
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [themes, setThemes] = useState<PlanTheme[]>([]);
  const [rows, setRows] = useState<Row[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const run = useRef(0);

  // Fresh start each time it opens: the campaign's period (from today if it already started).
  useEffect(() => {
    if (!open) return;
    const today = todayKey();
    let start = dayKey(campaign.startDate) || today;
    if (start < today) start = today;
    let end = dayKey(campaign.endDate) || '';
    if (!end || end < start) end = addDays(start, 27);
    setFrom(start);
    setTo(end);
    setPerWeek(0);
    setNotes('');
    setDraft(null);
    setThemes([]);
    setRows([]);
    setError(null);
    setStep('setup');
    setConfirmClose(false);
  }, [open, campaign]);

  useEffect(() => {
    if (step !== 'working') return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [step]);

  const periodWrong = !from || !to || to < from;

  const generate = async () => {
    if (periodWrong) return;
    const mine = ++run.current;
    setError(null);
    setStep('working');
    try {
      const res = await campaignAPI.plan(campaign._id, { from, to, notes: notes.trim() || undefined, perWeek: perWeek || undefined });
      if (mine !== run.current) return; // cancelled
      setDraft(res);
      setThemes(res.themes);
      setRows(res.themes.map((t) => t.posts.map(() => ({ include: true, open: false }))));
      setStep('review');
    } catch (e) {
      if (mine !== run.current) return;
      setError(errorMessage(e, 'The AI couldn’t plan this campaign. Try again.'));
      setStep('setup');
    }
  };

  const cancelWorking = () => {
    run.current++;
    setStep('setup');
  };

  const editPost = (ti: number, pi: number, change: Partial<PlanTheme['posts'][number]>) =>
    setThemes((all) => all.map((t, i) => (i !== ti ? t : { ...t, posts: t.posts.map((p, j) => (j !== pi ? p : { ...p, ...change })) })));
  const editTheme = (ti: number, change: Partial<PlanTheme>) => setThemes((all) => all.map((t, i) => (i !== ti ? t : { ...t, ...change })));
  const setRow = (ti: number, pi: number, change: Partial<Row>) => setRows((all) => all.map((r, i) => (i !== ti ? r : r.map((x, j) => (j !== pi ? x : { ...x, ...change })))));
  const setThemeIncluded = (ti: number, include: boolean) => setRows((all) => all.map((r, i) => (i !== ti ? r : r.map((x) => ({ ...x, include })))));

  const chosen = themes
    .map((t, ti) => ({ ...t, posts: t.posts.filter((_, pi) => rows[ti]?.[pi]?.include) }))
    .filter((t) => t.posts.length > 0 && t.name.trim());
  const chosenPosts = chosen.reduce((n, t) => n + t.posts.length, 0);
  const totalPosts = themes.reduce((n, t) => n + t.posts.length, 0);
  const namesMissing = themes.some((t, ti) => !t.name.trim() && rows[ti]?.some((r) => r.include));
  const titlesMissing = chosen.some((t) => t.posts.some((p) => !p.name.trim()));

  const create = async () => {
    if (!chosenPosts || creating || namesMissing || titlesMissing) return;
    setCreating(true);
    setError(null);
    try {
      const res = await campaignAPI.applyPlan(
        campaign._id,
        chosen.map((t) => ({ ...t, name: t.name.trim(), posts: t.posts.map((p) => ({ ...p, name: p.name.trim() })) }))
      );
      const firstDay = chosen.flatMap((t) => t.posts.map((p) => p.day)).filter((d): d is string => Boolean(d)).sort()[0];
      notify(res.message, {
        duration: 8000,
        action: { label: 'Open in Planner', run: () => navigate(paths.planner({ view: 'month', campaign: campaign._id, date: firstDay })) }
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t create the posts. Try again.'));
    } finally {
      setCreating(false);
    }
  };

  const requestClose = () => {
    if (creating) return;
    if (step === 'review' && totalPosts > 0) setConfirmClose(true);
    else {
      if (step === 'working') run.current++;
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={requestClose} maxWidth={step === 'review' ? 'md' : 'sm'} fullWidth fullScreen={phone && step === 'review'}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AiIcon sx={{ fontSize: 20, color: 'var(--text-muted)' }} />
        {step === 'review' ? 'Review the plan' : `Plan “${campaign.name}” with AI`}
      </DialogTitle>

      <DialogContent dividers={step === 'review'}>
        {step === 'setup' && (
          <Box
            component="form"
            id="plan-form"
            onSubmit={(e) => {
              e.preventDefault();
              generate();
            }}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
          >
            <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
              The AI drafts themes and posts (titles, briefs and captions) using your brand and this campaign. You check and change the draft before anything is added.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}>
              <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} required />
              <TextField
                label="To"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
                required
                error={Boolean(from && to && to < from)}
                helperText={from && to && to < from ? 'Ends before it starts' : undefined}
                inputProps={{ min: from || undefined }}
              />
              <TextField select label="Posts a week" value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))} sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                {PER_WEEK.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n === 0 ? 'Let AI decide' : n}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <TextField
              label="What should the posts focus on? (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              inputProps={{ maxLength: 2000 }}
              placeholder="e.g. Launch week first, then customer stories. Mention free delivery over 50,000."
            />
            {error && (
              <Typography role="alert" sx={{ fontSize: 13, color: 'var(--st-attention-fg)' }}>
                {error}
              </Typography>
            )}
          </Box>
        )}

        {step === 'working' && (
          <Box sx={{ py: 4, display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'stretch' }} aria-live="polite">
            <Typography sx={{ fontSize: 14, color: 'var(--text-strong)', fontWeight: 600 }}>Drafting the plan… {elapsed}s</Typography>
            <LinearProgress />
            <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Planning {formatDayRange(from, to)}. This usually takes 30 to 90 seconds. Nothing is added until you review it.
            </Typography>
          </Box>
        )}

        {step === 'review' && draft && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
              {totalPosts} post{totalPosts === 1 ? '' : 's'} in {themes.length} theme{themes.length === 1 ? '' : 's'}, {formatDayRange(draft.from, draft.to)}. Untick what you don’t want, change anything, then create. Open a post to see its brief and caption.
            </Typography>
            {themes.map((t, ti) => {
              const all = rows[ti] || [];
              const included = all.filter((r) => r.include).length;
              return (
                <Box key={ti} component="section" sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', overflow: 'hidden' }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1.25, bgcolor: 'var(--bg-subtle)' }}>
                    <Checkbox
                      size="small"
                      checked={included === all.length && all.length > 0}
                      indeterminate={included > 0 && included < all.length}
                      onChange={(e) => setThemeIncluded(ti, e.target.checked)}
                      inputProps={{ 'aria-label': `Include all posts in ${t.name || 'this theme'}` }}
                      sx={{ mt: 0.25 }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <TextField
                        size="small"
                        variant="standard"
                        value={t.name}
                        onChange={(e) => editTheme(ti, { name: e.target.value })}
                        fullWidth
                        error={!t.name.trim() && included > 0}
                        inputProps={{ 'aria-label': 'Theme name', style: { fontWeight: 700, fontSize: 15 } }}
                      />
                      <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 0.5 }}>
                        {t.existingId ? 'Adds to the theme you already have. ' : 'New theme. '}
                        {t.description}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', mt: 0.75 }}>
                      {included}/{all.length}
                    </Typography>
                  </Box>
                  {t.posts.map((p, pi) => {
                    const row = all[pi] || { include: false, open: false };
                    const outside = p.day && (p.day < draft.from || p.day > draft.to);
                    return (
                      <Box key={pi} sx={{ borderTop: '1px solid var(--border)', opacity: row.include ? 1 : 0.55 }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'auto minmax(0, 1fr) auto', sm: 'auto 150px minmax(0, 1fr) 110px auto' }, alignItems: 'center', gap: 1, px: 1.25, py: 0.75 }}>
                          <Checkbox size="small" checked={row.include} onChange={(e) => setRow(ti, pi, { include: e.target.checked })} inputProps={{ 'aria-label': `Include ${p.name}` }} />
                          <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.5 }}>
                            <TextField
                              size="small"
                              type="date"
                              value={p.day || ''}
                              onChange={(e) => editPost(ti, pi, { day: e.target.value || null })}
                              inputProps={{ 'aria-label': 'Day' }}
                              sx={{ '& input': { fontSize: 13, py: 0.75 } }}
                            />
                            {outside && (
                              <Tooltip title="Outside the period you asked for">
                                <WarnIcon sx={{ fontSize: 16, color: 'var(--st-attention-dot)' }} />
                              </Tooltip>
                            )}
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <TextField
                              size="small"
                              variant="standard"
                              value={p.name}
                              onChange={(e) => editPost(ti, pi, { name: e.target.value })}
                              fullWidth
                              error={row.include && !p.name.trim()}
                              inputProps={{ 'aria-label': 'Post title', style: { fontSize: 14 } }}
                            />
                            <Typography sx={{ display: { xs: 'block', sm: 'none' }, fontSize: 12, color: 'var(--text-muted)' }}>{p.day ? formatDay(`${p.day}T00:00:00Z`) : 'No day'}</Typography>
                          </Box>
                          <TextField
                            select
                            size="small"
                            value={p.status}
                            onChange={(e) => editPost(ti, pi, { status: e.target.value as 'Idea' | 'Draft' | 'Ready' })}
                            inputProps={{ 'aria-label': 'Status' }}
                            sx={{ display: { xs: 'none', sm: 'flex' }, '& .MuiSelect-select': { fontSize: 13, py: 0.75 } }}
                          >
                            <MenuItem value="Idea">Idea</MenuItem>
                            <MenuItem value="Draft">Draft</MenuItem>
                            <MenuItem value="Ready">Ready</MenuItem>
                          </TextField>
                          <IconButton size="small" onClick={() => setRow(ti, pi, { open: !row.open })} aria-label={row.open ? 'Hide brief and caption' : 'Show brief and caption'} aria-expanded={row.open}>
                            {row.open ? <LessIcon fontSize="small" /> : <MoreIcon fontSize="small" />}
                          </IconButton>
                        </Box>
                        <Collapse in={row.open} unmountOnExit>
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, px: 1.5, pb: 1.5, pt: 0.5 }}>
                            <Box sx={{ display: { xs: 'grid', sm: 'none' }, gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                              <TextField size="small" label="Day" type="date" value={p.day || ''} onChange={(e) => editPost(ti, pi, { day: e.target.value || null })} InputLabelProps={{ shrink: true }} />
                              <TextField select size="small" label="Status" value={p.status} onChange={(e) => editPost(ti, pi, { status: e.target.value as 'Idea' | 'Draft' | 'Ready' })}>
                                <MenuItem value="Idea">Idea</MenuItem>
                                <MenuItem value="Draft">Draft</MenuItem>
                                <MenuItem value="Ready">Ready</MenuItem>
                              </TextField>
                            </Box>
                            <TextField size="small" label="Brief" value={p.brief} onChange={(e) => editPost(ti, pi, { brief: e.target.value })} multiline minRows={2} fullWidth />
                            <TextField size="small" label="Caption" value={p.caption} onChange={(e) => editPost(ti, pi, { caption: e.target.value })} multiline minRows={3} fullWidth />
                          </Box>
                        </Collapse>
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
            {(namesMissing || titlesMissing) && (
              <Typography role="alert" sx={{ fontSize: 13, color: 'var(--st-attention-fg)' }}>
                {namesMissing ? 'Every theme needs a name.' : 'Every post needs a title.'}
              </Typography>
            )}
            {error && (
              <Typography role="alert" sx={{ fontSize: 13, color: 'var(--st-attention-fg)' }}>
                {error}
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {confirmClose ? (
          <>
            <Typography sx={{ fontSize: 13.5, mr: 'auto', pl: 1 }}>Discard this plan? Nothing has been added.</Typography>
            <Button onClick={() => setConfirmClose(false)}>Keep reviewing</Button>
            <Button color="error" onClick={onClose}>
              Discard
            </Button>
          </>
        ) : step === 'setup' ? (
          <>
            <Button onClick={requestClose}>Cancel</Button>
            <Button type="submit" form="plan-form" variant="contained" startIcon={<AiIcon />} disabled={periodWrong}>
              Draft a plan
            </Button>
          </>
        ) : step === 'working' ? (
          <Button onClick={cancelWorking}>Stop</Button>
        ) : (
          <>
            <Button onClick={() => setStep('setup')} disabled={creating} sx={{ mr: 'auto' }}>
              Start over
            </Button>
            <Button onClick={requestClose} disabled={creating}>
              Cancel
            </Button>
            <Button variant="contained" onClick={create} disabled={!chosenPosts || creating || namesMissing || titlesMissing}>
              {creating ? 'Creating…' : `Create ${chosenPosts} post${chosenPosts === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
