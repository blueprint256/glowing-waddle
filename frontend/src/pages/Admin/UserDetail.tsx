import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Chip,
  Breadcrumbs,
  Link,
  CircularProgress,
  Card,
  CardContent,
  Divider
} from '@mui/material';
import { CheckCircle, Cancel } from '@mui/icons-material';
import { userAPI } from '../../services/api';
import { User, UserRole } from '../../types';

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      loadUser();
    }
  }, [id]);

  const loadUser = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await userAPI.getById(id!);
      if (res.data && res.data.user) {
        setUser(res.data.user);
      }
    } catch (error: any) {
      console.error('Error loading user:', error);
      setError(error.response?.data?.message || 'Failed to load user details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress sx={{ color: '#2563EB' }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (!user) return <Typography>User not found</Typography>;

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" onClick={() => navigate('/admin/users')} sx={{ cursor: 'pointer' }}>
          Users
        </Link>
        <Typography color="text.primary">{user.firstName} {user.lastName}</Typography>
      </Breadcrumbs>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4">{user.firstName} {user.lastName}</Typography>
          <Chip
            label={user.isActive ? 'Active' : 'Inactive'}
            color={user.isActive ? 'success' : 'default'}
          />
        </Box>

        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          {/* Basic Information */}
          <Grid item xs={12} md={6}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom color="primary">
                  Basic Information
                </Typography>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">Email</Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>{user.email}</Typography>

                  <Typography variant="subtitle2" color="text.secondary">Role</Typography>
                  <Chip label={user.role} size="small" color="primary" sx={{ mb: 2 }} />

                  <Typography variant="subtitle2" color="text.secondary">Login Method</Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {user.loginMethod || (user.authProvider === 'google' ? 'Google OAuth' : 'Email/Password')}
                  </Typography>

                  {user.createdAt && (
                    <>
                      <Typography variant="subtitle2" color="text.secondary">Joined</Typography>
                      <Typography variant="body1">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </Typography>
                    </>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Activity Summary */}
          <Grid item xs={12} md={6}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom color="primary">
                  Activity Summary
                </Typography>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">Campaigns Created</Typography>
                  <Typography variant="h4" sx={{ mb: 2 }}>{user.campaignCount || 0}</Typography>

                  <Typography variant="subtitle2" color="text.secondary">Integrations</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    {user.hasCanvaIntegration ? (
                      <Chip
                        icon={<CheckCircle />}
                        label="Canva Connected"
                        color="success"
                        size="small"
                      />
                    ) : (
                      <Chip
                        icon={<Cancel />}
                        label="Canva Not Connected"
                        color="default"
                        size="small"
                      />
                    )}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Company Information - Only show if user is Hybrid and has company info */}
          {user.role === UserRole.HYBRID && user.companyInfo && Object.keys(user.companyInfo).length > 0 && (
            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="h6" gutterBottom color="primary">
                    Company Information
                  </Typography>
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    {user.companyInfo.companyName && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">Company Name</Typography>
                        <Typography variant="body1">{user.companyInfo.companyName}</Typography>
                      </Grid>
                    )}
                    {user.companyInfo.sector && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">Sector</Typography>
                        <Typography variant="body1">{user.companyInfo.sector}</Typography>
                      </Grid>
                    )}
                    {user.companyInfo.about && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="text.secondary">About</Typography>
                        <Typography variant="body1">{user.companyInfo.about}</Typography>
                      </Grid>
                    )}
                    {user.companyInfo.productsServices && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="text.secondary">Products and Services</Typography>
                        <Typography variant="body1">{user.companyInfo.productsServices}</Typography>
                      </Grid>
                    )}
                    {user.companyInfo.usp && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="text.secondary">Unique Selling Position</Typography>
                        <Typography variant="body1">{user.companyInfo.usp}</Typography>
                      </Grid>
                    )}
                    {user.companyInfo.brandTone && (
                      <Grid item xs={12} sm={6}>
                        <Typography variant="subtitle2" color="text.secondary">Brand Tone</Typography>
                        <Typography variant="body1">{user.companyInfo.brandTone}</Typography>
                      </Grid>
                    )}
                    {user.companyInfo.audienceProfile && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="text.secondary">Audience Profile</Typography>
                        <Typography variant="body1">{user.companyInfo.audienceProfile}</Typography>
                      </Grid>
                    )}
                    {user.companyInfo.globalRules && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="text.secondary">Global Rules</Typography>
                        <Typography variant="body1">{user.companyInfo.globalRules}</Typography>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      </Paper>
    </Box>
  );
}
