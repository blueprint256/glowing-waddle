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
  useMediaQuery,
  useTheme
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md')); // <960px
  const isSmallMobile = useMediaQuery(theme.breakpoints.down('sm')); // <600px
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

  // Color coding constants - Sophisticated Grey-Blue Gradient
  // Using neutral greys with blue accents for professional hierarchy

  // Campaign: Cool Grey (Professional, Strong, Top-level importance)
  const CAMPAIGN_COLOR = '#F8F9FA';      // Very light grey background
  const CAMPAIGN_BORDER = '#6B7280';     // Medium grey border (gray-500)
  const CAMPAIGN_HOVER = '#F1F3F5';      // Slightly darker grey on hover

  // Project: Sky Blue (Professional, Organized, Mid-level)
  const PROJECT_COLOR = '#E3F2FD';       // Light sky blue background
  const PROJECT_BORDER = '#2196F3';      // Clear blue border (blue-500)
  const PROJECT_HOVER = '#BBDEFB';       // Deeper blue on hover

  // Task: Warm Neutral (Clean, Focused, Detail-level)
  const TASK_COLOR = '#FAFAF9';          // Warm off-white background
  const TASK_HOVER = '#F5F5F4';          // Subtle warm gray hover

  // Creator Grouping: Lavender (Special, Administrative)
  const CREATOR_COLOR = '#F3E8FF';       // Soft lavender background
  const CREATOR_BORDER = '#A78BFA';      // Purple border (purple-400)

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

  // Calculate total task statistics across all campaigns
  const getTaskStatistics = () => {
    let allTasks: Task[] = [];
    campaigns.forEach(campaign => {
      campaign.projects?.forEach(project => {
        if (project.tasks) {
          allTasks = [...allTasks, ...project.tasks];
        }
      });
    });

    return {
      pending: allTasks.filter(t => t.status === TaskStatus.PENDING).length,
      inProgress: allTasks.filter(t => t.status === TaskStatus.IN_PROGRESS).length,
      completed: allTasks.filter(t => t.status === TaskStatus.COMPLETED).length,
      total: allTasks.length
    };
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

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.PENDING:
        return '#F59E0B';
      case TaskStatus.IN_PROGRESS:
        return '#3B82F6';
      case TaskStatus.COMPLETED:
        return '#10B981';
      default:
        return '#6B7280';
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
          mb: 1.5,
          borderRadius: { xs: '10px', sm: '14px' },
          border: `1px solid ${CAMPAIGN_BORDER}`,
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
          overflow: 'hidden',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
            borderColor: '#4B5563',
            transform: 'translateY(-1px)'
          },
          '& .MuiAccordionSummary-root': {
            backgroundColor: CAMPAIGN_COLOR,
            borderLeft: { xs: `3px solid ${CAMPAIGN_BORDER}`, sm: `4px solid ${CAMPAIGN_BORDER}` },
            minHeight: { xs: 52, sm: 58 },
            padding: { xs: '0 12px', sm: '0 20px' },
            transition: 'all 0.25s ease',
            '&:hover': {
              backgroundColor: CAMPAIGN_HOVER
            }
          },
          '&.Mui-expanded': {
            margin: '0 0 12px 0',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.10)'
          },
          '&:before': {
            display: 'none'
          }
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ width: '100%', pr: { xs: 0.5, sm: 1 } }}>
            <Box sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: { xs: 1, sm: 0 },
              mb: 0.5
            }}>
              {editingCell?.type === 'campaign' && editingCell?.id === campaign._id && editingCell?.field === 'name' ? (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flex: 1, width: '100%' }}>
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
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); saveEdit(); }}
                    color="primary"
                    sx={{ minWidth: '44px', minHeight: '44px' }}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); cancelEditing(); }}
                    sx={{ minWidth: '44px', minHeight: '44px' }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 600,
                      fontSize: { xs: '1rem', sm: '1.25rem' }
                    }}
                  >
                    {campaign.name}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing('campaign', campaign._id, 'name', campaign.name);
                    }}
                    sx={{ minWidth: '44px', minHeight: '44px' }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
              <FormControl
                size="small"
                sx={{ minWidth: { xs: '100%', sm: 120 } }}
                onClick={(e) => e.stopPropagation()}
              >
                <Select
                  value={campaign.status}
                  onChange={(e) => handleCampaignStatusChange(campaign._id, e.target.value as CampaignStatus)}
                  sx={{
                    fontSize: { xs: '0.8125rem', sm: '0.875rem' },
                    minHeight: { xs: '44px', sm: 'auto' }
                  }}
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
        <AccordionDetails sx={{ pl: { xs: 2, sm: 3 }, pr: { xs: 1.5, sm: 2 }, py: 2, backgroundColor: '#F9FAFB' }}>
          {/* Create Project Button */}
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleOpenCreateProjectModal(campaign._id)}
              fullWidth={isSmallMobile}
              sx={{
                backgroundColor: PROJECT_BORDER,
                borderRadius: '4px',
                minHeight: { xs: '44px', sm: 'auto' },
                fontSize: { xs: '0.8125rem', sm: '0.875rem' },
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
                    borderRadius: { xs: '8px', sm: '12px' },
                    border: `1px solid ${PROJECT_BORDER}`,
                    boxShadow: '0 1px 3px rgba(33, 150, 243, 0.1)',
                    overflow: 'hidden',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                      boxShadow: '0 3px 8px rgba(33, 150, 243, 0.15)',
                      borderColor: '#1976D2',
                      transform: 'translateY(-1px)'
                    },
                    '& .MuiAccordionSummary-root': {
                      backgroundColor: PROJECT_COLOR,
                      borderLeft: { xs: `2px solid ${PROJECT_BORDER}`, sm: `3px solid ${PROJECT_BORDER}` },
                      minHeight: { xs: 48, sm: 52 },
                      padding: { xs: '0 10px', sm: '0 16px' },
                      transition: 'all 0.25s ease',
                      '&:hover': {
                        backgroundColor: PROJECT_HOVER
                      }
                    },
                    '&.Mui-expanded': {
                      margin: '0 0 8px 0',
                      boxShadow: '0 3px 8px rgba(33, 150, 243, 0.12)'
                    },
                    '&:before': {
                      display: 'none'
                    }
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      justifyContent: 'space-between',
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      gap: { xs: 1, sm: 0 }
                    }}>
                      {editingCell?.type === 'project' && editingCell?.id === project._id && editingCell?.field === 'name' ? (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flex: 1, width: '100%' }}>
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
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); saveEdit(); }}
                            color="primary"
                            sx={{ minWidth: '44px', minHeight: '44px' }}
                          >
                            <CheckIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); cancelEditing(); }}
                            sx={{ minWidth: '44px', minHeight: '44px' }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, flexWrap: 'wrap' }}>
                          <Typography
                            variant="subtitle1"
                            fontWeight={600}
                            sx={{ fontSize: { xs: '0.9375rem', sm: '1rem' } }}
                          >
                            {project.name}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditing('project', project._id, 'name', project.name);
                            }}
                            sx={{ minWidth: '44px', minHeight: '44px' }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          {expandedProjects.has(project._id) && (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.75rem' } }}>
                              {completed} / {total} tasks completed
                            </Typography>
                          )}
                        </Box>
                      )}
                      <FormControl
                        size="small"
                        sx={{ minWidth: { xs: '100%', sm: 120 } }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Select
                          value={project.status}
                          onChange={(e) => handleProjectStatusChange(project._id, e.target.value as ProjectStatus)}
                          sx={{
                            fontSize: { xs: '0.8125rem', sm: '0.875rem' },
                            minHeight: { xs: '44px', sm: 'auto' }
                          }}
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
                  <AccordionDetails sx={{ backgroundColor: '#F5F5F5', px: { xs: 1, sm: 2 }, py: 2 }}>
                    <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => handleOpenCreateTaskModal(project._id, campaign._id)}
                        fullWidth={isSmallMobile}
                        sx={{
                          backgroundColor: '#6366F1',
                          borderRadius: '4px',
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.8125rem', sm: '0.875rem' },
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
                        mb: 1,
                        borderRadius: { xs: '6px', sm: '10px' },
                        border: '1px solid #E7E5E4',
                        backgroundColor: TASK_COLOR,
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                        overflow: { xs: 'auto', md: 'hidden' },
                        overflowX: { xs: 'auto', md: 'hidden' },
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.06)',
                          borderColor: '#D6D3D1'
                        }
                      }}>
                        <Table sx={{ minWidth: { xs: 900, md: 'auto' } }}>
                          <TableHead>
                            <TableRow sx={{
                              backgroundColor: '#F5F5F4',
                              borderBottom: '2px solid #E7E5E4'
                            }}>
                              <TableCell sx={{ fontWeight: 700, width: '10%', color: '#57534E', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Date</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: '20%', color: '#57534E', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Task Name</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: '12%', color: '#57534E', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Status</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: '8%', color: '#57534E', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Photos</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: '30%', color: '#57534E', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Description</TableCell>
                              <TableCell sx={{ fontWeight: 700, width: '12%', color: '#57534E', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Last Updated</TableCell>
                              <TableCell align="center" sx={{ fontWeight: 700, width: '8%', color: '#57534E', fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {project.tasks.map((task, index) => {
                              const photoCount = getPhotoCount(task);

                              return (
                                <TableRow
                                  key={task._id}
                                  sx={{
                                    backgroundColor: index % 2 === 0 ? '#FFFFFF' : '#F9FAFB',
                                    transition: 'all 0.2s ease',
                                    '&:last-child td, &:last-child th': { border: 0 },
                                    '&:hover': {
                                      backgroundColor: '#F3F4F6',
                                      transform: 'scale(1.002)',
                                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                                    }
                                  }}
                                >
                                  <TableCell sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>{formatDate(task.taskDate)}</TableCell>
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
                                        <IconButton
                                          size="small"
                                          onClick={saveEdit}
                                          color="primary"
                                          sx={{ minWidth: '44px', minHeight: '44px' }}
                                        >
                                          <CheckIcon fontSize="small" />
                                        </IconButton>
                                        <IconButton
                                          size="small"
                                          onClick={cancelEditing}
                                          sx={{ minWidth: '44px', minHeight: '44px' }}
                                        >
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
                                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                            '&:hover': { textDecoration: 'underline' }
                                          }}
                                          onClick={() => navigate(`/tasks/${task._id}`)}
                                        >
                                          {task.name}
                                        </Typography>
                                        <IconButton
                                          size="small"
                                          onClick={() => startEditing('task', task._id, 'name', task.name)}
                                          sx={{ minWidth: '44px', minHeight: '44px' }}
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
                                        sx={{
                                          backgroundColor: getStatusColor(task.status),
                                          color: 'white',
                                          fontWeight: 600,
                                          fontSize: { xs: '0.6875rem', sm: '0.75rem' },
                                          borderRadius: '4px',
                                          minHeight: { xs: '44px', sm: 'auto' },
                                          transition: 'all 0.2s ease',
                                          '&:hover': {
                                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.15)',
                                            transform: 'scale(0.98)'
                                          },
                                          '& .MuiOutlinedInput-notchedOutline': {
                                            border: 'none'
                                          },
                                          '& .MuiSvgIcon-root': {
                                            color: 'white'
                                          }
                                        }}
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
                                          sx={{ minWidth: '44px', minHeight: '44px' }}
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
                                        sx={{
                                          maxWidth: 200,
                                          flex: 1,
                                          fontSize: { xs: '0.75rem', sm: '0.875rem' }
                                        }}
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
                                        sx={{
                                          opacity: 0,
                                          transition: 'opacity 0.2s',
                                          minWidth: '44px',
                                          minHeight: '44px'
                                        }}
                                      >
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </Box>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.6875rem', sm: '0.75rem' } }}>
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
                                          sx={{ minWidth: '44px', minHeight: '44px' }}
                                        >
                                          <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Delete Task">
                                        <IconButton
                                          size="small"
                                          color="error"
                                          onClick={() => handleDeleteTask(task._id, campaign._id, project._id)}
                                          sx={{ minWidth: '44px', minHeight: '44px' }}
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
                        py: { xs: 2, sm: 3 },
                        px: { xs: 2, sm: 0 },
                        textAlign: 'center',
                        backgroundColor: '#FAFAFA',
                        borderRadius: '8px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
                      }}>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
                          No tasks assigned to this project yet.
                        </Typography>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<AddIcon />}
                          onClick={() => handleOpenCreateTaskModal(project._id, campaign._id)}
                          fullWidth={isSmallMobile}
                          sx={{
                            mt: 2,
                            minHeight: { xs: '44px', sm: 'auto' },
                            borderRadius: '4px',
                            borderColor: '#6366F1',
                            color: '#6366F1',
                            fontSize: { xs: '0.8125rem', sm: '0.875rem' },
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
              py: { xs: 2, sm: 3 },
              px: { xs: 2, sm: 0 },
              textAlign: 'center',
              backgroundColor: '#FAFAFA',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
            }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
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
    <Box sx={{ px: { xs: 1, sm: 2, md: 0 } }}>
      <Typography
        variant="h4"
        gutterBottom
        sx={{
          fontWeight: 600,
          mb: 1,
          fontSize: { xs: '1.5rem', sm: '2rem', md: '2.125rem' }
        }}
      >
        Details Sheet
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        paragraph
        sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}
      >
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
          size={isMobile ? 'medium' : 'large'}
          startIcon={<AddIcon />}
          onClick={() => setCreateCampaignModalOpen(true)}
          fullWidth={isSmallMobile}
          sx={{
            backgroundColor: CAMPAIGN_BORDER,
            fontSize: { xs: '0.875rem', sm: '1rem' },
            fontWeight: 600,
            px: { xs: 2, sm: 3 },
            py: { xs: 1.25, sm: 1.5 },
            minHeight: { xs: '44px', sm: 'auto' },
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
                  <AccordionDetails sx={{ backgroundColor: '#F9FAFB', p: 2 }}>
                    <Box>
                      {userCampaigns.map(renderCampaign)}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              ))
            ) : (
              <Paper sx={{
                p: 4,
                textAlign: 'center',
                borderRadius: '12px',
                border: '1px solid #E5E7EB',
                backgroundColor: '#FAFBFC',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
              }}>
                <Typography color="text.secondary" variant="body1">No campaigns found</Typography>
              </Paper>
            )}
          </Box>

          {/* Summary Statistics */}
          {campaigns.length > 0 && (() => {
            const stats = getTaskStatistics();
            return (
              <Paper sx={{
                p: { xs: 2, sm: 2.5 },
                mb: 3,
                backgroundColor: '#FAFBFC',
                border: '1px solid #E5E7EB',
                borderRadius: { xs: '8px', sm: '12px' },
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                transition: 'all 0.2s ease',
                '&:hover': {
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.06)',
                  borderColor: '#D1D5DB'
                }
              }}>
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
                  gap: { xs: 2, sm: 4 },
                  justifyItems: 'center'
                }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, color: '#F59E0B', fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                      {stats.pending}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
                      Pending
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, color: '#3B82F6', fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                      {stats.inProgress}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
                      In Progress
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, color: '#10B981', fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                      {stats.completed}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
                      Completed
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, color: '#6B7280', fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                      {stats.total}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
                      Total Tasks
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            );
          })()}

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
