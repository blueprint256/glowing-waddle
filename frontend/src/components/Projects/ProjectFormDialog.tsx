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
  Alert
} from '@mui/material';
import { projectAPI } from '../../services/api';
import { ProjectStatus } from '../../types';

interface ProjectFormDialogProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onSuccess?: () => void;
}

export default function ProjectFormDialog({
  open,
  onClose,
  campaignId,
  onSuccess
}: ProjectFormDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: ProjectStatus.PLANNING,
    startDate: '',
    dueDate: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await projectAPI.create({
        ...formData,
        campaignId
      });

      // Reset form
      setFormData({
        name: '',
        description: '',
        status: ProjectStatus.PLANNING,
        startDate: '',
        dueDate: ''
      });

      // Call success callback
      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err: any) {
      console.error('Error creating project:', err);
      setError(
        err.response?.data?.message ||
        'Failed to create project. Please try again.'
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
        status: ProjectStatus.PLANNING,
        startDate: '',
        dueDate: ''
      });
      setError('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Project Name"
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
              label="Status"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
              select
              required
              fullWidth
            >
              <MenuItem value={ProjectStatus.PLANNING}>Planning</MenuItem>
              <MenuItem value={ProjectStatus.IN_PROGRESS}>In Progress</MenuItem>
              <MenuItem value={ProjectStatus.REVIEW}>Review</MenuItem>
              <MenuItem value={ProjectStatus.COMPLETED}>Completed</MenuItem>
              <MenuItem value={ProjectStatus.ON_HOLD}>On Hold</MenuItem>
            </TextField>
            <TextField
              label="Start Date"
              type="date"
              value={formData.startDate}
              onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="Due Date"
              type="date"
              value={formData.dueDate}
              onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Creating...' : 'Create Project'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
