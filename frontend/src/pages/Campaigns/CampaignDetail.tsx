import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Paper,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  Breadcrumbs,
  Link,
  CircularProgress,
  Stack,
  Divider
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { campaignAPI, projectAPI } from '../../services/api';
import { Campaign, Project, UserRole } from '../../types';
import { useAuthStore } from '../../store/authStore';
import ProjectFormDialog from '../../components/Projects/ProjectFormDialog';

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (id) {
      loadCampaign();
      loadProjects();
    }
  }, [id]);

  const loadCampaign = async () => {
    try {
      setLoading(true);
      const res = await campaignAPI.getById(id!);
      setCampaign(res.data.campaign);
    } catch (error) {
      console.error('Error loading campaign:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async () => {
    try {
      const res = await projectAPI.getAll({ campaignId: id });
      setProjects(res.data.projects || []);
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };

  const handleCreateProject = () => {
    setIsCreateDialogOpen(true);
  };

  const handleProjectCreated = () => {
    loadProjects();
  };

  // Check if user can create projects
  const canCreateProject = () => {
    if (!user || !campaign) return false;
    // System Admin can create projects in any campaign
    if (user.role === UserRole.SYSTEM_ADMIN) return true;
    // Hybrid users can only create projects in campaigns they own
    return campaign.createdBy === user.id || campaign.createdBy?._id === user.id;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress sx={{ color: '#2563EB' }} />
      </Box>
    );
  }

  if (!campaign) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" onClick={() => navigate('/campaigns')}>
          Campaigns
        </Link>
        <Typography color="text.primary">{campaign.name}</Typography>
      </Breadcrumbs>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h4">{campaign.name}</Typography>
          <Chip label={campaign.status} color="primary" />
        </Box>
        {campaign.description && (
          <Typography variant="body1" paragraph>
            {campaign.description}
          </Typography>
        )}

        {campaign.coreMessages && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Core Messages / Theme
            </Typography>
            <Typography variant="body1" paragraph>
              {campaign.coreMessages}
            </Typography>
          </Box>
        )}

        {campaign.hashtags && campaign.hashtags.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Hashtags
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {campaign.hashtags.map((tag, index) => (
                <Chip
                  key={index}
                  label={`#${tag}`}
                  color="primary"
                  variant="outlined"
                  size="small"
                />
              ))}
            </Stack>
          </Box>
        )}

        {(campaign.budget || campaign.startDate) && <Divider sx={{ my: 2 }} />}

        <Grid container spacing={2}>
          {campaign.budget && (
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2">Budget</Typography>
              <Typography variant="h6">${campaign.budget.toLocaleString()}</Typography>
            </Grid>
          )}
          {campaign.startDate && (
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2">Start Date</Typography>
              <Typography>{new Date(campaign.startDate).toLocaleDateString()}</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">Projects</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateProject}
          disabled={!canCreateProject()}
        >
          New Project
        </Button>
      </Box>

      <Grid container spacing={2}>
        {projects.map((project) => (
          <Grid item xs={12} md={6} key={project._id}>
            <Card>
              <CardContent>
                <Typography variant="h6">{project.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {project.description}
                </Typography>
                <Chip label={project.status} size="small" sx={{ mt: 1 }} />
              </CardContent>
              <CardActions>
                <Button size="small" onClick={() => navigate(`/projects/${project._id}`)}>
                  View Details
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
        {projects.length === 0 && (
          <Grid item xs={12}>
            <Typography align="center" color="text.secondary">
              No projects found
            </Typography>
          </Grid>
        )}
      </Grid>

      <ProjectFormDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        campaignId={id!}
        onSuccess={handleProjectCreated}
      />
    </Box>
  );
}
