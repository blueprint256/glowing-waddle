import { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { campaignAPI, projectAPI, taskAPI } from '../../services/api';
import { campaignColor } from '../../lib/colors';
import { errorMessage, notify } from '../../store/toastStore';
import { announcePostChanged } from '../../store/aiJobsStore';

/**
 * Move a post to another theme, in the same campaign or another of the same account. Its scheduled
 * copies and Library items follow it (backend: PUT /tasks/:id with projectId).
 */
export default function MovePostDialog({
  open,
  taskId,
  campaignId,
  themeId,
  ownerId,
  onClose,
  onMoved
}: {
  open: boolean;
  taskId: string;
  campaignId: string;
  themeId: string;
  /** The account the post belongs to (only its campaigns are offered). */
  ownerId?: string;
  onClose: () => void;
  onMoved: (task: any) => void;
}) {
  const [campaigns, setCampaigns] = useState<{ _id: string; name: string }[]>([]);
  const [themes, setThemes] = useState<{ _id: string; name: string }[] | null>(null);
  const [campaign, setCampaign] = useState(campaignId);
  const [theme, setTheme] = useState(themeId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCampaign(campaignId);
    setTheme(themeId);
    setError(null);
    campaignAPI
      .getAll({ limit: 1000, ...(ownerId ? { createdBy: ownerId } : {}) })
      .then((r) =>
        setCampaigns(
          (r.data.campaigns || [])
            .filter((c: any) => !ownerId || String(c.createdBy?._id || c.createdBy) === ownerId)
            .map((c: any) => ({ _id: c._id, name: c.name }))
        )
      )
      .catch(() => setCampaigns([]));
  }, [open, campaignId, themeId, ownerId]);

  useEffect(() => {
    if (!open || !campaign) return;
    setThemes(null);
    projectAPI
      .getAll({ campaignId: campaign, limit: 500 })
      .then((r) => {
        const list = (r.data.projects || []).map((p: any) => ({ _id: p._id, name: p.name }));
        setThemes(list);
        setTheme((current) => (list.some((p: { _id: string }) => p._id === current) ? current : list[0]?._id || ''));
      })
      .catch(() => setThemes([]));
  }, [open, campaign]);

  const unchanged = theme === themeId;

  const move = async () => {
    if (!theme || unchanged || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await taskAPI.update(taskId, { projectId: theme });
      const name = themes?.find((t) => t._id === theme)?.name;
      notify(name ? `Moved to “${name}”` : 'Post moved');
      announcePostChanged(taskId);
      onMoved(res.data.task);
      onClose();
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t move the post.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle>Move post</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField select label="Campaign" value={campaigns.some((c) => c._id === campaign) ? campaign : ''} onChange={(e) => setCampaign(e.target.value)} fullWidth>
            {campaigns.map((c) => (
              <MenuItem key={c._id} value={c._id} sx={{ gap: 1 }}>
                <Box component="span" sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: campaignColor(c._id), flexShrink: 0 }} />
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Theme" value={themes?.some((t) => t._id === theme) ? theme : ''} onChange={(e) => setTheme(e.target.value)} fullWidth disabled={!themes || themes.length === 0}>
            {(themes || []).map((t) => (
              <MenuItem key={t._id} value={t._id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          {themes && themes.length === 0 && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>This campaign has no themes yet. Add one on its page first.</Typography>}
          {campaign !== campaignId && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>Anything scheduled in Publishing and its Library items move with it.</Typography>}
          {error && (
            <Typography role="alert" sx={{ fontSize: 13, color: 'var(--st-attention-fg)' }}>
              {error}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={move} disabled={saving || !theme || unchanged}>
          {saving ? 'Moving…' : 'Move'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
