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
  Chip,
  useMediaQuery,
  useTheme
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { campaignAPI, taskAPI } from '../services/api';
import { Campaign, Task, UserRole } from '../types';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // <600px
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);

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
    }
  };

  const canCreateCampaign = user?.role === UserRole.SYSTEM_ADMIN ||
    user?.role === UserRole.HYBRID;

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
          Dashboard
        </Typography>
        {canCreateCampaign && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/campaigns?create=true')}
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

      <Grid container spacing={{ xs: 2, sm: 3 }}>
        <Grid item xs={12} sm={6} md={4}>
          <Card sx={{
            borderRadius: { xs: '8px', sm: '12px' },
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            transition: 'all 0.2s ease',
            '&:hover': {
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
              transform: 'translateY(-2px)'
            }
          }}>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography
                color="textSecondary"
                gutterBottom
                sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}
              >
                Total Campaigns
              </Typography>
              <Typography
                variant="h3"
                sx={{ fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' } }}
              >
                {campaigns.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Card sx={{
            borderRadius: { xs: '8px', sm: '12px' },
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            transition: 'all 0.2s ease',
            '&:hover': {
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
              transform: 'translateY(-2px)'
            }
          }}>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography
                color="textSecondary"
                gutterBottom
                sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}
              >
                Active Campaigns
              </Typography>
              <Typography
                variant="h3"
                sx={{ fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' } }}
              >
                {campaigns.filter((c) => c.status === 'active').length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Card sx={{
            borderRadius: { xs: '8px', sm: '12px' },
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            transition: 'all 0.2s ease',
            '&:hover': {
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
              transform: 'translateY(-2px)'
            }
          }}>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography
                color="textSecondary"
                gutterBottom
                sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}
              >
                Recent Tasks
              </Typography>
              <Typography
                variant="h3"
                sx={{ fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' } }}
              >
                {recentTasks.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{
            p: { xs: 2, sm: 2.5 },
            borderRadius: { xs: '8px', sm: '12px' },
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
          }}>
            <Typography
              variant="h6"
              gutterBottom
              sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}
            >
              Recent Tasks
            </Typography>
            <TableContainer sx={{
              overflow: { xs: 'auto', sm: 'hidden' },
              overflowX: { xs: 'auto', sm: 'hidden' }
            }}>
              <Table sx={{ minWidth: { xs: 500, sm: 'auto' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>Name</TableCell>
                    <TableCell sx={{ fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>Status</TableCell>
                    <TableCell sx={{ fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>Task Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentTasks.map((task) => (
                    <TableRow
                      key={task._id}
                      hover
                      sx={{
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: 'rgba(0, 0, 0, 0.04)'
                        }
                      }}
                      onClick={() => navigate(`/tasks/${task._id}`)}
                    >
                      <TableCell sx={{ fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>{task.name}</TableCell>
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
                          sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}>
                        {task.taskDate
                          ? new Date(task.taskDate).toLocaleDateString()
                          : 'Not scheduled'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {recentTasks.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        align="center"
                        sx={{
                          fontSize: { xs: '0.875rem', sm: '1rem' },
                          py: 4
                        }}
                      >
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
