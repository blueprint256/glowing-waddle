import { useEffect, useState } from 'react';
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
  Alert
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PhotoCamera as PhotoCameraIcon
} from '@mui/icons-material';
import { campaignAPI, projectAPI, taskAPI } from '../services/api';
import { Campaign, Project, Task, TaskStatus } from '../types';

interface CampaignWithProjects extends Campaign {
  projects?: Project[];
  projectsLoaded?: boolean;
}

interface ProjectWithTasks extends Project {
  tasks?: Task[];
  tasksLoaded?: boolean;
}

export default function DetailsSheet() {
  const [campaigns, setCampaigns] = useState<CampaignWithProjects[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadCampaigns();
  }, []);

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
      // Load projects if not already loaded
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
      // Load tasks if not already loaded
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
    // Could add more logic here for other assets if needed
    return count;
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
      <Typography variant="h4" gutterBottom>
        Details Sheet
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Hierarchical view of all campaigns, projects, and tasks
      </Typography>

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
              sx={{ mb: 2 }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ width: '100%', pr: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">{campaign.name}</Typography>
                    <Chip label={campaign.status} size="small" color="primary" />
                  </Box>
                  {expandedCampaigns.has(campaign._id) && (
                    <Box sx={{ mt: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <LinearProgress
                          variant="determinate"
                          value={progress}
                          sx={{ flex: 1, height: 8, borderRadius: 1 }}
                        />
                        <Typography variant="body2" color="text.secondary">
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
              <AccordionDetails sx={{ pl: 4 }}>
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
                        sx={{ mb: 1 }}
                      >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Box sx={{ width: '100%' }}>
                            <Typography variant="subtitle1">{project.name}</Typography>
                            {expandedProjects.has(project._id) && (
                              <Typography variant="caption" color="text.secondary">
                                {completed} / {total} tasks completed
                              </Typography>
                            )}
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                          {!project.tasksLoaded ? (
                            <Box display="flex" justifyContent="center" py={2}>
                              <CircularProgress size={24} />
                            </Box>
                          ) : project.tasks && project.tasks.length > 0 ? (
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Date</TableCell>
                                    <TableCell>Task Name</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Photos</TableCell>
                                    <TableCell>Notes</TableCell>
                                    <TableCell>Last Updated</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {project.tasks.map((task) => {
                                    const photoCount = getPhotoCount(task);

                                    return (
                                      <TableRow
                                        key={task._id}
                                        hover
                                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                                      >
                                        <TableCell>{formatDate(task.publishDate)}</TableCell>
                                        <TableCell>
                                          <Typography variant="body2">{task.name}</Typography>
                                        </TableCell>
                                        <TableCell>
                                          <Chip
                                            label={task.status}
                                            size="small"
                                            color={getStatusColor(task.status)}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          {photoCount > 0 && (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              <PhotoCameraIcon fontSize="small" color="action" />
                                              <Typography variant="caption">{photoCount}</Typography>
                                            </Box>
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                            {task.description || '-'}
                                          </Typography>
                                        </TableCell>
                                        <TableCell>
                                          <Typography variant="caption" color="text.secondary">
                                            {formatDate(task.updatedAt)}
                                          </Typography>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                              No tasks assigned to this project yet.
                            </Typography>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    );
                  })
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No projects in this campaign yet.
                  </Typography>
                )}
              </AccordionDetails>
            </Accordion>
          );
        })
      )}
    </Box>
  );
}
