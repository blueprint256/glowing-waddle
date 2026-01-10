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
  FormControl
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PhotoCamera as PhotoCameraIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Upload as UploadIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { campaignAPI, projectAPI, taskAPI } from '../services/api';
import { Campaign, Project, Task, TaskStatus, CampaignStatus, ProjectStatus, UserRole, User } from '../types';
import CreateTaskModal from '../components/CreateTaskModal';
import CampaignFormModal from '../components/CampaignFormModal';
import ProjectFormDialog from '../components/Projects/ProjectFormDialog';
import Pagination from '../components/Pagination';
import FilterToolbar, { FilterOptions } from '../components/FilterToolbar';
import SocialPreviewModal from '../components/SocialPreviewModal';
import Breadcrumbs from '../components/Breadcrumbs';

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
  const { user } = useAuthStore();
  const [campaigns, setCampaigns] = useState<CampaignWithProjects[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 0, limit: 10 });
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  const [createCampaignModalOpen, setCreateCampaignModalOpen] = useState(false);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [selectedProjectForTask, setSelectedProjectForTask] = useState<{ projectId: string; campaignId: string } | null>(null);
  const [selectedCampaignForProject, setSelectedCampaignForProject] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [previewTask, setPreviewTask] = useState<Task | null>(null);
  const [editDescriptionTask, setEditDescriptionTask] = useState<Task | null>(null);
  const [filters, setFilters] = useState<FilterOptions>({
    search: '',
    campaignIds: [],
    projectIds: [],
    statuses: [],
    dateFrom: '',
    dateTo: '',
    createdBy: []
  });

  // Color coding constants - Unified Blue Hierarchy (#1976d2 shades)
  const CAMPAIGN_COLOR = '#BBDEFB'; // Deep blue background (lighter shade)
  const CAMPAIGN_BORDER = '#1565C0'; // Darkest blue border (dark shade of #1976d2)
  const CAMPAIGN_HOVER = '#90CAF9'; // Medium blue hover
  const PROJECT_COLOR = '#E3F2FD';  // Light blue background
  const PROJECT_BORDER = '#1976D2';  // Primary blue border (base color)
  const PROJECT_HOVER = '#BBDEFB';   // Lighter blue hover
  const TASK_COLOR = '#E3F2FD';      // Very light blue
  const TASK_HOVER = '#BBDEFB';      // Light blue hover
  const CREATOR_COLOR = '#E3F2FD';   // Very light blue for creator grouping
  const CREATOR_BORDER = '#1976D2';  // Primary blue border

  // Group campaigns by creator for System Admins
  const groupedCampaigns = (() => {
    if (user?.role !== UserRole.SYSTEM_ADMIN) {
      return null;
    }

    const groups: Record<string, { user: User; campaigns: CampaignWithProjects[] }> = {};

    campaigns.forEach((campaign) => {
      const creator = campaign.createdBy as User;
      if (!creator || typeof creator === 'string') return;

      const key = creator._id || creator.email;
      if (!groups[key]) {
        groups[key] = { user: creator, campaigns: [] };
      }
      groups[key].campaigns.push(campaign);
    });

    return groups;
  })();

  useEffect(() => {
    loadCampaigns();
  }, [page, filters]);

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

      // Build query parameters from filters
      const params: any = {
        page,
        limit: 1000, // Increased for comprehensive filtering
        includeArchived: false
      };

      // Add filter parameters
      if (filters.search) {
        params.search = filters.search;
      }
      if (filters.campaignIds && filters.campaignIds.length > 0) {
        params.campaignId = filters.campaignIds.join(',');
      }
      if (filters.statuses && filters.statuses.length > 0) {
        params.status = filters.statuses.join(',');
      }
      if (filters.dateFrom) {
        params.dateFrom = filters.dateFrom;
      }
      if (filters.dateTo) {
        params.dateTo = filters.dateTo;
      }
      if (filters.createdBy && filters.createdBy.length > 0 && user?.role === UserRole.SYSTEM_ADMIN) {
        params.createdBy = filters.createdBy.join(',');
      }

      const res = await campaignAPI.getAll(params);
      const campaignsData = res.data.campaigns || [];
      setCampaigns(
        campaignsData.map((c: Campaign) => ({
          ...c,
          projects: [],
          projectsLoaded: false
        }))
      );
      setPagination(res.data.pagination || { total: 0, pages: 0, limit: 1000 });
    } catch (error: any) {
      console.error('Error loading campaigns:', error);
      setError(error.response?.data?.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const loadProjectsForCampaign = async (campaignId: string) => {
    try {
      // Build query parameters from filters
      const params: any = { campaignId, limit: 1000 };

      // Apply project and date filters
      if (filters.search) {
        params.search = filters.search;
      }
      if (filters.projectIds && filters.projectIds.length > 0) {
        params.projectId = filters.projectIds.join(',');
      }
      if (filters.statuses && filters.statuses.length > 0) {
        params.status = filters.statuses.join(',');
      }
      if (filters.dateFrom) {
        params.dateFrom = filters.dateFrom;
      }
      if (filters.dateTo) {
        params.dateTo = filters.dateTo;
      }

      const res = await projectAPI.getAll(params);
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
      // Build query parameters from filters
      const params: any = { projectId, limit: 1000 };

      // Apply task filters
      if (filters.search) {
        params.search = filters.search;
      }
      if (filters.statuses && filters.statuses.length > 0) {
        params.status = filters.statuses.join(',');
      }
      if (filters.dateFrom) {
        params.dateFrom = filters.dateFrom;
      }
      if (filters.dateTo) {
        params.dateTo = filters.dateTo;
      }

      const res = await taskAPI.getAll(params);
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
    _event: React.SyntheticEvent,
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
    _event: React.SyntheticEvent,
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

  const handleSaveDescription = async (taskId: string, description: string) => {
    try {
      await taskAPI.update(taskId, { description });
      setCampaigns(prev =>
        prev.map(c => ({
          ...c,
          projects: c.projects?.map(p => ({
            ...p,
            tasks: p.tasks?.map(t =>
              t._id === taskId ? { ...t, description } : t
            )
          }))
        }))
      );
    } catch (error: any) {
      console.error('Error updating task description:', error);
      alert(error.response?.data?.message || 'Failed to update task description');
      throw error;
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

  const handleOpenCreateProjectModal = (campaignId: string) => {
    setSelectedCampaignForProject(campaignId);
    setCreateProjectModalOpen(true);
  };

  const handleCloseCreateProjectModal = () => {
    setCreateProjectModalOpen(false);
    setSelectedCampaignForProject(null);
  };

  const handleProjectCreated = async () => {
    if (selectedCampaignForProject) {
      await loadProjectsForCampaign(selectedCampaignForProject);
    }
    handleCloseCreateProjectModal();
  };

  const handleCampaignCreated = async () => {
    await loadCampaigns();
    setCreateCampaignModalOpen(false);
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

  // Helper function to render a single campaign with its hierarchical structure
  const renderCampaign = (campaign: CampaignWithProjects) => {
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
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
          '&:hover': {
            boxShadow: '0 10px 15px rgba(0, 0, 0, 0.15)',
            transform: 'scale(1.01)'
          },
          '& .MuiAccordionSummary-root': {
            backgroundColor: CAMPAIGN_COLOR,
            borderLeft: `4px solid ${CAMPAIGN_BORDER}`,
            transition: 'background-color 0.2s ease',
            '&:hover': {
              backgroundColor: CAMPAIGN_HOVER
            }
          },
          '&.Mui-expanded': {
            margin: '0 0 16px 0'
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
          {/* Create Project Button */}
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleOpenCreateProjectModal(campaign._id)}
              sx={{
                backgroundColor: PROJECT_BORDER,
                borderRadius: '4px',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                '&:hover': {
                  backgroundColor: '#4F46E5',
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
                  transform: 'scale(0.98)'
                },
                '&:active': {
                  transform: 'scale(0.95)'
                }
              }}
            >
              Create Project
            </Button>
          </Box>

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
                    borderRadius: '8px',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
                    overflow: 'hidden',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      boxShadow: '0 6px 12px rgba(0, 0, 0, 0.12)',
                      transform: 'scale(1.005)'
                    },
                    '& .MuiAccordionSummary-root': {
                      backgroundColor: PROJECT_COLOR,
                      borderLeft: `4px solid ${PROJECT_BORDER}`,
                      transition: 'background-color 0.2s ease',
                      '&:hover': {
                        backgroundColor: PROJECT_HOVER
                      }
                    },
                    '&.Mui-expanded': {
                      margin: '0 0 8px 0'
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
                          borderRadius: '4px',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                          '&:hover': {
                            backgroundColor: '#4F46E5',
                            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
                            transform: 'scale(0.98)'
                          },
                          '&:active': {
                            transform: 'scale(0.95)'
                          }
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
                      <TableContainer component={Paper} sx={{
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        transition: 'box-shadow 0.3s ease',
                        '&:hover': {
                          boxShadow: '0 6px 12px rgba(0, 0, 0, 0.15)'
                        }
                      }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow sx={{ backgroundColor: TASK_COLOR }}>
                              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Task Name</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Photos</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
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
                                    transition: 'all 0.2s ease',
                                    '&:last-child td, &:last-child th': { border: 0 },
                                    '&:hover': {
                                      backgroundColor: TASK_HOVER,
                                      transform: 'scale(1.002)',
                                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                                    }
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
                                    <Box
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        cursor: 'pointer',
                                        '&:hover .edit-icon': {
                                          opacity: 1
                                        }
                                      }}
                                      onClick={() => setEditDescriptionTask(task)}
                                    >
                                      <Typography
                                        variant="body2"
                                        noWrap
                                        sx={{ maxWidth: 200, flex: 1 }}
                                      >
                                        {task.description || '-'}
                                      </Typography>
                                      <IconButton
                                        className="edit-icon"
                                        size="small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditDescriptionTask(task);
                                        }}
                                        sx={{ opacity: 0, transition: 'opacity 0.2s' }}
                                      >
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </Box>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption" color="text.secondary">
                                      {formatDate(task.updatedAt)}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="right">
                                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                                      <Tooltip title="Preview on Social Media">
                                        <IconButton
                                          size="small"
                                          color="primary"
                                          onClick={() => setPreviewTask(task)}
                                          disabled={!task.name && !task.designedImage}
                                        >
                                          <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Delete Task">
                                        <IconButton
                                          size="small"
                                          color="error"
                                          onClick={() => handleDeleteTask(task._id, campaign._id, project._id)}
                                        >
                                          <DeleteIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Box>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    ) : (
                      <Paper sx={{
                        py: 3,
                        textAlign: 'center',
                        backgroundColor: '#FAFAFA',
                        borderRadius: '8px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                      }}>
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
                            borderRadius: '4px',
                            borderColor: '#6366F1',
                            color: '#6366F1',
                            transition: 'all 0.2s ease',
                            '&:hover': {
                              borderColor: '#4F46E5',
                              backgroundColor: '#EEF2FF',
                              transform: 'scale(0.98)'
                            },
                            '&:active': {
                              transform: 'scale(0.95)'
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
            <Paper sx={{
              py: 3,
              textAlign: 'center',
              backgroundColor: '#FAFAFA',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
            }}>
              <Typography variant="body2" color="text.secondary">
                No projects in this campaign yet.
              </Typography>
            </Paper>
          )}
        </AccordionDetails>
      </Accordion>
    );
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
      {/* Breadcrumbs */}
      <Breadcrumbs />

      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 1 }}>
        Details Sheet
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Hierarchical view of all campaigns, projects, and tasks with inline editing and comprehensive filtering
      </Typography>

      {/* Filter Toolbar */}
      <FilterToolbar
        filters={filters}
        onFilterChange={setFilters}
        showCampaignFilter={true}
        showProjectFilter={true}
        showStatusFilter={true}
        statusType="task"
        showDateFilter={true}
        showCreatorFilter={user?.role === UserRole.SYSTEM_ADMIN}
        placeholder="Search campaigns, projects, and tasks..."
      />

      {/* Create Campaign Button */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-start' }}>
        <Button
          variant="contained"
          size="large"
          startIcon={<AddIcon />}
          onClick={() => setCreateCampaignModalOpen(true)}
          sx={{
            backgroundColor: CAMPAIGN_BORDER,
            fontSize: '1rem',
            fontWeight: 600,
            px: 3,
            py: 1.5,
            borderRadius: '4px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: '#1D4ED8',
              boxShadow: '0 6px 12px rgba(0, 0, 0, 0.15)',
              transform: 'scale(0.98)'
            },
            '&:active': {
              transform: 'scale(0.95)'
            }
          }}
        >
          Create Campaign
        </Button>
      </Box>

      {/* Hybrid Users: Flat list of campaigns */}
      {user?.role === UserRole.HYBRID && (
        <>
          {campaigns.length === 0 ? (
            <Paper sx={{
              p: 3,
              textAlign: 'center',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
            }}>
              <Typography color="text.secondary">No campaigns found</Typography>
            </Paper>
          ) : (
            campaigns.map(renderCampaign)
          )}

          <Pagination
            currentPage={page}
            totalPages={pagination.pages}
            totalItems={pagination.total}
            itemsPerPage={pagination.limit}
            onPageChange={(newPage) => setPage(newPage)}
          />
        </>
      )}

      {/* System Admins: Grouped by creator */}
      {user?.role === UserRole.SYSTEM_ADMIN && (
        <>
          <Box>
            {groupedCampaigns && Object.keys(groupedCampaigns).length > 0 ? (
              Object.entries(groupedCampaigns).map(([key, { user: creator, campaigns: userCampaigns }]) => (
                <Accordion
                  key={key}
                  defaultExpanded={false}
                  sx={{
                    mb: 3,
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    overflow: 'hidden',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      boxShadow: '0 10px 15px rgba(0, 0, 0, 0.15)',
                      transform: 'scale(1.01)'
                    },
                    '& .MuiAccordionSummary-root': {
                      backgroundColor: CREATOR_COLOR,
                      borderLeft: `4px solid ${CREATOR_BORDER}`,
                      transition: 'background-color 0.2s ease',
                      '&:hover': {
                        backgroundColor: '#E0F2FE'
                      }
                    },
                    '&.Mui-expanded': {
                      margin: '0 0 24px 0'
                    }
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                      <Typography variant="h6" sx={{ fontWeight: 600 }}>
                        Campaigns by {creator.firstName} {creator.lastName}
                      </Typography>
                      <Chip
                        label={`${userCampaigns.length} campaign${userCampaigns.length !== 1 ? 's' : ''}`}
                        size="small"
                        sx={{
                          backgroundColor: CREATOR_BORDER,
                          color: 'white',
                          fontWeight: 600
                        }}
                      />
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                        {creator.email}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ backgroundColor: '#FAFAFA' }}>
                    <Box>
                      {userCampaigns.map(renderCampaign)}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              ))
            ) : (
              <Paper sx={{
                p: 3,
                textAlign: 'center',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
              }}>
                <Typography color="text.secondary">No campaigns found</Typography>
              </Paper>
            )}
          </Box>

          <Pagination
            currentPage={page}
            totalPages={pagination.pages}
            totalItems={pagination.total}
            itemsPerPage={pagination.limit}
            onPageChange={(newPage) => setPage(newPage)}
          />
        </>
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

      {/* Create Campaign Modal */}
      <CampaignFormModal
        open={createCampaignModalOpen}
        onClose={() => setCreateCampaignModalOpen(false)}
        onSuccess={handleCampaignCreated}
      />

      {/* Create Project Modal */}
      {selectedCampaignForProject && (
        <ProjectFormDialog
          open={createProjectModalOpen}
          onClose={handleCloseCreateProjectModal}
          campaignId={selectedCampaignForProject}
          onSuccess={handleProjectCreated}
        />
      )}

      {/* Social Preview Modal (Read-only) */}
      {previewTask && (
        <SocialPreviewModal
          open={!!previewTask}
          onClose={() => setPreviewTask(null)}
          task={previewTask}
          editable={false}
        />
      )}

      {/* Edit Description Modal (Editable with Live Preview) */}
      {editDescriptionTask && (
        <SocialPreviewModal
          open={!!editDescriptionTask}
          onClose={() => setEditDescriptionTask(null)}
          task={editDescriptionTask}
          editable={true}
          onSave={handleSaveDescription}
        />
      )}
    </Box>
  );
}
