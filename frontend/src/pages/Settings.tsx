import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Typography,
  Tabs,
  Tab,
  TextField,
  Button,
  Alert,
  Card,
  CardContent,
  CardActions,
  Chip,
  Divider,
  CircularProgress
} from '@mui/material';
import { CheckCircle, Cancel, Link as LinkIcon } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export default function Settings() {
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [canvaConnectedAt, setCanvaConnectedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    // Check for integration callback status
    const integration = searchParams.get('integration');
    const status = searchParams.get('status');

    if (integration === 'canva' && status) {
      if (status === 'success') {
        setMessage({ type: 'success', text: 'Canva integration connected successfully!' });
        setActiveTab(1); // Switch to Integrations tab
        fetchIntegrationStatus();
      } else {
        setMessage({ type: 'error', text: 'Failed to connect Canva integration. Please try again.' });
        setActiveTab(1);
      }
    } else {
      fetchIntegrationStatus();
    }
  }, [searchParams]);

  const fetchIntegrationStatus = async () => {
    try {
      setLoading(true);
      const response = await api.get('/integrations/status');
      if (response.data.success) {
        setCanvaConnected(response.data.integrations.canva.connected);
        if (response.data.integrations.canva.connectedAt) {
          setCanvaConnectedAt(new Date(response.data.integrations.canva.connectedAt));
        }
      }
    } catch (error) {
      console.error('Error fetching integration status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setMessage(null);
  };

  const handleConnectCanva = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${apiUrl}/integrations/canva`;
  };

  const handleDisconnectCanva = async () => {
    try {
      setDisconnecting(true);
      const response = await api.post('/integrations/canva/disconnect');
      if (response.data.success) {
        setCanvaConnected(false);
        setCanvaConnectedAt(null);
        setMessage({ type: 'success', text: 'Canva integration disconnected successfully.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to disconnect Canva integration. Please try again.' });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Manage your account settings and integrations
        </Typography>

        {message && (
          <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <Paper>
          <Tabs value={activeTab} onChange={handleTabChange} aria-label="settings tabs">
            <Tab label="Profile" />
            <Tab label="Integrations" />
            <Tab label="Account" />
          </Tabs>

          <TabPanel value={activeTab} index={0}>
            <Typography variant="h6" gutterBottom>
              Profile Information
            </Typography>
            <Box sx={{ mt: 3 }}>
              <TextField
                fullWidth
                label="First Name"
                value={user?.firstName || ''}
                margin="normal"
                disabled
              />
              <TextField
                fullWidth
                label="Last Name"
                value={user?.lastName || ''}
                margin="normal"
                disabled
              />
              <TextField
                fullWidth
                label="Email"
                value={user?.email || ''}
                margin="normal"
                disabled
              />
              <TextField
                fullWidth
                label="Role"
                value={user?.role || ''}
                margin="normal"
                disabled
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                Profile updates are currently not available. Contact your administrator to update your profile.
              </Typography>
            </Box>
          </TabPanel>

          <TabPanel value={activeTab} index={1}>
            <Typography variant="h6" gutterBottom>
              Integrations
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Connect external services to enhance your workflow
            </Typography>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                {/* Canva Integration */}
                <Card sx={{ mb: 2 }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="h6">Canva</Typography>
                        {canvaConnected ? (
                          <Chip
                            icon={<CheckCircle />}
                            label="Connected"
                            color="success"
                            size="small"
                          />
                        ) : (
                          <Chip
                            icon={<Cancel />}
                            label="Not Connected"
                            color="default"
                            size="small"
                          />
                        )}
                      </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      Connect your Canva account to import designs and images directly into your tasks.
                      This integration allows you to browse and use your Canva designs within the campaign
                      management platform.
                    </Typography>
                    {canvaConnected && canvaConnectedAt && (
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        Connected on {canvaConnectedAt.toLocaleDateString()} at{' '}
                        {canvaConnectedAt.toLocaleTimeString()}
                      </Typography>
                    )}
                  </CardContent>
                  <Divider />
                  <CardActions>
                    {canvaConnected ? (
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDisconnectCanva}
                        disabled={disconnecting}
                      >
                        {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LinkIcon />}
                        onClick={handleConnectCanva}
                      >
                        Connect Canva
                      </Button>
                    )}
                  </CardActions>
                </Card>

                {/* Future Integrations Placeholder */}
                <Card sx={{ opacity: 0.6 }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="h6">More Integrations</Typography>
                        <Chip label="Coming Soon" size="small" />
                      </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      Additional integrations with popular tools and services will be available soon.
                      Stay tuned for updates!
                    </Typography>
                  </CardContent>
                </Card>
              </>
            )}
          </TabPanel>

          <TabPanel value={activeTab} index={2}>
            <Typography variant="h6" gutterBottom>
              Account Settings
            </Typography>
            <Box sx={{ mt: 3 }}>
              <Typography variant="body2" color="text.secondary">
                Account management features are currently not available. Contact your system administrator
                for account-related changes.
              </Typography>
            </Box>
          </TabPanel>
        </Paper>
      </Box>
    </Container>
  );
}
