import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { campaignAPI, teamAPI } from '../../services/api';
import { Campaign, UserRole, CampaignStatus } from '../../types';

export default function CampaignsList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    teamId: '',
    budget: ''
  });

  useEffect(() => {
    loadCampaigns();
    loadTeams();
  }, []);

  const loadCampaigns = async () => {
    try {
      const res = await campaignAPI.getAll();
      setCampaigns(res.data.campaigns || []);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    }
  };

  const loadTeams = async () => {
    try {
      const res = await teamAPI.getAll();
      setTeams(res.data.teams || []);
    } catch (error) {
      console.error('Error loading teams:', error);
    }
  };

  const handleCreate = async () => {
    try {
      await campaignAPI.create(formData);
      setOpen(false);
      setFormData({ name: '', description: '', teamId: '', budget: '' });
      loadCampaigns();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to create campaign');
    }
  };

  const canCreate = [UserRole.SYSTEM_ADMIN, UserRole.HYBRID, UserRole.MARKETER].includes(
    user?.role as UserRole
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">Campaigns</Typography>
        {canCreate && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            New Campaign
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {campaigns.map((campaign) => (
          <Grid item xs={12} md={6} lg={4} key={campaign._id}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {campaign.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {campaign.description}
                </Typography>
                <Chip label={campaign.status} size="small" color="primary" />
                {campaign.budget && (
                  <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    Budget: ${campaign.budget.toLocaleString()}
                  </Typography>
                )}
              </CardContent>
              <CardActions>
                <Button size="small" onClick={() => navigate(`/campaigns/${campaign._id}`)}>
                  View Details
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
        {campaigns.length === 0 && (
          <Grid item xs={12}>
            <Typography align="center" color="text.secondary">
              No campaigns found
            </Typography>
          </Grid>
        )}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Campaign</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            margin="normal"
            multiline
            rows={3}
          />
          <TextField
            fullWidth
            select
            label="Team"
            value={formData.teamId}
            onChange={(e) => setFormData({ ...formData, teamId: e.target.value })}
            margin="normal"
            required
          >
            {teams.map((team) => (
              <MenuItem key={team._id} value={team._id}>
                {team.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            label="Budget"
            type="number"
            value={formData.budget}
            onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
