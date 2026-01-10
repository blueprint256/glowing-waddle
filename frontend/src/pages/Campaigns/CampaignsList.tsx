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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Tooltip
} from '@mui/material';
import { Add as AddIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { campaignAPI } from '../../services/api';
import { Campaign, UserRole, User } from '../../types';
import Pagination from '../../components/Pagination';
import Breadcrumbs from '../../components/Breadcrumbs';

export default function CampaignsList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 0, limit: 10 });
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    loadCampaigns();
  }, [page]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const res = await campaignAPI.getAll({ page, limit: 10, includeArchived: false });
      setCampaigns(res.data.campaigns || []);
      setPagination(res.data.pagination || { total: 0, pages: 0, limit: 10 });
    } catch (error) {
      console.error('Error loading campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await campaignAPI.create(formData);
      setOpen(false);
      setFormData({ name: '', description: '' });
      loadCampaigns();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to create campaign');
    }
  };

  const canCreate = [UserRole.SYSTEM_ADMIN, UserRole.HYBRID].includes(
    user?.role as UserRole
  );

  // Group campaigns by creator for System Admins
  const groupedCampaigns = (() => {
    if (user?.role !== UserRole.SYSTEM_ADMIN) {
      return null;
    }

    const groups: Record<string, { user: User; campaigns: Campaign[] }> = {};

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

  // Render a single campaign card
  const renderCampaignCard = (campaign: Campaign) => (
    <Grid item xs={12} md={6} lg={4} key={campaign._id}>
      <Card
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '280px'
        }}
      >
        <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          <Typography variant="h6" gutterBottom sx={{ mb: 2 }}>
            {campaign.name}
          </Typography>

          {/* Core Messages / Theme */}
          {campaign.coreMessages && (
            <Box sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600, textTransform: 'uppercase', display: 'block', mb: 0.5 }}
              >
                Core Messages / Theme
              </Typography>
              <Tooltip title={campaign.coreMessages} arrow placement="top">
                <Typography
                  variant="body2"
                  color="text.primary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.4
                  }}
                >
                  {campaign.coreMessages}
                </Typography>
              </Tooltip>
            </Box>
          )}

          {/* Description */}
          {campaign.description && (
            <Box sx={{ mb: 2 }}>
              <Tooltip title={campaign.description} arrow placement="top">
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.4
                  }}
                >
                  {campaign.description}
                </Typography>
              </Tooltip>
            </Box>
          )}

          <Box sx={{ mt: 'auto' }}>
            <Chip label={campaign.status} size="small" color="primary" />
          </Box>
        </CardContent>
        <CardActions>
          <Button size="small" onClick={() => navigate(`/campaigns/${campaign._id}`)}>
            View Details
          </Button>
        </CardActions>
      </Card>
    </Grid>
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress sx={{ color: '#2563EB' }} />
      </Box>
    );
  }

  return (
    <Box>
      {/* Breadcrumbs */}
      <Breadcrumbs />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">Campaigns</Typography>
        {canCreate && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            New Campaign
          </Button>
        )}
      </Box>

      {/* Hybrid Users: Flat list of their own campaigns */}
      {user?.role === UserRole.HYBRID && (
        <>
          <Grid container spacing={3}>
            {campaigns.map(renderCampaignCard)}
            {campaigns.length === 0 && (
              <Grid item xs={12}>
                <Typography align="center" color="text.secondary">
                  No campaigns found
                </Typography>
              </Grid>
            )}
          </Grid>

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
                <Accordion key={key} defaultExpanded={false} sx={{ mb: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                      <Typography variant="h6">
                        Campaigns by {creator.firstName} {creator.lastName}
                      </Typography>
                      <Chip
                        label={`${userCampaigns.length} campaign${userCampaigns.length !== 1 ? 's' : ''}`}
                        size="small"
                        color="primary"
                      />
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                        {creator.email}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={3}>
                      {userCampaigns.map(renderCampaignCard)}
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              ))
            ) : (
              <Typography align="center" color="text.secondary">
                No campaigns found
              </Typography>
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
