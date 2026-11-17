import { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { projectAPI } from '../../services/api';
import { THEME_STATUSES, themeStatusMeta } from '../../lib/status';
import { dayKey, dayToISO } from '../../lib/dates';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * Create or edit a theme (a strand of a campaign, e.g. "Launch week"). A theme with no posts can be
 * deleted from here.
 */

export interface ThemeLike {
  _id: string;
  name: string;
  description?: string;
  status?: string;
  startDate?: string | null;
  dueDate?: string | null;
}

export default function ThemeDialog({
  open,
  campaignId,
  theme,
  postCount = 0,
  onClose,
  onSaved,
  onDeleted
}: {
  open: boolean;
  campaignId: string;
  /** Leave out to create a new theme. */
  theme?: ThemeLike | null;
  /** Posts in the theme (a theme can only be deleted when it has none). */
  postCount?: number;
  onClose: () => void;
  onSaved: (theme: ThemeLike) => void;
  onDeleted?: (id: string) => void;
}) {
  const editing = Boolean(theme);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('planning');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(theme?.name || '');
    setDescription(theme?.description || '');
    setStatus(theme?.status || 'planning');
    setStartDate(dayKey(theme?.startDate) || '');
    setDueDate(dayKey(theme?.dueDate) || '');
    setConfirmDelete(false);
    setError(null);
  }, [open, theme]);

  const datesWrong = Boolean(startDate && dueDate && dueDate < startDate);

  const save = async () => {
    if (saving || !name.trim() || datesWrong) return;
    setSaving(true);
    setError(null);
    try {
      let saved: ThemeLike;
      if (editing) {
        const res = await projectAPI.update(theme!._id, {
          name: name.trim(),
          description: description.trim(),
          status,
          startDate: startDate ? dayToISO(startDate) : null,
          dueDate: dueDate ? dayToISO(dueDate) : null
        });
        saved = res.data.project;
      } else {
        const res = await projectAPI.create({
          name: name.trim(),
          description: description.trim(),
          campaignId,
          ...(startDate ? { startDate: dayToISO(startDate) } : {}),
          ...(dueDate ? { dueDate: dayToISO(dueDate) } : {})
        });
        saved = res.data.project;
      }
      notify(editing ? 'Theme saved' : `Added the theme “${name.trim()}”`);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(errorMessage(e, editing ? 'Couldn’t save the theme.' : 'Couldn’t add the theme.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!theme || saving) return;
    setSaving(true);
    try {
      await projectAPI.remove(theme._id);
      notify(`Deleted the theme “${theme.name}”`);
      onDeleted?.(theme._id);
      onClose();
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t delete the theme.'));
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit theme' : 'New theme'}</DialogTitle>
      <DialogContent>
        <Box
          component="form"
          id="theme-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', mt: -0.5 }}>A theme groups posts within a campaign, like “Launch week” or “Behind the scenes”.</Typography>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus fullWidth />
          <TextField label="What it’s about" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: editing ? '1fr 1fr 1fr' : '1fr 1fr' }, gap: 1.5 }}>
            <TextField label="Starts" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField
              label="Ends"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              error={datesWrong}
              helperText={datesWrong ? 'Ends before it starts' : undefined}
              inputProps={{ min: startDate || undefined }}
            />
            {editing && (
              <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {THEME_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {themeStatusMeta(s).label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
          {error && (
            <Typography role="alert" sx={{ fontSize: 13, color: 'var(--st-attention-fg)' }}>
              {error}
            </Typography>
          )}
          {confirmDelete && (
            <Box sx={{ p: 1.5, borderRadius: 'var(--r-card)', bgcolor: 'var(--st-attention-bg)', color: 'var(--st-attention-fg)', fontSize: 13.5 }}>
              Delete “{theme?.name}”? This can’t be undone.
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {editing &&
          (confirmDelete ? (
            <Button color="error" variant="contained" onClick={remove} disabled={saving} sx={{ mr: 'auto' }}>
              Delete theme
            </Button>
          ) : (
            <Button
              color="error"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || postCount > 0}
              title={postCount > 0 ? 'Move or delete its posts first' : undefined}
              sx={{ mr: 'auto' }}
            >
              {postCount > 0 ? `Delete (has ${postCount} post${postCount === 1 ? '' : 's'})` : 'Delete'}
            </Button>
          ))}
        <Button onClick={() => (confirmDelete ? setConfirmDelete(false) : onClose())} disabled={saving}>
          {confirmDelete ? 'Keep it' : 'Cancel'}
        </Button>
        {!confirmDelete && (
          <Button type="submit" form="theme-form" variant="contained" disabled={saving || !name.trim() || datesWrong}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add theme'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
