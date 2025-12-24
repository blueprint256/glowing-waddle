import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { campaignAPI, eventAPI } from '../services/api';
import { Campaign, Event, UserRole } from '../types';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [recentEvents, setRecentEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [campaignsRes, eventsRes] = await Promise.all([
        campaignAPI.getAll(),
        eventAPI.getAll()
      ]);
      setCampaigns(campaignsRes.data.campaigns || []);
      setRecentEvents((eventsRes.data.events || []).slice(0, 5));
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const canCreateCampaign = user?.role === UserRole.SYSTEM_ADMIN ||
    user?.role === UserRole.HYBRID ||
    user?.role === UserRole.MARKETER;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">Dashboard</Typography>
        {canCreateCampaign && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/campaigns?create=true')}
          >
            New Campaign
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Total Campaigns
              </Typography>
              <Typography variant="h3">{campaigns.length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Active Campaigns
              </Typography>
              <Typography variant="h3">
                {campaigns.filter((c) => c.status === 'active').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Recent Events
              </Typography>
              <Typography variant="h3">{recentEvents.length}</Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Recent Events
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Scheduled Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentEvents.map((event) => (
                    <TableRow
                      key={event._id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/events/${event._id}`)}
                    >
                      <TableCell>{event.name}</TableCell>
                      <TableCell>
                        <Chip label={event.type} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={event.status}
                          size="small"
                          color={
                            event.status === 'published'
                              ? 'success'
                              : event.status === 'approved'
                              ? 'info'
                              : 'default'
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {event.scheduledDate
                          ? new Date(event.scheduledDate).toLocaleDateString()
                          : 'Not scheduled'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {recentEvents.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center">
                        No recent events
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
