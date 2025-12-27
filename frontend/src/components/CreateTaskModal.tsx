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
  Grid,
  Typography,
  Paper,
  IconButton
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  Close as CloseIcon,
  Image as ImageIcon
} from '@mui/icons-material';
import { taskAPI } from '../services/api';
import { TaskStatus } from '../types';

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
    status: TaskStatus.PENDING,
    taskDate: '',
    content: ''
  });
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file');
        return;
      }

      // Validate file size (e.g., max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image size must be less than 5MB');
        return;
      }

      setSelectedImage(file);

      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setError('');
    }
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // First, create the task
      const response = await taskAPI.create({
        ...formData,
        projectId,
        campaignId,
        taskDate: formData.taskDate || undefined,
        content: formData.content || undefined
      });

      const createdTaskId = response.data.task._id;

      // If an image was selected, upload it
      if (selectedImage && createdTaskId) {
        const imageFormData = new FormData();
        imageFormData.append('image', selectedImage);

        try {
          await taskAPI.uploadImage(createdTaskId, imageFormData);
        } catch (uploadErr) {
          console.error('Error uploading image:', uploadErr);
          // Don't fail the whole operation if just the image upload fails
          setError('Task created but image upload failed. You can upload it later.');
        }
      }

      // Reset form
      setFormData({
        name: '',
        description: '',
        status: TaskStatus.PENDING,
        taskDate: '',
        content: ''
      });
      setSelectedImage(null);
      setImagePreview(null);

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
        status: TaskStatus.PENDING,
        taskDate: '',
        content: ''
      });
      setSelectedImage(null);
      setImagePreview(null);
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
                  label="Task Date"
                  type="date"
                  value={formData.taskDate}
                  onChange={(e) => setFormData({ ...formData, taskDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
              </Grid>
            </Grid>

            {/* Image Upload Section */}
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ImageIcon fontSize="small" />
                Task Image (Optional)
              </Typography>

              {imagePreview ? (
                <Paper
                  sx={{
                    p: 2,
                    position: 'relative',
                    border: '2px dashed #2563EB',
                    backgroundColor: '#F0F4FF'
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={handleRemoveImage}
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      backgroundColor: 'white',
                      '&:hover': { backgroundColor: '#f5f5f5' }
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                  <Box
                    component="img"
                    src={imagePreview}
                    alt="Preview"
                    sx={{
                      width: '100%',
                      maxHeight: 200,
                      objectFit: 'contain',
                      borderRadius: 1
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    {selectedImage?.name}
                  </Typography>
                </Paper>
              ) : (
                <Button
                  component="label"
                  variant="outlined"
                  startIcon={<CloudUploadIcon />}
                  fullWidth
                  sx={{
                    py: 3,
                    borderStyle: 'dashed',
                    borderWidth: 2,
                    borderColor: '#2563EB',
                    color: '#2563EB',
                    '&:hover': {
                      borderColor: '#1E40AF',
                      backgroundColor: '#F0F4FF'
                    }
                  }}
                >
                  Upload Task Image
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={handleImageSelect}
                  />
                </Button>
              )}
            </Box>

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
