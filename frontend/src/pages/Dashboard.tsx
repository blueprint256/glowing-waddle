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
import { campaignAPI, taskAPI } from '../services/api';
import { Campaign, Task, UserRole } from '../types';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [campaignsRes, tasksRes] = await Promise.all([
        campaignAPI.getAll(),
        taskAPI.getAll()
      ]);
      setCampaigns(campaignsRes.data.campaigns || []);
      setRecentTasks((tasksRes.data.tasks || []).slice(0, 5));
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const canCreateCampaign = user?.role === UserRole.SYSTEM_ADMIN ||
    user?.role === UserRole.HYBRID;

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
                Recent Tasks
              </Typography>
              <Typography variant="h3">{recentTasks.length}</Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Recent Tasks
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Publish Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentTasks.map((task) => (
                    <TableRow
                      key={task._id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/tasks/${task._id}`)}
                    >
                      <TableCell>{task.name}</TableCell>
                      <TableCell>
                        <Chip label={task.type} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={task.status}
                          size="small"
                          color={
                            task.status === 'Completed'
                              ? 'success'
                              : task.status === 'In Progress'
                              ? 'warning'
                              : 'error'
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {task.publishDate
                          ? new Date(task.publishDate).toLocaleDateString()
                          : 'Not scheduled'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {recentTasks.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} align="center">
                        No recent tasks
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
