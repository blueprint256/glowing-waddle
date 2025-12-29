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
  CircularProgress,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip
} from '@mui/material';
import { CheckCircle, Cancel, Link as LinkIcon, Add, Edit, Delete, Info } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '../types';
import api, { promptAPI } from '../services/api';

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

const SECTORS = ['Tech', 'Retail', 'Healthcare', 'Finance', 'Education', 'Manufacturing', 'Other'];
const BRAND_TONES = ['Professional', 'Fun', 'Serious', 'Casual', 'Formal', 'Friendly'];

export default function Settings() {
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [canvaConnectedAt, setCanvaConnectedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [companyInfoLoading, setCompanyInfoLoading] = useState(false);
  const [companyInfoSaving, setCompanyInfoSaving] = useState(false);
  const [companyInfo, setCompanyInfo] = useState({
    companyName: '',
    sector: '',
    about: '',
    productsServices: '',
    usp: '',
    brandTone: '',
    audienceProfile: '',
    globalRules: ''
  });

  // Prompts state (System Admin only)
  const [prompts, setPrompts] = useState<any[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<any>(null);
  const [promptForm, setPromptForm] = useState({
    name: '',
    details: ''
  });
  const [promptSaving, setPromptSaving] = useState(false);

  useEffect(() => {
    // Check for integration callback status
    const integration = searchParams.get('integration');
    const status = searchParams.get('status');

    if (integration === 'canva' && status) {
      if (status === 'success') {
        setMessage({ type: 'success', text: 'Canva integration connected successfully!' });
        setActiveTab(2); // Switch to Integrations tab
        fetchIntegrationStatus();
      } else {
        setMessage({ type: 'error', text: 'Failed to connect Canva integration. Please try again.' });
        setActiveTab(2);
      }
    } else {
      fetchIntegrationStatus();
    }

    // Fetch company info if user is Hybrid
    if (user?.role === UserRole.HYBRID) {
      fetchCompanyInfo();
    }

    // Fetch prompts if user is System Admin
    if (user?.role === UserRole.SYSTEM_ADMIN) {
      fetchPrompts();
    }
  }, [searchParams, user]);

  const fetchCompanyInfo = async () => {
    try {
      setCompanyInfoLoading(true);
      const response = await api.get('/users/me/company-info');
      if (response.data.success && response.data.companyInfo) {
        setCompanyInfo({
          companyName: response.data.companyInfo.companyName || '',
          sector: response.data.companyInfo.sector || '',
          about: response.data.companyInfo.about || '',
          productsServices: response.data.companyInfo.productsServices || '',
          usp: response.data.companyInfo.usp || '',
          brandTone: response.data.companyInfo.brandTone || '',
          audienceProfile: response.data.companyInfo.audienceProfile || '',
          globalRules: response.data.companyInfo.globalRules || ''
        });
      }
    } catch (error) {
      console.error('Error fetching company info:', error);
    } finally {
      setCompanyInfoLoading(false);
    }
  };

  const saveCompanyInfo = async () => {
    try {
      setCompanyInfoSaving(true);
      const response = await api.patch('/users/me/company-info', companyInfo);
      if (response.data.success) {
        setMessage({ type: 'success', text: 'Company information saved successfully!' });
      }
    } catch (error) {
      console.error('Error saving company info:', error);
      setMessage({ type: 'error', text: 'Failed to save company information. Please try again.' });
    } finally {
      setCompanyInfoSaving(false);
    }
  };

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

  // Prompt management functions
  const fetchPrompts = async () => {
    try {
      setPromptsLoading(true);
      const response = await promptAPI.getAll();
      if (response.data.success) {
        setPrompts(response.data.prompts);
      }
    } catch (error) {
      console.error('Error fetching prompts:', error);
      setMessage({ type: 'error', text: 'Failed to load prompts. Please try again.' });
    } finally {
      setPromptsLoading(false);
    }
  };

  const handleCreatePrompt = () => {
    setEditingPrompt(null);
    setPromptForm({ name: '', details: '' });
    setPromptModalOpen(true);
  };

  const handleEditPrompt = (prompt: any) => {
    setEditingPrompt(prompt);
    setPromptForm({ name: prompt.name, details: prompt.details });
    setPromptModalOpen(true);
  };

  const handleClosePromptModal = () => {
    setPromptModalOpen(false);
    setEditingPrompt(null);
    setPromptForm({ name: '', details: '' });
  };

  const handleSavePrompt = async () => {
    try {
      setPromptSaving(true);

      if (!promptForm.name.trim() || !promptForm.details.trim()) {
        setMessage({ type: 'error', text: 'Name and details are required.' });
        return;
      }

      if (editingPrompt) {
        // Update existing prompt
        const response = await promptAPI.update(editingPrompt._id, promptForm);
        if (response.data.success) {
          setMessage({ type: 'success', text: 'Prompt updated successfully!' });
          fetchPrompts();
          handleClosePromptModal();
        }
      } else {
        // Create new prompt
        const response = await promptAPI.create(promptForm);
        if (response.data.success) {
          setMessage({ type: 'success', text: 'Prompt created successfully!' });
          fetchPrompts();
          handleClosePromptModal();
        }
      }
    } catch (error: any) {
      console.error('Error saving prompt:', error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to save prompt. Please try again.'
      });
    } finally {
      setPromptSaving(false);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    if (!window.confirm('Are you sure you want to delete this prompt? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await promptAPI.delete(promptId);
      if (response.data.success) {
        setMessage({ type: 'success', text: 'Prompt deleted successfully!' });
        fetchPrompts();
      }
    } catch (error) {
      console.error('Error deleting prompt:', error);
      setMessage({ type: 'error', text: 'Failed to delete prompt. Please try again.' });
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
            {user?.role === UserRole.HYBRID && <Tab label="Company Information" />}
            <Tab label="Integrations" />
            {user?.role === UserRole.SYSTEM_ADMIN && <Tab label="Prompts" />}
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

          {user?.role === UserRole.HYBRID && (
            <TabPanel value={activeTab} index={1}>
              <Typography variant="h6" gutterBottom>
                Company Information
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Provide your company details to personalize your campaigns and content
              </Typography>

              {companyInfoLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <Box sx={{ mt: 3 }}>
                  <TextField
                    fullWidth
                    label="Company Name"
                    value={companyInfo.companyName}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, companyName: e.target.value })}
                    margin="normal"
                    placeholder="e.g., Acme Corporation"
                  />
                  <TextField
                    fullWidth
                    select
                    label="Sector"
                    value={companyInfo.sector}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, sector: e.target.value })}
                    margin="normal"
                    placeholder="Select your industry"
                  >
                    {SECTORS.map((sector) => (
                      <MenuItem key={sector} value={sector}>
                        {sector}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    fullWidth
                    label="About"
                    value={companyInfo.about}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, about: e.target.value })}
                    margin="normal"
                    multiline
                    rows={2}
                    placeholder="Brief description of your company"
                  />
                  <TextField
                    fullWidth
                    label="Products and Services"
                    value={companyInfo.productsServices}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, productsServices: e.target.value })}
                    margin="normal"
                    multiline
                    rows={3}
                    placeholder="Describe your products and services"
                  />
                  <TextField
                    fullWidth
                    label="Unique Selling Position (USP)"
                    value={companyInfo.usp}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, usp: e.target.value })}
                    margin="normal"
                    multiline
                    rows={2}
                    placeholder="What makes your company unique?"
                  />
                  <TextField
                    fullWidth
                    select
                    label="Brand Tone"
                    value={companyInfo.brandTone}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, brandTone: e.target.value })}
                    margin="normal"
                    placeholder="Select your brand voice"
                  >
                    {BRAND_TONES.map((tone) => (
                      <MenuItem key={tone} value={tone}>
                        {tone}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    fullWidth
                    label="Audience Profile"
                    value={companyInfo.audienceProfile}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, audienceProfile: e.target.value })}
                    margin="normal"
                    multiline
                    rows={3}
                    placeholder="Describe your target audience"
                  />
                  <TextField
                    fullWidth
                    label="Global Rules"
                    value={companyInfo.globalRules}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, globalRules: e.target.value })}
                    margin="normal"
                    multiline
                    rows={3}
                    placeholder="Content guidelines, dos and don'ts"
                  />
                  <Button
                    variant="contained"
                    onClick={saveCompanyInfo}
                    disabled={companyInfoSaving}
                    sx={{ mt: 2 }}
                  >
                    {companyInfoSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </Box>
              )}
            </TabPanel>
          )}

          <TabPanel value={activeTab} index={user?.role === UserRole.HYBRID ? 2 : 1}>
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

          {user?.role === UserRole.SYSTEM_ADMIN && (
            <TabPanel value={activeTab} index={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Prompt Management
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Manage LLM prompts for dynamic content generation
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleCreatePrompt}
                >
                  Create Prompt
                </Button>
              </Box>

              {promptsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : prompts.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body1" color="text.secondary">
                    No prompts created yet. Create your first prompt to get started.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Details Preview</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {prompts.map((prompt) => (
                        <TableRow key={prompt._id}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="500">
                              {prompt.name}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                maxWidth: 400,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {prompt.details}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Edit prompt">
                              <IconButton
                                size="small"
                                onClick={() => handleEditPrompt(prompt)}
                                color="primary"
                              >
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete prompt">
                              <IconButton
                                size="small"
                                onClick={() => handleDeletePrompt(prompt._id)}
                                color="error"
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              <Box sx={{ mt: 2 }}>
                <Alert severity="info" icon={<Info />}>
                  <Typography variant="body2">
                    <strong>Tip:</strong> Use placeholders like {'{companyInfo}'}, {'{campaignDetails}'}, {'{companyName}'}, etc. in your prompts.
                    These will be automatically replaced with actual data when generating content.
                  </Typography>
                </Alert>
              </Box>
            </TabPanel>
          )}

          <TabPanel value={activeTab} index={user?.role === UserRole.SYSTEM_ADMIN ? 3 : (user?.role === UserRole.HYBRID ? 3 : 2)}>
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

        {/* Prompt Create/Edit Modal */}
        <Dialog open={promptModalOpen} onClose={handleClosePromptModal} maxWidth="md" fullWidth>
          <DialogTitle>
            {editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="Prompt Name"
                value={promptForm.name}
                onChange={(e) => setPromptForm({ ...promptForm, name: e.target.value })}
                margin="normal"
                placeholder="e.g., Generate Campaign Tasks"
                helperText="Unique identifier for this prompt"
                required
              />
              <TextField
                fullWidth
                label="Prompt Details"
                value={promptForm.details}
                onChange={(e) => setPromptForm({ ...promptForm, details: e.target.value })}
                margin="normal"
                multiline
                rows={10}
                placeholder="Enter your prompt template here. Use placeholders like {companyInfo}, {campaignDetails}, {companyName}, etc."
                helperText="The prompt text with placeholders that will be replaced with actual data"
                required
              />
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>Available placeholders:</strong><br />
                  {'{companyInfo}'} - Full company information<br />
                  {'{companyName}'}, {'{sector}'}, {'{brandTone}'} - Individual company fields<br />
                  {'{campaignDetails}'} - Full campaign information<br />
                  {'{campaignName}'}, {'{coreMessages}'}, {'{hashtags}'} - Individual campaign fields
                </Typography>
              </Alert>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClosePromptModal}>Cancel</Button>
            <Button
              onClick={handleSavePrompt}
              variant="contained"
              disabled={promptSaving}
            >
              {promptSaving ? 'Saving...' : (editingPrompt ? 'Update' : 'Create')}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Container>
  );
}
