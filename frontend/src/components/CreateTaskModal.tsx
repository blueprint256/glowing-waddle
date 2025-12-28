import { useState, useEffect } from 'react';
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
  IconButton,
  FormControl,
  InputLabel,
  Select,
  CircularProgress
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  Close as CloseIcon,
  Image as ImageIcon
} from '@mui/icons-material';
import { taskAPI, campaignAPI, projectAPI } from '../services/api';
import { TaskStatus, Campaign, Project } from '../types';

interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  campaignId?: string;
  onTaskCreated?: () => void;
}

export default function CreateTaskModal({
  open,
  onClose,
  projectId: initialProjectId,
  campaignId: initialCampaignId,
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

  // Hierarchical selection state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(initialCampaignId || '');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Flag to determine if we're in hierarchical mode (no projectId/campaignId provided)
  const isHierarchicalMode = !initialProjectId && !initialCampaignId;

  // Load campaigns on mount if in hierarchical mode
  useEffect(() => {
    if (open && isHierarchicalMode) {
      loadCampaigns();
    }
  }, [open, isHierarchicalMode]);

  // Load projects when campaign is selected
  useEffect(() => {
    if (selectedCampaignId) {
      loadProjects(selectedCampaignId);
    } else {
      setProjects([]);
      setSelectedProjectId('');
    }
  }, [selectedCampaignId]);

  const loadCampaigns = async () => {
    try {
      setLoadingCampaigns(true);
      const res = await campaignAPI.getAll({ limit: 1000 });
      setCampaigns(res.data.campaigns || []);
    } catch (err: any) {
      console.error('Error loading campaigns:', err);
      setError('Failed to load campaigns');
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const loadProjects = async (campaignId: string) => {
    try {
      setLoadingProjects(true);
      const res = await projectAPI.getAll({ campaignId, limit: 1000 });
      setProjects(res.data.projects || []);
    } catch (err: any) {
      console.error('Error loading projects:', err);
      setError('Failed to load projects for selected campaign');
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleCampaignChange = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    setSelectedProjectId(''); // Reset project selection
  };

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

    // Validation for hierarchical mode
    if (isHierarchicalMode) {
      if (!selectedCampaignId) {
        setError('Please select a campaign');
        return;
      }
      if (!selectedProjectId) {
        setError('Please select a project');
        return;
      }
    }

    setLoading(true);

    try {
      // Determine which IDs to use
      const projectId = selectedProjectId || initialProjectId;
      const campaignId = selectedCampaignId || initialCampaignId;

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
      if (isHierarchicalMode) {
        setSelectedCampaignId('');
        setSelectedProjectId('');
      }

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
      if (isHierarchicalMode) {
        setSelectedCampaignId('');
        setSelectedProjectId('');
      }
      setError('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          Create New Task
          {isHierarchicalMode && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Select a campaign, then a project, and fill in task details
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {/* Hierarchical Selection - Only shown when not pre-populated */}
            {isHierarchicalMode && (
              <>
                <FormControl fullWidth required>
                  <InputLabel>Campaign</InputLabel>
                  <Select
                    value={selectedCampaignId}
                    onChange={(e) => handleCampaignChange(e.target.value)}
                    label="Campaign"
                    disabled={loadingCampaigns}
                  >
                    {loadingCampaigns ? (
                      <MenuItem disabled>
                        <CircularProgress size={20} sx={{ mr: 1 }} />
                        Loading campaigns...
                      </MenuItem>
                    ) : campaigns.length === 0 ? (
                      <MenuItem disabled>No campaigns available</MenuItem>
                    ) : (
                      campaigns.map((campaign) => (
                        <MenuItem key={campaign._id} value={campaign._id}>
                          {campaign.name}
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>

                <FormControl fullWidth required disabled={!selectedCampaignId}>
                  <InputLabel>Project</InputLabel>
                  <Select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    label="Project"
                    disabled={!selectedCampaignId || loadingProjects}
                  >
                    {loadingProjects ? (
                      <MenuItem disabled>
                        <CircularProgress size={20} sx={{ mr: 1 }} />
                        Loading projects...
                      </MenuItem>
                    ) : !selectedCampaignId ? (
                      <MenuItem disabled>Select a campaign first</MenuItem>
                    ) : projects.length === 0 ? (
                      <MenuItem disabled>No projects in this campaign</MenuItem>
                    ) : (
                      projects.map((project) => (
                        <MenuItem key={project._id} value={project._id}>
                          {project.name}
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>

                <Box
                  sx={{
                    borderTop: '2px solid #e0e0e0',
                    borderBottom: '2px solid #e0e0e0',
                    py: 1,
                    my: 1
                  }}
                >
                  <Typography variant="subtitle2" color="primary" align="center">
                    Task Details
                  </Typography>
                </Box>
              </>
            )}

            <TextField
              label="Task Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              fullWidth
              autoFocus={!isHierarchicalMode}
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
