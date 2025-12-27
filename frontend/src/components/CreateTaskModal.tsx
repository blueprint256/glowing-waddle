import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Alert,
  Grid
} from '@mui/material';
import { taskAPI } from '../services/api';
import { TaskStatus, TaskType } from '../types';

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  campaignId: string;
  onTaskCreated?: () => void;
}

export default function CreateTaskModal({
  open,
  onClose,
  projectId,
  campaignId,
  onTaskCreated
}: CreateTaskModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: TaskType.OTHER,
    status: TaskStatus.PENDING,
    scheduledDate: '',
    publishDate: '',
    content: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await taskAPI.create({
        ...formData,
        projectId,
        campaignId,
        scheduledDate: formData.scheduledDate || undefined,
        publishDate: formData.publishDate || undefined,
        content: formData.content || undefined
      });

      // Reset form
      setFormData({
        name: '',
        description: '',
        type: TaskType.OTHER,
        status: TaskStatus.PENDING,
        scheduledDate: '',
        publishDate: '',
        content: ''
      });

      // Call success callback
      if (onTaskCreated) {
        onTaskCreated();
      }

      onClose();
    } catch (err: any) {
      console.error('Error creating task:', err);
      setError(
        err.response?.data?.message ||
        'Failed to create task. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setFormData({
        name: '',
        description: '',
        type: TaskType.OTHER,
        status: TaskStatus.PENDING,
        scheduledDate: '',
        publishDate: '',
        content: ''
      });
      setError('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create New Task</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Task Name"
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
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Type"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as TaskType })}
                  select
                  required
                  fullWidth
                >
                  <MenuItem value={TaskType.POST}>Post</MenuItem>
                  <MenuItem value={TaskType.LAUNCH}>Launch</MenuItem>
                  <MenuItem value={TaskType.ACTIVATION}>Activation</MenuItem>
                  <MenuItem value={TaskType.DELIVERABLE}>Deliverable</MenuItem>
                  <MenuItem value={TaskType.OTHER}>Other</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
                  select
                  required
                  fullWidth
                >
                  <MenuItem value={TaskStatus.PENDING}>Pending</MenuItem>
                  <MenuItem value={TaskStatus.IN_PROGRESS}>In Progress</MenuItem>
                  <MenuItem value={TaskStatus.COMPLETED}>Completed</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Scheduled Date"
                  type="date"
                  value={formData.scheduledDate}
                  onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Publish Date"
                  type="date"
                  value={formData.publishDate}
                  onChange={(e) => setFormData({ ...formData, publishDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
              </Grid>
            </Grid>
            <TextField
              label="Content/Notes"
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              multiline
              rows={4}
              fullWidth
              placeholder="Add any content or notes for this task..."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Creating...' : 'Create Task'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
