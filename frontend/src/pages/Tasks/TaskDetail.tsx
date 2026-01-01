import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Button,
  TextField,
  List,
  ListItem,
  ListItemText,
  Divider,
  Grid,
  MenuItem,
  CircularProgress,
  Alert,
  CardMedia,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  CloudUpload as CloudUploadIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  AutoAwesome as AutoAwesomeIcon
} from '@mui/icons-material';
import { taskAPI, commentAPI } from '../../services/api';
import { Task, Comment, TaskStatus } from '../../types';
import { useAuthStore } from '../../store/authStore';
import SocialPreviewModal from '../../components/SocialPreviewModal';

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [refineModalOpen, setRefineModalOpen] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refinedDescription, setRefinedDescription] = useState('');
  const [refineError, setRefineError] = useState<string | null>(null);
  const [generatingPoster, setGeneratingPoster] = useState(false);
  const [generatedPosterUrl, setGeneratedPosterUrl] = useState<string | null>(null);
  const [adoptingPoster, setAdoptingPoster] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info' | 'warning'>('info');

  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    status: TaskStatus.PENDING,
    taskDate: null as Date | null,
    content: ''
  });

  useEffect(() => {
    if (id) {
      loadTask();
      loadComments();
    }
  }, [id]);

  const loadTask = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await taskAPI.getById(id!);
      const taskData = res.data.task;
      setTask(taskData);

      // Populate edit form
      setEditForm({
        name: taskData.name,
        description: taskData.description || '',
        status: taskData.status,
        taskDate: taskData.taskDate ? new Date(taskData.taskDate) : null,
        content: taskData.content || ''
      });
    } catch (error: any) {
      console.error('Error loading task:', error);
      setError(error.response?.data?.message || 'Failed to load task');
    } finally {
      setLoading(false);
    }
  };

  const loadComments = async () => {
    try {
      const res = await commentAPI.getAll({ taskId: id });
      setComments(res.data.comments || []);
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      await commentAPI.create({ content: newComment, taskId: id });
      setNewComment('');
      loadComments();
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('image', file);

      await taskAPI.uploadImage(id!, formData);
      loadTask(); // Reload task to show new image
    } catch (error: any) {
      console.error('Error uploading image:', error);
      alert(error.response?.data?.message || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateTask = async () => {
    try {
      await taskAPI.update(id!, {
        ...editForm,
        taskDate: editForm.taskDate?.toISOString()
      });
      setIsEditing(false);
      loadTask();
    } catch (error: any) {
      console.error('Error updating task:', error);
      alert(error.response?.data?.message || 'Failed to update task');
    }
  };

  const handleDeleteTask = async () => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;

    try {
      await taskAPI.delete(id!);
      navigate(-1); // Go back to previous page
    } catch (error: any) {
      console.error('Error deleting task:', error);
      alert(error.response?.data?.message || 'Failed to delete task');
    }
  };

  const handleRefineDescription = async () => {
    if (!editForm.description.trim()) {
      alert('Please enter a description before refining');
      return;
    }

    try {
      setRefining(true);
      setRefineError(null);
      const res = await taskAPI.refineDescription(id!);
      setRefinedDescription(res.data.refinedDescription);
      setRefineModalOpen(true);
    } catch (error: any) {
      console.error('Error refining description:', error);
      setRefineError(error.response?.data?.message || 'Failed to refine description');
      alert(error.response?.data?.message || 'Failed to refine description');
    } finally {
      setRefining(false);
    }
  };

  const handleApplyRefinedDescription = () => {
    setEditForm({ ...editForm, description: refinedDescription });
    setRefineModalOpen(false);
    setRefinedDescription('');
  };

  const handleCloseRefineModal = () => {
    setRefineModalOpen(false);
    setRefinedDescription('');
    setRefineError(null);
  };

  const handleGeneratePoster = async () => {
    try {
      setGeneratingPoster(true);
      setError(null);
      const res = await taskAPI.generatePoster(id!);
      setGeneratedPosterUrl(res.data.generatedImageUrl);
      setSnackbarMessage('Poster generated successfully!');
      setSnackbarSeverity('success');
      setSnackbarOpen(true);
    } catch (error: any) {
      console.error('Error generating poster:', error);
      const errorMessage = error.response?.data?.message || 'Image generation failed – please try again.';

      // Show error toast
      setSnackbarMessage(errorMessage);
      setSnackbarSeverity('error');
      setSnackbarOpen(true);

      // Wait for toast to be visible (2 seconds), then navigate back to task page
      setTimeout(() => {
        navigate(`/tasks/${id}`);
      }, 2000);
    } finally {
      setGeneratingPoster(false);
    }
  };

  const handleAdoptPoster = async () => {
    if (!generatedPosterUrl) return;

    if (!window.confirm('This will replace the current task image with the generated poster. Continue?')) {
      return;
    }

    try {
      setAdoptingPoster(true);
      await taskAPI.adoptPoster(id!, { generatedImageUrl: generatedPosterUrl });
      setGeneratedPosterUrl(null); // Clear generated poster
      await loadTask(); // Reload task to show new image

      setSnackbarMessage('Poster adopted successfully!');
      setSnackbarSeverity('success');
      setSnackbarOpen(true);
    } catch (error: any) {
      console.error('Error adopting poster:', error);
      const errorMessage = error.response?.data?.message || 'Failed to adopt poster';

      setSnackbarMessage(errorMessage);
      setSnackbarSeverity('error');
      setSnackbarOpen(true);
    } finally {
      setAdoptingPoster(false);
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbarOpen(false);
  };

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.COMPLETED:
        return 'success';
      case TaskStatus.IN_PROGRESS:
        return 'warning';
      case TaskStatus.PENDING:
        return 'error';
      default:
        return 'default';
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress sx={{ color: '#2563EB' }} />
      </Box>
    );
  }

  if (error || !task) {
    return (
      <Box>
        <Alert severity="error">{error || 'Task not found'}</Alert>
        <Button onClick={() => navigate(-1)} sx={{ mt: 2 }}>Go Back</Button>
      </Box>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box>
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h4">{task.name}</Typography>
            <Box>
              <Chip
                label={task.status}
                color={getStatusColor(task.status)}
              />
            </Box>
          </Box>

          {!isEditing ? (
            // View Mode
            <Box>
              <Typography variant="body1" paragraph>
                {task.description}
              </Typography>

              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">Status</Typography>
                  <Typography variant="body1">{task.status}</Typography>
                </Grid>
                {task.taskDate && (
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2" color="text.secondary">Task Date</Typography>
                    <Typography variant="body1">
                      {new Date(task.taskDate).toLocaleDateString()}
                    </Typography>
                  </Grid>
                )}
              </Grid>

              {task.content && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Content
                  </Typography>
                  <Typography variant="body2">{task.content}</Typography>
                </Box>
              )}

              {/* Designed Image Section */}
              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>Designed Image</Typography>

                <Grid container spacing={3}>
                  {/* Base Image */}
                  <Grid item xs={12} md={generatedPosterUrl ? 6 : 12}>
                    <Box>
                      {task.designedImage || generatedPosterUrl ? (
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          {generatedPosterUrl ? 'Current Image' : 'Task Image'}
                        </Typography>
                      ) : null}
                      {task.designedImage ? (
                        <Box>
                          <CardMedia
                            component="img"
                            image={task.designedImage}
                            alt="Task designed image"
                            sx={{
                              width: '100%',
                              maxWidth: generatedPosterUrl ? 500 : 600,
                              maxHeight: 400,
                              objectFit: 'contain',
                              borderRadius: 1,
                              border: '1px solid #e0e0e0'
                            }}
                          />
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No image uploaded yet
                        </Typography>
                      )}

                      <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Button
                          variant="outlined"
                          component="label"
                          startIcon={uploading ? <CircularProgress size={20} /> : <CloudUploadIcon />}
                          disabled={uploading}
                        >
                          {uploading ? 'Uploading...' : task.designedImage ? 'Replace Image' : 'Upload Image'}
                          <input
                            type="file"
                            hidden
                            accept="image/*"
                            onChange={handleImageUpload}
                          />
                        </Button>

                        <Button
                          variant="contained"
                          startIcon={generatingPoster ? <CircularProgress size={20} /> : <AutoAwesomeIcon />}
                          onClick={handleGeneratePoster}
                          disabled={generatingPoster}
                          sx={{
                            backgroundColor: '#9333EA',
                            '&:hover': { backgroundColor: '#7C3AED' }
                          }}
                        >
                          {generatingPoster ? 'Generating Poster...' : 'Generate Poster with AI'}
                        </Button>
                      </Box>
                    </Box>
                  </Grid>

                  {/* Generated Poster Preview */}
                  {generatedPosterUrl && (
                    <Grid item xs={12} md={6}>
                      <Box>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Generated Poster
                        </Typography>
                        <CardMedia
                          component="img"
                          image={generatedPosterUrl}
                          alt="Generated poster"
                          sx={{
                            width: '100%',
                            maxWidth: 500,
                            maxHeight: 400,
                            objectFit: 'contain',
                            borderRadius: 1,
                            border: '2px solid #9333EA'
                          }}
                        />
                        <Box sx={{ mt: 2 }}>
                          <Button
                            variant="contained"
                            color="success"
                            onClick={handleAdoptPoster}
                            disabled={adoptingPoster}
                            startIcon={adoptingPoster ? <CircularProgress size={20} /> : null}
                            fullWidth
                          >
                            {adoptingPoster ? 'Adopting...' : 'Adopt This Poster'}
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => setGeneratedPosterUrl(null)}
                            sx={{ mt: 1 }}
                            fullWidth
                          >
                            Discard
                          </Button>
                        </Box>
                      </Box>
                    </Grid>
                  )}
                </Grid>
              </Box>

              <Box sx={{ mt: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  startIcon={<VisibilityIcon />}
                  onClick={() => setPreviewOpen(true)}
                  disabled={!task.name && !task.designedImage}
                  sx={{ backgroundColor: '#1DA1F2', '&:hover': { backgroundColor: '#1A91DA' } }}
                >
                  Preview on Social Media
                </Button>
                <Button variant="contained" onClick={() => setIsEditing(true)}>
                  Edit Task
                </Button>
                <Button variant="outlined" color="error" onClick={handleDeleteTask}>
                  Delete Task
                </Button>
                <Button variant="outlined" onClick={() => navigate(-1)}>
                  Back
                </Button>
              </Box>
            </Box>
          ) : (
            // Edit Mode
            <Box>
              <TextField
                fullWidth
                label="Name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Description"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                margin="normal"
                multiline
                rows={3}
              />
              <Button
                variant="outlined"
                startIcon={refining ? <CircularProgress size={20} /> : <AutoAwesomeIcon />}
                onClick={handleRefineDescription}
                disabled={refining || !editForm.description.trim()}
                sx={{ mt: 1, mb: 1 }}
              >
                {refining ? 'Refining...' : 'Refine Description with AI'}
              </Button>

              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    select
                    label="Status"
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value as TaskStatus })}
                  >
                    {Object.values(TaskStatus).map((status) => (
                      <MenuItem key={status} value={status}>
                        {status}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={6}>
                  <DatePicker
                    label="Task Date"
                    value={editForm.taskDate}
                    onChange={(date) => setEditForm({ ...editForm, taskDate: date })}
                    slotProps={{ textField: { fullWidth: true } }}
                  />
                </Grid>
              </Grid>

              <TextField
                fullWidth
                label="Content"
                value={editForm.content}
                onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                margin="normal"
                multiline
                rows={4}
              />

              <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                <Button variant="contained" onClick={handleUpdateTask}>
                  Save Changes
                </Button>
                <Button variant="outlined" onClick={() => {
                  setIsEditing(false);
                  // Reset form to original values
                  setEditForm({
                    name: task.name,
                    description: task.description || '',
                    status: task.status,
                    taskDate: task.taskDate ? new Date(task.taskDate) : null,
                    content: task.content || ''
                  });
                }}>
                  Cancel
                </Button>
              </Box>
            </Box>
          )}
        </Paper>

        {/* Social Preview Modal */}
        {task && (
          <SocialPreviewModal
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            task={task}
          />
        )}

        {/* Refine Description Modal */}
        <Dialog
          open={refineModalOpen}
          onClose={handleCloseRefineModal}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>Refine Task Description</DialogTitle>
          <DialogContent>
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Original Description:
              </Typography>
              <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.50' }}>
                <Typography variant="body1" style={{ whiteSpace: 'pre-wrap' }}>
                  {editForm.description}
                </Typography>
              </Paper>

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Refined Description:
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.200' }}>
                <Typography variant="body1" style={{ whiteSpace: 'pre-wrap' }}>
                  {refinedDescription}
                </Typography>
              </Paper>

              {refineError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {refineError}
                </Alert>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseRefineModal} color="inherit">
              Cancel
            </Button>
            <Button
              onClick={handleApplyRefinedDescription}
              variant="contained"
              color="primary"
            >
              Apply Refined Description
            </Button>
          </DialogActions>
        </Dialog>

        {/* Comments Section */}
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Comments
          </Typography>
          <Box sx={{ mb: 2 }}>
            <TextField
              fullWidth
              multiline
              rows={2}
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <Button
              variant="contained"
              onClick={handleAddComment}
              sx={{ mt: 1 }}
              disabled={!newComment.trim()}
            >
              Add Comment
            </Button>
          </Box>
          <Divider sx={{ my: 2 }} />
          <List>
            {comments.map((comment) => (
              <ListItem key={comment._id} alignItems="flex-start">
                <ListItemText
                  primary={
                    comment.authorId
                      ? `${comment.authorId.firstName} ${comment.authorId.lastName}`
                      : 'Unknown'
                  }
                  secondary={
                    <>
                      <Typography variant="body2" color="text.primary">
                        {comment.content}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(comment.createdAt).toLocaleString()}
                      </Typography>
                    </>
                  }
                />
              </ListItem>
            ))}
            {comments.length === 0 && (
              <Typography color="text.secondary">No comments yet</Typography>
            )}
          </List>
        </Paper>

        {/* Snackbar for notifications */}
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={6000}
          onClose={handleCloseSnackbar}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert onClose={handleCloseSnackbar} severity={snackbarSeverity} sx={{ width: '100%' }}>
            {snackbarMessage}
          </Alert>
        </Snackbar>
      </Box>
    </LocalizationProvider>
  );
}
