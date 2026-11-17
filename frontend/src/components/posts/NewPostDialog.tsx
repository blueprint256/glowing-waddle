import { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { campaignAPI, projectAPI, taskAPI } from '../../services/api';
import { errorMessage, notify } from '../../store/toastStore';
import { requestOpenPost } from '../../store/aiJobsStore';
import { formatDay } from '../../lib/dates';
import { postStatusMeta, type PostStatus } from '../../lib/status';
import { campaignColor } from '../../lib/colors';

/**
 * New post: which campaign and theme it belongs to, a title, the day, and optionally the caption.
 * A theme can be added on the spot. Opens the post after creating it (unless asked not to).
 */

const NEW_THEME = '__new__';
const START_STATUSES: PostStatus[] = ['Idea', 'Draft', 'Ready'];

export interface NewPostDefaults {
  campaignId?: string;
  projectId?: string;
  /** "2026-11-20" */
  day?: string;
}

export default function NewPostDialog({
  open,
  defaults,
  onClose,
  onCreated,
  openAfter = true
}: {
  open: boolean;
  defaults?: NewPostDefaults;
  onClose: () => void;
  onCreated?: (task: any) => void;
  openAfter?: boolean;
}) {
  const [campaigns, setCampaigns] = useState<any[] | null>(null);
  const [themes, setThemes] = useState<any[] | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [newTheme, setNewTheme] = useState('');
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [status, setStatus] = useState<PostStatus>('Draft');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setContent('');
    setStatus('Draft');
    setDay(defaults?.day || '');
    setCampaignId(defaults?.campaignId || '');
    setProjectId(defaults?.projectId || '');
    setNewTheme('');
    setTouched(false);
    campaignAPI
      .getAll({ limit: 500 })
      .then((r) => {
        const list = r.data.campaigns || [];
        setCampaigns(list);
        if (!defaults?.campaignId && list.length === 1) setCampaignId(list[0]._id);
      })
      .catch(() => setCampaigns([]));
  }, [open, defaults?.campaignId, defaults?.projectId, defaults?.day]);

  useEffect(() => {
    if (!campaignId) {
      setThemes(null);
      return;
    }
    let alive = true;
    setThemes(null);
    projectAPI
      .getAll({ campaignId, limit: 500 })
      .then((r) => {
        if (!alive) return;
        const list = r.data.projects || [];
        setThemes(list);
        setProjectId((current) => {
          if (current && list.some((p: any) => p._id === current)) return current;
          return list.length === 1 ? list[0]._id : list.length === 0 ? NEW_THEME : '';
        });
      })
      .catch(() => alive && setThemes([]));
    return () => {
      alive = false;
    };
  }, [campaignId]);

  const themeMissing = !projectId || (projectId === NEW_THEME && !newTheme.trim());
  const invalid = !campaignId || themeMissing || !name.trim();

  const create = async () => {
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    try {
      let themeId = projectId;
      if (projectId === NEW_THEME) {
        const res = await projectAPI.create({ name: newTheme.trim(), campaignId });
        themeId = res.data.project._id;
      }
      const res = await taskAPI.create({
        name: name.trim(),
        projectId: themeId,
        status,
        ...(day ? { taskDate: `${day}T00:00:00.000Z` } : {}),
        ...(content.trim() ? { content } : {})
      });
      const task = res.data.task;
      onCreated?.(task);
      onClose();
      notify(day ? `Post added on ${formatDay(`${day}T00:00:00.000Z`, { relative: true })}` : 'Post added', openAfter ? undefined : { action: { label: 'Open', run: () => requestOpenPost(task._id) } });
      if (openAfter) requestOpenPost(task._id);
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t add the post.'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const noCampaigns = campaigns !== null && campaigns.length === 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: 'var(--bg-panel)', backgroundImage: 'none' } }}>
      <DialogTitle>New post</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {campaigns === null ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        ) : noCampaigns ? (
          <Typography sx={{ fontSize: 14, color: 'var(--text-muted)' }}>Posts belong to a campaign. Create a campaign first (Campaigns → New campaign).</Typography>
        ) : (
          <>
            <TextField
              select
              label="Campaign"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              error={touched && !campaignId}
              helperText={touched && !campaignId ? 'Choose a campaign' : undefined}
              fullWidth
            >
              {campaigns.map((c) => (
                <MenuItem key={c._id} value={c._id} sx={{ gap: 1 }}>
                  <Box component="span" sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: campaignColor(c._id), flexShrink: 0 }} />
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            {campaignId && (
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <TextField
                  select
                  label="Theme"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={themes === null}
                  error={touched && !projectId}
                  helperText={touched && !projectId ? 'Choose a theme' : 'A group of posts in the campaign, e.g. “Launch week”.'}
                  sx={{ flex: '1 1 220px' }}
                >
                  {(themes || []).map((p) => (
                    <MenuItem key={p._id} value={p._id}>
                      {p.name}
                    </MenuItem>
                  ))}
                  <MenuItem value={NEW_THEME}>+ New theme…</MenuItem>
                </TextField>
                {projectId === NEW_THEME && (
                  <TextField
                    label="New theme’s name"
                    value={newTheme}
                    onChange={(e) => setNewTheme(e.target.value)}
                    error={touched && !newTheme.trim()}
                    autoFocus
                    sx={{ flex: '1 1 220px' }}
                  />
                )}
              </Box>
            )}
            <TextField
              label="Title"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cold brew launch teaser"
              error={touched && !name.trim()}
              helperText={touched && !name.trim() ? 'Give the post a title (only you see it)' : 'Only you see the title.'}
              inputProps={{ maxLength: 200 }}
              fullWidth
              autoFocus={Boolean(defaults?.campaignId)}
            />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField type="date" label="Day" value={day} onChange={(e) => setDay(e.target.value)} InputLabelProps={{ shrink: true }} helperText="Leave empty to plan it later." sx={{ flex: '1 1 180px' }} />
              <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value as PostStatus)} sx={{ flex: '1 1 180px' }}>
                {START_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {postStatusMeta(s).label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <TextField label="Caption (optional)" value={content} onChange={(e) => setContent(e.target.value)} multiline minRows={3} fullWidth placeholder="You can also write it later, or with AI." />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={create} disabled={saving || noCampaigns || campaigns === null}>
          {saving ? 'Adding…' : 'Add post'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
