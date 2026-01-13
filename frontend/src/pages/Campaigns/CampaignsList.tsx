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
  Tooltip,
  useMediaQuery,
  useTheme
} from '@mui/material';
import { Add as AddIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { campaignAPI } from '../../services/api';
import { Campaign, UserRole, User } from '../../types';
import Pagination from '../../components/Pagination';

export default function CampaignsList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // <600px
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
    <Grid item xs={12} sm={6} md={6} lg={4} key={campaign._id}>
      <Card
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: { xs: '240px', sm: '280px' },
          borderRadius: { xs: '8px', sm: '12px' },
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
          transition: 'all 0.2s ease',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
            transform: 'translateY(-2px)'
          }
        }}
      >
        <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: { xs: 2, sm: 2.5 } }}>
          <Typography
            variant="h6"
            gutterBottom
            sx={{
              mb: 2,
              fontSize: { xs: '1.125rem', sm: '1.25rem' },
              fontWeight: 600
            }}
          >
            {campaign.name}
          </Typography>

          {/* Core Messages / Theme */}
          {campaign.coreMessages && (
            <Box sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  display: 'block',
                  mb: 0.5,
                  fontSize: { xs: '0.6875rem', sm: '0.75rem' }
                }}
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
                    lineHeight: 1.4,
                    fontSize: { xs: '0.875rem', sm: '0.875rem' }
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
                    lineHeight: 1.4,
                    fontSize: { xs: '0.8125rem', sm: '0.875rem' }
                  }}
                >
                  {campaign.description}
                </Typography>
              </Tooltip>
            </Box>
          )}

          <Box sx={{ mt: 'auto' }}>
            <Chip
              label={campaign.status}
              size="small"
              color="primary"
              sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
            />
          </Box>
        </CardContent>
        <CardActions sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Button
            size="small"
            onClick={() => navigate(`/campaigns/${campaign._id}`)}
            sx={{
              minHeight: { xs: '40px', sm: 'auto' },
              fontSize: { xs: '0.8125rem', sm: '0.875rem' }
            }}
          >
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
    <Box sx={{ px: { xs: 1, sm: 2, md: 0 } }}>
      <Box sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between',
        alignItems: { xs: 'flex-start', sm: 'center' },
        gap: { xs: 2, sm: 0 },
        mb: 3
      }}>
        <Typography
          variant="h4"
          sx={{
            fontSize: { xs: '1.5rem', sm: '2rem', md: '2.125rem' },
            fontWeight: 600
          }}
        >
          Campaigns
        </Typography>
        {canCreate && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpen(true)}
            fullWidth={isMobile}
            sx={{
              minHeight: { xs: '44px', sm: 'auto' },
              fontSize: { xs: '0.875rem', sm: '0.875rem' }
            }}
          >
            New Campaign
          </Button>
        )}
      </Box>

      {/* Hybrid Users: Flat list of their own campaigns */}
      {user?.role === UserRole.HYBRID && (
        <>
          <Grid container spacing={{ xs: 2, sm: 3 }}>
            {campaigns.map(renderCampaignCard)}
            {campaigns.length === 0 && (
              <Grid item xs={12}>
                <Typography
                  align="center"
                  color="text.secondary"
                  sx={{ fontSize: { xs: '0.875rem', sm: '1rem' }, py: 4 }}
                >
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
                <Accordion
                  key={key}
                  defaultExpanded={false}
                  sx={{
                    mb: 2,
                    borderRadius: { xs: '8px', sm: '12px' },
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                    '&:before': { display: 'none' },
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)'
                    }
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    sx={{ px: { xs: 2, sm: 3 } }}
                  >
                    <Box sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      gap: { xs: 1, sm: 2 },
                      width: '100%'
                    }}>
                      <Typography
                        variant="h6"
                        sx={{ fontSize: { xs: '1rem', sm: '1.25rem' } }}
                      >
                        Campaigns by {creator.firstName} {creator.lastName}
                      </Typography>
                      <Chip
                        label={`${userCampaigns.length} campaign${userCampaigns.length !== 1 ? 's' : ''}`}
                        size="small"
                        color="primary"
                        sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          ml: { xs: 0, sm: 'auto' },
                          fontSize: { xs: '0.8125rem', sm: '0.875rem' }
                        }}
                      >
                        {creator.email}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: { xs: 2, sm: 3 } }}>
                    <Grid container spacing={{ xs: 2, sm: 3 }}>
                      {userCampaigns.map(renderCampaignCard)}
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              ))
            ) : (
              <Typography
                align="center"
                color="text.secondary"
                sx={{ fontSize: { xs: '0.875rem', sm: '1rem' }, py: 4 }}
              >
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            borderRadius: { xs: 0, sm: '12px' },
            m: { xs: 0, sm: 2 }
          }
        }}
      >
        <DialogTitle sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
          Create New Campaign
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            margin="normal"
            required
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: { xs: '0.875rem', sm: '1rem' }
              }
            }}
          />
          <TextField
            fullWidth
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            margin="normal"
            multiline
            rows={3}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontSize: { xs: '0.875rem', sm: '1rem' }
              }
            }}
          />
        </DialogContent>
        <DialogActions sx={{ p: { xs: 2, sm: 2.5 }, gap: 1 }}>
          <Button
            onClick={() => setOpen(false)}
            sx={{
              minHeight: { xs: '44px', sm: 'auto' },
              fontSize: { xs: '0.875rem', sm: '0.875rem' }
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            sx={{
              minHeight: { xs: '44px', sm: 'auto' },
              fontSize: { xs: '0.875rem', sm: '0.875rem' }
            }}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
