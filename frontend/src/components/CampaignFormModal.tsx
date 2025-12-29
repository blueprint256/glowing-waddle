import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Alert,
  Chip,
  Stack
} from '@mui/material';
import { campaignAPI } from '../services/api';

interface CampaignFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CampaignFormModal({
  open,
  onClose,
  onSuccess
}: CampaignFormModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    coreMessages: '',
    hashtags: [] as string[]
  });
  const [hashtagInput, setHashtagInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await campaignAPI.create(formData);

      // Reset form
      setFormData({
        name: '',
        description: '',
        coreMessages: '',
        hashtags: []
      });
      setHashtagInput('');

      // Call success callback
      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err: any) {
      console.error('Error creating campaign:', err);
      setError(
        err.response?.data?.message ||
        'Failed to create campaign. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleHashtagKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && hashtagInput.trim()) {
      e.preventDefault();
      const newHashtag = hashtagInput.trim().replace(/^#/, '');
      if (newHashtag && !formData.hashtags.includes(newHashtag)) {
        setFormData({
          ...formData,
          hashtags: [...formData.hashtags, newHashtag]
        });
      }
      setHashtagInput('');
    }
  };

  const handleRemoveHashtag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      hashtags: formData.hashtags.filter(tag => tag !== tagToRemove)
    });
  };

  const handleClose = () => {
    if (!loading) {
      setFormData({
        name: '',
        description: '',
        coreMessages: '',
        hashtags: []
      });
      setHashtagInput('');
      setError('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create New Campaign</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Campaign Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              fullWidth
              autoFocus
            />
            <TextField
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              multiline
              rows={3}
              fullWidth
            />
            <TextField
              label="Core Messages / Theme"
              value={formData.coreMessages}
              onChange={(e) => setFormData({ ...formData, coreMessages: e.target.value })}
              multiline
              rows={3}
              fullWidth
              placeholder="Main messaging or theme of the campaign"
            />
            <Box>
              <TextField
                label="Hashtags"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                onKeyDown={handleHashtagKeyDown}
                fullWidth
                placeholder="Type and press Enter or Comma to add hashtags"
                helperText="Press Enter or Comma to add hashtags (# is optional)"
              />
              {formData.hashtags.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                  {formData.hashtags.map((tag) => (
                    <Chip
                      key={tag}
                      label={`#${tag}`}
                      onDelete={() => handleRemoveHashtag(tag)}
                      color="primary"
                      variant="outlined"
                    />
                  ))}
                </Stack>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Creating...' : 'Create Campaign'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
