import { useEffect, useState, type KeyboardEvent } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { campaignAPI } from '../../services/api';
import { CAMPAIGN_STATUSES, campaignStatusMeta } from '../../lib/status';
import { dayKey, dayToISO } from '../../lib/dates';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * Create or edit a campaign: name, what it's about, key messages, hashtags, dates and status.
 * The AI uses all of it when it writes captions and plans posts.
 */

export interface CampaignLike {
  _id: string;
  name: string;
  description?: string;
  coreMessages?: string;
  hashtags?: string[];
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
}

interface Form {
  name: string;
  description: string;
  coreMessages: string;
  hashtags: string[];
  startDate: string;
  endDate: string;
  status: string;
}

const empty: Form = { name: '', description: '', coreMessages: '', hashtags: [], startDate: '', endDate: '', status: 'planning' };

function formFrom(c?: CampaignLike | null): Form {
  if (!c) return empty;
  return {
    name: c.name || '',
    description: c.description || '',
    coreMessages: c.coreMessages || '',
    hashtags: c.hashtags || [],
    startDate: dayKey(c.startDate) || '',
    endDate: dayKey(c.endDate) || '',
    status: c.status && c.status !== 'archived' ? c.status : 'planning'
  };
}

const cleanTag = (s: string) => s.trim().replace(/^#+/, '').replace(/\s+/g, '');

export default function CampaignDialog({
  open,
  campaign,
  onClose,
  onSaved
}: {
  open: boolean;
  /** Leave out to create a new campaign. */
  campaign?: CampaignLike | null;
  onClose: () => void;
  onSaved: (campaign: CampaignLike) => void;
}) {
  const editing = Boolean(campaign);
  const [form, setForm] = useState<Form>(empty);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formFrom(campaign));
    setTagInput('');
    setError(null);
  }, [open, campaign]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const addTags = (raw: string) => {
    const tags = raw.split(/[\s,]+/).map(cleanTag).filter(Boolean);
    if (!tags.length) return;
    setForm((f) => ({ ...f, hashtags: [...f.hashtags, ...tags.filter((t) => !f.hashtags.some((h) => h.toLowerCase() === t.toLowerCase()))] }));
    setTagInput('');
  };

  const onTagKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && tagInput.trim()) {
      e.preventDefault();
      addTags(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && form.hashtags.length) {
      set('hashtags', form.hashtags.slice(0, -1));
    }
  };

  const datesWrong = Boolean(form.startDate && form.endDate && form.endDate < form.startDate);

  const save = async () => {
    if (saving || !form.name.trim() || datesWrong) return;
    setSaving(true);
    setError(null);
    const pending = tagInput.trim() ? [...form.hashtags, ...tagInput.split(/[\s,]+/).map(cleanTag).filter(Boolean)] : form.hashtags;
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      coreMessages: form.coreMessages.trim(),
      hashtags: [...new Set(pending)],
      startDate: form.startDate ? dayToISO(form.startDate) : null,
      endDate: form.endDate ? dayToISO(form.endDate) : null,
      status: form.status
    };
    // A new campaign leaves out empty dates (the create check accepts only real dates); an edit sends
    // null to clear one.
    const createBody = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
    try {
      const res = editing ? await campaignAPI.update(campaign!._id, body) : await campaignAPI.create(createBody);
      notify(editing ? 'Campaign saved' : `Created “${body.name}”`);
      onSaved(res.data.campaign);
      onClose();
    } catch (e) {
      setError(errorMessage(e, editing ? 'Couldn’t save the campaign.' : 'Couldn’t create the campaign.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit campaign' : 'New campaign'}</DialogTitle>
      <DialogContent>
        <Box
          component="form"
          id="campaign-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} required autoFocus fullWidth placeholder="e.g. Christmas 2026" />
          <TextField
            label="What it’s about"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            multiline
            minRows={2}
            fullWidth
            helperText="The goal and the audience, in a sentence or two."
          />
          <TextField
            label="Key messages"
            value={form.coreMessages}
            onChange={(e) => set('coreMessages', e.target.value)}
            multiline
            minRows={2}
            fullWidth
            helperText="What every post should get across. AI uses this when writing."
          />
          <Box>
            <TextField
              label="Hashtags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKey}
              onBlur={() => tagInput.trim() && addTags(tagInput)}
              fullWidth
              placeholder={form.hashtags.length ? 'Add another' : 'Type a hashtag and press Enter'}
            />
            {form.hashtags.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                {form.hashtags.map((tag) => (
                  <Chip key={tag} size="small" label={`#${tag}`} onDelete={() => set('hashtags', form.hashtags.filter((t) => t !== tag))} />
                ))}
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}>
            <TextField label="Starts" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField
              label="Ends"
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
              InputLabelProps={{ shrink: true }}
              error={datesWrong}
              helperText={datesWrong ? 'Ends before it starts' : undefined}
              inputProps={{ min: form.startDate || undefined }}
            />
            <TextField select label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {CAMPAIGN_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {campaignStatusMeta(s).label}
                </MenuItem>
              ))}
            </TextField>
          </Box>
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
        <Button type="submit" form="campaign-form" variant="contained" disabled={saving || !form.name.trim() || datesWrong}>
          {saving ? 'Saving…' : editing ? 'Save' : 'Create campaign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
