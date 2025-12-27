import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  LinearProgress,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Tooltip,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  SelectChangeEvent
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PhotoCamera as PhotoCameraIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Upload as UploadIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { campaignAPI, projectAPI, taskAPI } from '../services/api';
import { Campaign, Project, Task, TaskStatus, CampaignStatus, ProjectStatus } from '../types';
import CreateTaskModal from '../components/CreateTaskModal';

interface CampaignWithProjects extends Campaign {
  projects?: ProjectWithTasks[];
  projectsLoaded?: boolean;
}

interface ProjectWithTasks extends Project {
  tasks?: Task[];
  tasksLoaded?: boolean;
}

interface EditingCell {
  type: 'campaign' | 'project' | 'task';
  id: string;
  field: string;
}

export default function DetailsSheet() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignWithProjects[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  const [selectedProjectForTask, setSelectedProjectForTask] = useState<{ projectId: string; campaignId: string } | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Color coding constants - Blue/Purple Brand Theme
  const CAMPAIGN_COLOR = '#DBEAFE'; // Deep blue background
  const CAMPAIGN_BORDER = '#2563EB'; // Deep brand blue
  const CAMPAIGN_HOVER = '#BFDBFE'; // Lighter blue hover
  const PROJECT_COLOR = '#E0E7FF';  // Mid blue-purple background
  const PROJECT_BORDER = '#6366F1';  // Mid blue-purple
  const PROJECT_HOVER = '#C7D2FE';   // Lighter purple hover
  const TASK_COLOR = '#C7D2FE';      // Lighter violet-blue
  const TASK_HOVER = '#E0E7FF';      // Very light violet hover

  useEffect(() => {
    loadCampaigns();
  }, []);

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await campaignAPI.getAll({ includeArchived: false });
      const campaignsData = res.data.campaigns || [];
      setCampaigns(
        campaignsData.map((c: Campaign) => ({
          ...c,
          projects: [],
          projectsLoaded: false
        }))
      );
    } catch (error: any) {
      console.error('Error loading campaigns:', error);
      setError(error.response?.data?.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const loadProjectsForCampaign = async (campaignId: string) => {
    try {
      const res = await projectAPI.getAll({ campaignId });
      const projectsData = res.data.projects || [];

      setCampaigns((prev) =>
        prev.map((c) =>
          c._id === campaignId
            ? {
                ...c,
                projects: projectsData.map((p: Project) => ({
                  ...p,
                  tasks: [],
                  tasksLoaded: false
                })),
                projectsLoaded: true
              }
            : c
        )
      );
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };

  const loadTasksForProject = async (campaignId: string, projectId: string) => {
    try {
      const res = await taskAPI.getAll({ projectId });
      const tasksData = res.data.tasks || [];

      setCampaigns((prev) =>
        prev.map((c) =>
          c._id === campaignId
            ? {
                ...c,
                projects: c.projects?.map((p) =>
                  p._id === projectId
                    ? { ...p, tasks: tasksData, tasksLoaded: true }
                    : p
                )
              }
            : c
        )
      );
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  };

  const handleCampaignExpand = (campaignId: string) => async (
    event: React.SyntheticEvent,
    isExpanded: boolean
  ) => {
    const newExpanded = new Set(expandedCampaigns);
    if (isExpanded) {
      newExpanded.add(campaignId);
      const campaign = campaigns.find((c) => c._id === campaignId);
      if (campaign && !campaign.projectsLoaded) {
        await loadProjectsForCampaign(campaignId);
      }
    } else {
      newExpanded.delete(campaignId);
    }
    setExpandedCampaigns(newExpanded);
  };

  const handleProjectExpand = (campaignId: string, projectId: string) => async (
    event: React.SyntheticEvent,
    isExpanded: boolean
  ) => {
    const newExpanded = new Set(expandedProjects);
    if (isExpanded) {
      newExpanded.add(projectId);
      const campaign = campaigns.find((c) => c._id === campaignId);
      const project = campaign?.projects?.find((p) => p._id === projectId);
      if (project && !project.tasksLoaded) {
        await loadTasksForProject(campaignId, projectId);
      }
    } else {
      newExpanded.delete(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  const calculateCampaignProgress = (campaign: CampaignWithProjects): number => {
    if (!campaign.projects || campaign.projects.length === 0) return 0;

    let totalTasks = 0;
    let completedTasks = 0;

    campaign.projects.forEach((project) => {
      if (project.tasks) {
        totalTasks += project.tasks.length;
        completedTasks += project.tasks.filter(
          (t) => t.status === TaskStatus.COMPLETED
        ).length;
      }
    });

    if (totalTasks === 0) return 0;
    return Math.round((completedTasks / totalTasks) * 100);
  };

  const getTaskCounts = (project: ProjectWithTasks) => {
    if (!project.tasks) return { completed: 0, total: 0 };
    return {
      completed: project.tasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
      total: project.tasks.length
    };
  };

  const getStatusColor = (status: TaskStatus): 'success' | 'warning' | 'error' => {
    switch (status) {
      case TaskStatus.COMPLETED:
        return 'success';
      case TaskStatus.IN_PROGRESS:
        return 'warning';
      case TaskStatus.PENDING:
        return 'error';
      default:
        return 'error';
    }
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getPhotoCount = (task: Task): number => {
    let count = 0;
    if (task.designedImage) count++;
    return count;
  };

  // Inline editing functions
  const startEditing = (type: 'campaign' | 'project' | 'task', id: string, field: string, currentValue: string) => {
    setEditingCell({ type, id, field });
    setEditValue(currentValue || '');
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = async () => {
    if (!editingCell) return;

    try {
      const { type, id, field } = editingCell;

      if (type === 'campaign') {
        await campaignAPI.update(id, { [field]: editValue });
        setCampaigns(prev =>
          prev.map(c => c._id === id ? { ...c, [field]: editValue } : c)
        );
      } else if (type === 'project') {
        await projectAPI.update(id, { [field]: editValue });
        setCampaigns(prev =>
          prev.map(c => ({
            ...c,
            projects: c.projects?.map(p =>
              p._id === id ? { ...p, [field]: editValue } : p
            )
          }))
        );
      } else if (type === 'task') {
        await taskAPI.update(id, { [field]: editValue });
        setCampaigns(prev =>
          prev.map(c => ({
            ...c,
            projects: c.projects?.map(p => ({
              ...p,
              tasks: p.tasks?.map(t =>
                t._id === id ? { ...t, [field]: editValue } : t
              )
            }))
          }))
        );
      }

      cancelEditing();
    } catch (error: any) {
      console.error('Error saving edit:', error);
      alert(error.response?.data?.message || 'Failed to save changes');
    }
  };

  // Status change functions
  const handleCampaignStatusChange = async (campaignId: string, newStatus: CampaignStatus) => {
    try {
      await campaignAPI.update(campaignId, { status: newStatus });
      setCampaigns(prev =>
        prev.map(c => c._id === campaignId ? { ...c, status: newStatus } : c)
      );
    } catch (error: any) {
      console.error('Error updating campaign status:', error);
      alert(error.response?.data?.message || 'Failed to update campaign status');
    }
  };

  const handleProjectStatusChange = async (projectId: string, newStatus: ProjectStatus) => {
    try {
      await projectAPI.update(projectId, { status: newStatus });
      setCampaigns(prev =>
        prev.map(c => ({
          ...c,
          projects: c.projects?.map(p =>
            p._id === projectId ? { ...p, status: newStatus } : p
          )
        }))
      );
    } catch (error: any) {
      console.error('Error updating project status:', error);
      alert(error.response?.data?.message || 'Failed to update project status');
    }
  };

  const handleTaskStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    try {
      await taskAPI.update(taskId, { status: newStatus });
      setCampaigns(prev =>
        prev.map(c => ({
          ...c,
          projects: c.projects?.map(p => ({
            ...p,
            tasks: p.tasks?.map(t =>
              t._id === taskId ? { ...t, status: newStatus } : t
            )
          }))
        }))
      );
    } catch (error: any) {
      console.error('Error updating task status:', error);
      alert(error.response?.data?.message || 'Failed to update task status');
    }
  };

  // Photo upload function
  const handlePhotoUpload = async (taskId: string, campaignId: string, projectId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;

      try {
        const formData = new FormData();
        formData.append('image', file);

        await taskAPI.uploadImage(taskId, formData);

        // Reload tasks to get updated image URL
        await loadTasksForProject(campaignId, projectId);

        alert('Photo uploaded successfully!');
      } catch (error: any) {
        console.error('Error uploading photo:', error);
        alert(error.response?.data?.message || 'Failed to upload photo');
      }
    };
    input.click();
  };

  const handleOpenCreateTaskModal = (projectId: string, campaignId: string) => {
    setSelectedProjectForTask({ projectId, campaignId });
    setCreateTaskModalOpen(true);
  };

  const handleCloseCreateTaskModal = () => {
    setCreateTaskModalOpen(false);
    setSelectedProjectForTask(null);
  };

  const handleTaskCreated = async () => {
    if (selectedProjectForTask) {
      await loadTasksForProject(selectedProjectForTask.campaignId, selectedProjectForTask.projectId);
    }
    handleCloseCreateTaskModal();
  };

  const handleDeleteTask = async (taskId: string, campaignId: string, projectId: string) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;

    try {
      await taskAPI.delete(taskId);
      await loadTasksForProject(campaignId, projectId);
    } catch (error: any) {
      console.error('Error deleting task:', error);
      alert(error.response?.data?.message || 'Failed to delete task');
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 1 }}>
        Details Sheet
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Hierarchical view of all campaigns, projects, and tasks with inline editing
      </Typography>

      {/* Create Campaign Button */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-start' }}>
        <Button
          variant="contained"
          size="large"
          startIcon={<AddIcon />}
          onClick={() => navigate('/campaigns/new')}
          sx={{
            backgroundColor: CAMPAIGN_BORDER,
            fontSize: '1rem',
            fontWeight: 600,
            px: 3,
            py: 1.5,
            '&:hover': {
              backgroundColor: '#1D4ED8'
            }
          }}
        >
          Create Campaign
        </Button>
      </Box>

      {campaigns.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No campaigns found</Typography>
        </Paper>
      ) : (
        campaigns.map((campaign) => {
          const progress = expandedCampaigns.has(campaign._id)
            ? calculateCampaignProgress(campaign)
            : 0;

          return (
            <Accordion
              key={campaign._id}
              expanded={expandedCampaigns.has(campaign._id)}
              onChange={handleCampaignExpand(campaign._id)}
              sx={{
                mb: 2,
                '& .MuiAccordionSummary-root': {
                  backgroundColor: CAMPAIGN_COLOR,
                  borderLeft: `4px solid ${CAMPAIGN_BORDER}`,
                  '&:hover': {
                    backgroundColor: CAMPAIGN_HOVER
                  }
                }
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ width: '100%', pr: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    {editingCell?.type === 'campaign' && editingCell?.id === campaign._id && editingCell?.field === 'name' ? (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flex: 1 }}>
                        <TextField
                          inputRef={editInputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') cancelEditing();
                          }}
                          size="small"
                          onClick={(e) => e.stopPropagation()}
                          sx={{ flex: 1 }}
                        />
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); saveEdit(); }} color="primary">
                          <CheckIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); cancelEditing(); }}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>{campaign.name}</Typography>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing('campaign', campaign._id, 'name', campaign.name);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                    <FormControl size="small" sx={{ minWidth: 120 }} onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={campaign.status}
                        onChange={(e) => handleCampaignStatusChange(campaign._id, e.target.value as CampaignStatus)}
                        sx={{ fontSize: '0.875rem' }}
                      >
                        <MenuItem value={CampaignStatus.DRAFT}>Draft</MenuItem>
                        <MenuItem value={CampaignStatus.ACTIVE}>Active</MenuItem>
                        <MenuItem value={CampaignStatus.PAUSED}>Paused</MenuItem>
                        <MenuItem value={CampaignStatus.COMPLETED}>Completed</MenuItem>
                        <MenuItem value={CampaignStatus.ARCHIVED}>Archived</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  {expandedCampaigns.has(campaign._id) && (
                    <Box sx={{ mt: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <LinearProgress
                          variant="determinate"
                          value={progress}
                          sx={{ flex: 1, height: 8, borderRadius: 1 }}
                        />
                        <Typography variant="body2" color="text.secondary" fontWeight={600}>
                          {progress}%
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {campaign.projects?.length || 0} project(s)
                      </Typography>
                    </Box>
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pl: 4, backgroundColor: '#FAFAFA' }}>
                {!campaign.projectsLoaded ? (
                  <Box display="flex" justifyContent="center" py={2}>
                    <CircularProgress size={30} />
                  </Box>
                ) : campaign.projects && campaign.projects.length > 0 ? (
                  campaign.projects.map((project) => {
                    const { completed, total } = getTaskCounts(project);

                    return (
                      <Accordion
                        key={project._id}
                        expanded={expandedProjects.has(project._id)}
                        onChange={handleProjectExpand(campaign._id, project._id)}
                        sx={{
                          mb: 1,
                          '& .MuiAccordionSummary-root': {
                            backgroundColor: PROJECT_COLOR,
                            borderLeft: `4px solid ${PROJECT_BORDER}`,
                            '&:hover': {
                              backgroundColor: PROJECT_HOVER
                            }
                          }
                        }}
                      >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            {editingCell?.type === 'project' && editingCell?.id === project._id && editingCell?.field === 'name' ? (
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flex: 1 }}>
                                <TextField
                                  inputRef={editInputRef}
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveEdit();
                                    if (e.key === 'Escape') cancelEditing();
                                  }}
                                  size="small"
                                  onClick={(e) => e.stopPropagation()}
                                  sx={{ flex: 1 }}
                                />
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); saveEdit(); }} color="primary">
                                  <CheckIcon fontSize="small" />
                                </IconButton>
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); cancelEditing(); }}>
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </Box>
                            ) : (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                                <Typography variant="subtitle1" fontWeight={600}>{project.name}</Typography>
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing('project', project._id, 'name', project.name);
                                  }}
                                >
                                  <EditIcon fontSize="small" />
                                </IconButton>
                                {expandedProjects.has(project._id) && (
                                  <Typography variant="caption" color="text.secondary">
                                    {completed} / {total} tasks completed
                                  </Typography>
                                )}
                              </Box>
                            )}
                            <FormControl size="small" sx={{ minWidth: 120 }} onClick={(e) => e.stopPropagation()}>
                              <Select
                                value={project.status}
                                onChange={(e) => handleProjectStatusChange(project._id, e.target.value as ProjectStatus)}
                                sx={{ fontSize: '0.875rem' }}
                              >
                                <MenuItem value={ProjectStatus.PLANNING}>Planning</MenuItem>
                                <MenuItem value={ProjectStatus.IN_PROGRESS}>In Progress</MenuItem>
                                <MenuItem value={ProjectStatus.REVIEW}>Review</MenuItem>
                                <MenuItem value={ProjectStatus.COMPLETED}>Completed</MenuItem>
                                <MenuItem value={ProjectStatus.ON_HOLD}>On Hold</MenuItem>
                              </Select>
                            </FormControl>
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails sx={{ backgroundColor: '#F5F5F5' }}>
                          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                              variant="contained"
                              size="small"
                              startIcon={<AddIcon />}
                              onClick={() => handleOpenCreateTaskModal(project._id, campaign._id)}
                              sx={{
                                backgroundColor: '#6366F1',
                                '&:hover': { backgroundColor: '#4F46E5' }
                              }}
                            >
                              Add Task
                            </Button>
                          </Box>
                          {!project.tasksLoaded ? (
                            <Box display="flex" justifyContent="center" py={2}>
                              <CircularProgress size={24} />
                            </Box>
                          ) : project.tasks && project.tasks.length > 0 ? (
                            <TableContainer component={Paper} sx={{ boxShadow: 2 }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow sx={{ backgroundColor: TASK_COLOR }}>
                                    <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Task Name</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Photos</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Notes</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Last Updated</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {project.tasks.map((task) => {
                                    const photoCount = getPhotoCount(task);

                                    return (
                                      <TableRow
                                        key={task._id}
                                        hover
                                        sx={{
                                          '&:last-child td, &:last-child th': { border: 0 },
                                          '&:hover': { backgroundColor: TASK_HOVER }
                                        }}
                                      >
                                        <TableCell>{formatDate(task.taskDate)}</TableCell>
                                        <TableCell>
                                          {editingCell?.type === 'task' && editingCell?.id === task._id && editingCell?.field === 'name' ? (
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                              <TextField
                                                inputRef={editInputRef}
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') saveEdit();
                                                  if (e.key === 'Escape') cancelEditing();
                                                }}
                                                size="small"
                                                fullWidth
                                              />
                                              <IconButton size="small" onClick={saveEdit} color="primary">
                                                <CheckIcon fontSize="small" />
                                              </IconButton>
                                              <IconButton size="small" onClick={cancelEditing}>
                                                <CloseIcon fontSize="small" />
                                              </IconButton>
                                            </Box>
                                          ) : (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                              <Typography
                                                variant="body2"
                                                sx={{
                                                  cursor: 'pointer',
                                                  color: 'primary.main',
                                                  '&:hover': { textDecoration: 'underline' }
                                                }}
                                                onClick={() => navigate(`/tasks/${task._id}`)}
                                              >
                                                {task.name}
                                              </Typography>
                                              <IconButton
                                                size="small"
                                                onClick={() => startEditing('task', task._id, 'name', task.name)}
                                              >
                                                <EditIcon fontSize="small" />
                                              </IconButton>
                                            </Box>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <FormControl size="small" fullWidth>
                                            <Select
                                              value={task.status}
                                              onChange={(e) => handleTaskStatusChange(task._id, e.target.value as TaskStatus)}
                                              sx={{ fontSize: '0.875rem' }}
                                            >
                                              <MenuItem value={TaskStatus.PENDING}>Pending</MenuItem>
                                              <MenuItem value={TaskStatus.IN_PROGRESS}>In Progress</MenuItem>
                                              <MenuItem value={TaskStatus.COMPLETED}>Completed</MenuItem>
                                            </Select>
                                          </FormControl>
                                        </TableCell>
                                        <TableCell>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            {photoCount > 0 && (
                                              <>
                                                <PhotoCameraIcon fontSize="small" color="action" />
                                                <Typography variant="caption">{photoCount}</Typography>
                                              </>
                                            )}
                                            <Tooltip title="Upload Photo">
                                              <IconButton
                                                size="small"
                                                onClick={() => handlePhotoUpload(task._id, campaign._id, project._id)}
                                                color="primary"
                                              >
                                                <UploadIcon fontSize="small" />
                                              </IconButton>
                                            </Tooltip>
                                          </Box>
                                        </TableCell>
                                        <TableCell>
                                          {editingCell?.type === 'task' && editingCell?.id === task._id && editingCell?.field === 'description' ? (
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                              <TextField
                                                inputRef={editInputRef}
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') saveEdit();
                                                  if (e.key === 'Escape') cancelEditing();
                                                }}
                                                size="small"
                                                multiline
                                                fullWidth
                                              />
                                              <IconButton size="small" onClick={saveEdit} color="primary">
                                                <CheckIcon fontSize="small" />
                                              </IconButton>
                                              <IconButton size="small" onClick={cancelEditing}>
                                                <CloseIcon fontSize="small" />
                                              </IconButton>
                                            </Box>
                                          ) : (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                              <Typography
                                                variant="body2"
                                                noWrap
                                                sx={{ maxWidth: 200, cursor: 'pointer' }}
                                                onClick={() => startEditing('task', task._id, 'description', task.description || '')}
                                              >
                                                {task.description || '-'}
                                              </Typography>
                                              {!task.description && (
                                                <IconButton
                                                  size="small"
                                                  onClick={() => startEditing('task', task._id, 'description', '')}
                                                >
                                                  <EditIcon fontSize="small" />
                                                </IconButton>
                                              )}
                                            </Box>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <Typography variant="caption" color="text.secondary">
                                            {formatDate(task.updatedAt)}
                                          </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                          <Tooltip title="Delete Task">
                                            <IconButton
                                              size="small"
                                              color="error"
                                              onClick={() => handleDeleteTask(task._id, campaign._id, project._id)}
                                            >
                                              <DeleteIcon fontSize="small" />
                                            </IconButton>
                                          </Tooltip>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          ) : (
                            <Paper sx={{ py: 3, textAlign: 'center', backgroundColor: '#FAFAFA' }}>
                              <Typography variant="body2" color="text.secondary">
                                No tasks assigned to this project yet.
                              </Typography>
                              <Button
                                variant="outlined"
                                size="small"
                                startIcon={<AddIcon />}
                                onClick={() => handleOpenCreateTaskModal(project._id, campaign._id)}
                                sx={{
                                  mt: 2,
                                  borderColor: '#6366F1',
                                  color: '#6366F1',
                                  '&:hover': {
                                    borderColor: '#4F46E5',
                                    backgroundColor: '#EEF2FF'
                                  }
                                }}
                              >
                                Create First Task
                              </Button>
                            </Paper>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    );
                  })
                ) : (
                  <Paper sx={{ py: 3, textAlign: 'center', backgroundColor: '#FAFAFA' }}>
                    <Typography variant="body2" color="text.secondary">
                      No projects in this campaign yet.
                    </Typography>
                  </Paper>
                )}
              </AccordionDetails>
            </Accordion>
          );
        })
      )}

      {/* Create Task Modal */}
      {selectedProjectForTask && (
        <CreateTaskModal
          open={createTaskModalOpen}
          onClose={handleCloseCreateTaskModal}
          projectId={selectedProjectForTask.projectId}
          campaignId={selectedProjectForTask.campaignId}
          onTaskCreated={handleTaskCreated}
        />
      )}
    </Box>
  );
}
