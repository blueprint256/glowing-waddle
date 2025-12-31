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
import {
  CheckCircle,
  Cancel,
  Link as LinkIcon,
  Add,
  Edit,
  Delete,
  Info,
  Visibility,
  VisibilityOff,
  CheckCircleOutline,
  WarningAmber
} from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '../types';
import api, { promptAPI, commandMappingAPI } from '../services/api';

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

// LLM Provider models (for text generation)
const LLM_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  grok: ['grok-beta', 'grok-2'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash']
};

// Image LLM Provider models (for image generation)
// RESTRICTED TO GPT-IMAGE-1.5 ONLY as of late 2025
const IMAGE_LLM_MODELS: Record<string, string[]> = {
  openai: ['gpt-image-1.5']
};

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
    globalRules: '',
    brandGuidelines: '',
    primaryLogoUrl: '',
    secondaryLogoUrl: '',
    tertiaryLogoUrl: ''
  });
  const [uploadingLogo, setUploadingLogo] = useState<{[key: string]: boolean}>({});

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

  // LLM Provider states (System Admin only)
  const [openAIConfigured, setOpenAIConfigured] = useState(false);
  const [openAIApiKey, setOpenAIApiKey] = useState('');
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [grokConfigured, setGrokConfigured] = useState(false);
  const [grokApiKey, setGrokApiKey] = useState('');
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState<{[key: string]: boolean}>({});
  const [savingApiKey, setSavingApiKey] = useState<{[key: string]: boolean}>({});
  const [testingConnection, setTestingConnection] = useState<{[key: string]: boolean}>({});

  // Default LLM configuration state (System Admin only)
  const [defaultProvider, setDefaultProvider] = useState('openai');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [savingDefaultConfig, setSavingDefaultConfig] = useState(false);

  // Default Image LLM configuration state (System Admin only)
  // RESTRICTED TO GPT-IMAGE-1.5 ONLY
  const [defaultImageProvider, setDefaultImageProvider] = useState('openai');
  const [defaultImageModel, setDefaultImageModel] = useState('gpt-image-1.5');
  const [savingDefaultImageConfig, setSavingDefaultImageConfig] = useState(false);

  // Stability AI state (System Admin only)
  const [stabilityConfigured, setStabilityConfigured] = useState(false);
  const [stabilityApiKey, setStabilityApiKey] = useState('');

  // Command Mappings state (System Admin only)
  const [commandMappings, setCommandMappings] = useState<any[]>([]);
  const [commandMappingsLoading, setCommandMappingsLoading] = useState(false);
  const [commandMappingModalOpen, setCommandMappingModalOpen] = useState(false);
  const [editingCommandMapping, setEditingCommandMapping] = useState<any>(null);
  const [commandMappingForm, setCommandMappingForm] = useState({
    command: '',
    promptId: ''
  });
  const [commandMappingSaving, setCommandMappingSaving] = useState(false);

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

    // Fetch prompts and command mappings if user is System Admin
    if (user?.role === UserRole.SYSTEM_ADMIN) {
      fetchPrompts();
      fetchCommandMappings();
      fetchDefaultLLMConfig();
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
          globalRules: response.data.companyInfo.globalRules || '',
          brandGuidelines: response.data.companyInfo.brandGuidelines || '',
          primaryLogoUrl: response.data.companyInfo.primaryLogoUrl || '',
          secondaryLogoUrl: response.data.companyInfo.secondaryLogoUrl || '',
          tertiaryLogoUrl: response.data.companyInfo.tertiaryLogoUrl || ''
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

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>, logoType: 'primary' | 'secondary' | 'tertiary') => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please upload an image file' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Logo file size must be less than 5MB' });
      return;
    }

    try {
      setUploadingLogo({ ...uploadingLogo, [logoType]: true });
      const formData = new FormData();
      formData.append('logo', file);
      formData.append('logoType', logoType);

      const response = await api.post('/users/me/upload-logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.success) {
        const logoUrlField = `${logoType}LogoUrl` as 'primaryLogoUrl' | 'secondaryLogoUrl' | 'tertiaryLogoUrl';
        setCompanyInfo({ ...companyInfo, [logoUrlField]: response.data.logoUrl });
        setMessage({ type: 'success', text: `${logoType.charAt(0).toUpperCase() + logoType.slice(1)} logo uploaded successfully!` });
      }
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to upload logo. Please try again.' });
    } finally {
      setUploadingLogo({ ...uploadingLogo, [logoType]: false });
      // Reset file input
      event.target.value = '';
    }
  };

  const handleRemoveLogo = async (logoType: 'primary' | 'secondary' | 'tertiary') => {
    try {
      const logoUrlField = `${logoType}LogoUrl` as 'primaryLogoUrl' | 'secondaryLogoUrl' | 'tertiaryLogoUrl';
      const updatedCompanyInfo = { ...companyInfo, [logoUrlField]: '' };
      setCompanyInfo(updatedCompanyInfo);

      // Save to backend
      await api.patch('/users/me/company-info', updatedCompanyInfo);
      setMessage({ type: 'success', text: `${logoType.charAt(0).toUpperCase() + logoType.slice(1)} logo removed successfully!` });
    } catch (error: any) {
      console.error('Error removing logo:', error);
      setMessage({ type: 'error', text: 'Failed to remove logo. Please try again.' });
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

        // Fetch LLM provider statuses for System Admins
        if (user?.role === UserRole.SYSTEM_ADMIN) {
          if (response.data.integrations.openai) {
            setOpenAIConfigured(response.data.integrations.openai.configured);
          }
          if (response.data.integrations.anthropic) {
            setAnthropicConfigured(response.data.integrations.anthropic.configured);
          }
          if (response.data.integrations.grok) {
            setGrokConfigured(response.data.integrations.grok.configured);
          }
          if (response.data.integrations.gemini) {
            setGeminiConfigured(response.data.integrations.gemini.configured);
          }
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
        // Also refresh command mappings in case deleted prompt was used in a mapping
        fetchCommandMappings();
      }
    } catch (error) {
      console.error('Error deleting prompt:', error);
      setMessage({ type: 'error', text: 'Failed to delete prompt. Please try again.' });
    }
  };

  // Command Mapping management functions
  const fetchCommandMappings = async () => {
    try {
      setCommandMappingsLoading(true);
      const response = await commandMappingAPI.getAll();
      if (response.data.success) {
        setCommandMappings(response.data.mappings);
      }
    } catch (error) {
      console.error('Error fetching command mappings:', error);
      setMessage({ type: 'error', text: 'Failed to load command mappings. Please try again.' });
    } finally {
      setCommandMappingsLoading(false);
    }
  };

  const handleCreateCommandMapping = () => {
    setEditingCommandMapping(null);
    setCommandMappingForm({ command: '', promptId: '' });
    setCommandMappingModalOpen(true);
  };

  const handleEditCommandMapping = (mapping: any) => {
    setEditingCommandMapping(mapping);
    setCommandMappingForm({
      command: mapping.command,
      promptId: mapping.promptId._id
    });
    setCommandMappingModalOpen(true);
  };

  const handleCloseCommandMappingModal = () => {
    setCommandMappingModalOpen(false);
    setEditingCommandMapping(null);
    setCommandMappingForm({ command: '', promptId: '' });
  };

  const handleSaveCommandMapping = async () => {
    try {
      setCommandMappingSaving(true);

      if (!commandMappingForm.command.trim() || !commandMappingForm.promptId) {
        setMessage({ type: 'error', text: 'Command and prompt are required.' });
        return;
      }

      if (editingCommandMapping) {
        // Update existing mapping
        const response = await commandMappingAPI.update(editingCommandMapping._id, commandMappingForm);
        if (response.data.success) {
          setMessage({ type: 'success', text: 'Command mapping updated successfully!' });
          fetchCommandMappings();
          handleCloseCommandMappingModal();
        }
      } else {
        // Create new mapping
        const response = await commandMappingAPI.create(commandMappingForm);
        if (response.data.success) {
          setMessage({ type: 'success', text: 'Command mapping created successfully!' });
          fetchCommandMappings();
          handleCloseCommandMappingModal();
        }
      }
    } catch (error: any) {
      console.error('Error saving command mapping:', error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to save command mapping. Please try again.'
      });
    } finally {
      setCommandMappingSaving(false);
    }
  };

  const handleDeleteCommandMapping = async (mappingId: string) => {
    if (!window.confirm('Are you sure you want to delete this command mapping? Users will no longer be able to use this command.')) {
      return;
    }

    try {
      const response = await commandMappingAPI.delete(mappingId);
      if (response.data.success) {
        setMessage({ type: 'success', text: 'Command mapping deleted successfully!' });
        fetchCommandMappings();
      }
    } catch (error) {
      console.error('Error deleting command mapping:', error);
      setMessage({ type: 'error', text: 'Failed to delete command mapping. Please try again.' });
    }
  };

  // Fetch default LLM configuration
  const fetchDefaultLLMConfig = async () => {
    try {
      const response = await api.get('/integrations/llm/default');
      if (response.data.success) {
        setDefaultProvider(response.data.defaultProvider || 'openai');
        setDefaultModel(response.data.defaultModel || 'gpt-4o-mini');
      }
    } catch (error) {
      console.error('Error fetching default LLM config:', error);
    }
  };

  // Generic LLM provider configuration functions
  const handleSaveProviderKey = async (
    provider: 'openai' | 'anthropic' | 'grok' | 'gemini',
    apiKey: string,
    setConfigured: (value: boolean) => void,
    setApiKey: (value: string) => void
  ) => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'Please enter an API key.' });
      return;
    }

    try {
      setSavingApiKey(prev => ({ ...prev, [provider]: true }));
      const response = await api.patch(`/integrations/${provider}/key`, { apiKey });
      if (response.data.success) {
        setMessage({ type: 'success', text: `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key saved successfully!` });
        setConfigured(true);
        setApiKey(''); // Clear input after saving
        setShowApiKey(prev => ({ ...prev, [provider]: false }));
        fetchIntegrationStatus(); // Refresh status
      }
    } catch (error: any) {
      console.error(`Error saving ${provider} key:`, error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to save API key. Please try again.'
      });
    } finally {
      setSavingApiKey(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleTestProviderConnection = async (provider: 'openai' | 'anthropic' | 'grok' | 'gemini') => {
    try {
      setTestingConnection(prev => ({ ...prev, [provider]: true }));
      const response = await api.post(`/integrations/${provider}/test`);
      if (response.data.success) {
        const successMessage = response.data.modelCount
          ? `${provider.charAt(0).toUpperCase() + provider.slice(1)} connection successful! ${response.data.modelCount} models available.`
          : `${provider.charAt(0).toUpperCase() + provider.slice(1)} connection successful!`;
        setMessage({ type: 'success', text: successMessage });
      }
    } catch (error: any) {
      console.error(`Error testing ${provider} connection:`, error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Connection test failed. Please check your API key.'
      });
    } finally {
      setTestingConnection(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleRemoveProviderKey = async (
    provider: 'openai' | 'anthropic' | 'grok' | 'gemini',
    setConfigured: (value: boolean) => void,
    setApiKey: (value: string) => void
  ) => {
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
    if (!window.confirm(`Are you sure you want to remove the ${providerName} API key? AI features using this provider will be unavailable.`)) {
      return;
    }

    try {
      setSavingApiKey(prev => ({ ...prev, [provider]: true }));
      const response = await api.delete(`/integrations/${provider}/key`);
      if (response.data.success) {
        setMessage({ type: 'success', text: `${providerName} API key removed successfully.` });
        setConfigured(false);
        setApiKey('');
        fetchIntegrationStatus(); // Refresh status
      }
    } catch (error: any) {
      console.error(`Error removing ${provider} key:`, error);
      setMessage({ type: 'error', text: 'Failed to remove API key. Please try again.' });
    } finally {
      setSavingApiKey(prev => ({ ...prev, [provider]: false }));
    }
  };

  // Save default LLM configuration
  const handleSaveDefaultLLMConfig = async () => {
    try {
      setSavingDefaultConfig(true);
      const response = await api.patch('/integrations/llm/default', {
        provider: defaultProvider,
        model: defaultModel
      });
      if (response.data.success) {
        setMessage({ type: 'success', text: 'Default LLM configuration saved successfully!' });
      }
    } catch (error: any) {
      console.error('Error saving default LLM config:', error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to save default LLM configuration. Please try again.'
      });
    } finally {
      setSavingDefaultConfig(false);
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
            {user?.role === UserRole.SYSTEM_ADMIN && <Tab label="LLM Settings" />}
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

                  <Divider sx={{ my: 3 }} />

                  <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                    Brand Assets
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Add brand guidelines and logo URLs for AI-powered content generation
                  </Typography>

                  <TextField
                    fullWidth
                    label="Brand Guidelines"
                    value={companyInfo.brandGuidelines}
                    onChange={(e) => setCompanyInfo({ ...companyInfo, brandGuidelines: e.target.value })}
                    margin="normal"
                    multiline
                    rows={6}
                    placeholder="Detailed visual and writing style guidelines for your brand..."
                    helperText="Available as {brandGuidelines} placeholder in prompts"
                  />

                  {/* Primary Logo Upload */}
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Primary Logo
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      Available as {'{primaryLogo}'} placeholder in prompts
                    </Typography>
                    {companyInfo.primaryLogoUrl ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          component="img"
                          src={companyInfo.primaryLogoUrl}
                          alt="Primary Logo"
                          sx={{
                            maxWidth: 200,
                            maxHeight: 100,
                            objectFit: 'contain',
                            border: '1px solid #e0e0e0',
                            borderRadius: 1,
                            p: 1
                          }}
                        />
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => handleRemoveLogo('primary')}
                        >
                          Remove
                        </Button>
                      </Box>
                    ) : (
                      <Button
                        variant="outlined"
                        component="label"
                        disabled={uploadingLogo.primary}
                      >
                        {uploadingLogo.primary ? 'Uploading...' : 'Upload Primary Logo'}
                        <input
                          type="file"
                          hidden
                          accept="image/*"
                          onChange={(e) => handleLogoUpload(e, 'primary')}
                        />
                      </Button>
                    )}
                  </Box>

                  {/* Secondary Logo Upload */}
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Secondary Logo
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      Alternate or monochrome version - available as {'{secondaryLogo}'}
                    </Typography>
                    {companyInfo.secondaryLogoUrl ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          component="img"
                          src={companyInfo.secondaryLogoUrl}
                          alt="Secondary Logo"
                          sx={{
                            maxWidth: 200,
                            maxHeight: 100,
                            objectFit: 'contain',
                            border: '1px solid #e0e0e0',
                            borderRadius: 1,
                            p: 1
                          }}
                        />
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => handleRemoveLogo('secondary')}
                        >
                          Remove
                        </Button>
                      </Box>
                    ) : (
                      <Button
                        variant="outlined"
                        component="label"
                        disabled={uploadingLogo.secondary}
                      >
                        {uploadingLogo.secondary ? 'Uploading...' : 'Upload Secondary Logo'}
                        <input
                          type="file"
                          hidden
                          accept="image/*"
                          onChange={(e) => handleLogoUpload(e, 'secondary')}
                        />
                      </Button>
                    )}
                  </Box>

                  {/* Tertiary Logo Upload */}
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Tertiary Logo
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      Icon or favicon version - available as {'{tertiaryLogo}'}
                    </Typography>
                    {companyInfo.tertiaryLogoUrl ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          component="img"
                          src={companyInfo.tertiaryLogoUrl}
                          alt="Tertiary Logo"
                          sx={{
                            maxWidth: 200,
                            maxHeight: 100,
                            objectFit: 'contain',
                            border: '1px solid #e0e0e0',
                            borderRadius: 1,
                            p: 1
                          }}
                        />
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          onClick={() => handleRemoveLogo('tertiary')}
                        >
                          Remove
                        </Button>
                      </Box>
                    ) : (
                      <Button
                        variant="outlined"
                        component="label"
                        disabled={uploadingLogo.tertiary}
                      >
                        {uploadingLogo.tertiary ? 'Uploading...' : 'Upload Tertiary Logo'}
                        <input
                          type="file"
                          hidden
                          accept="image/*"
                          onChange={(e) => handleLogoUpload(e, 'tertiary')}
                        />
                      </Button>
                    )}
                  </Box>

                  <Button
                    variant="contained"
                    onClick={saveCompanyInfo}
                    disabled={companyInfoSaving}
                    sx={{ mt: 3 }}
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

                {/* OpenAI Integration (System Admin only) */}
                {user?.role === UserRole.SYSTEM_ADMIN && (
                  <Card sx={{ mb: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Typography variant="h6">OpenAI (ChatGPT)</Typography>
                          {openAIConfigured ? (
                            <Chip
                              icon={<CheckCircleOutline />}
                              label="Configured"
                              color="success"
                              size="small"
                            />
                          ) : (
                            <Chip
                              icon={<WarningAmber />}
                              label="Not Configured"
                              color="warning"
                              size="small"
                            />
                          )}
                        </Box>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Configure your OpenAI API key to enable AI-powered content generation features.
                        Your key is encrypted and stored securely.
                      </Typography>

                      <TextField
                        fullWidth
                        type={showApiKey ? 'text' : 'password'}
                        label="OpenAI API Key"
                        value={openAIApiKey}
                        onChange={(e) => setOpenAIApiKey(e.target.value)}
                        placeholder={openAIConfigured ? '••••••••••••••••' : 'sk-...'}
                        helperText={openAIConfigured ? 'Enter a new key to update' : 'Enter your OpenAI API key (starts with sk-)'}
                        InputProps={{
                          endAdornment: (
                            <IconButton
                              onClick={() => setShowApiKey(!showApiKey)}
                              edge="end"
                              size="small"
                            >
                              {showApiKey ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          )
                        }}
                      />
                    </CardContent>
                    <Divider />
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleSaveProviderKey('openai', openAIApiKey, setOpenAIConfigured, setOpenAIApiKey)}
                        disabled={savingApiKey.openai || !openAIApiKey.trim()}
                      >
                        {savingApiKey.openai ? 'Saving...' : 'Save Key'}
                      </Button>
                      {openAIConfigured && (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleTestProviderConnection('openai')}
                            disabled={testingConnection.openai}
                          >
                            {testingConnection.openai ? 'Testing...' : 'Test Connection'}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => handleRemoveProviderKey('openai', setOpenAIConfigured, setOpenAIApiKey)}
                            disabled={savingApiKey.openai}
                          >
                            Remove Key
                          </Button>
                        </>
                      )}
                    </CardActions>
                  </Card>
                )}

                {/* Anthropic Integration (System Admin only) */}
                {user?.role === UserRole.SYSTEM_ADMIN && (
                  <Card sx={{ mb: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Typography variant="h6">Anthropic (Claude)</Typography>
                          {anthropicConfigured ? (
                            <Chip icon={<CheckCircleOutline />} label="Configured" color="success" size="small" />
                          ) : (
                            <Chip icon={<WarningAmber />} label="Not Configured" color="warning" size="small" />
                          )}
                        </Box>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Configure your Anthropic API key to use Claude models. Supports Claude 3.5 Sonnet, Opus, and Haiku.
                      </Typography>
                      <TextField
                        fullWidth
                        type={showApiKey.anthropic ? 'text' : 'password'}
                        label="Anthropic API Key"
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        placeholder={anthropicConfigured ? '••••••••••••••••' : 'sk-ant-...'}
                        helperText={anthropicConfigured ? 'Enter a new key to update' : 'Enter your Anthropic API key (starts with sk-ant-)'}
                        InputProps={{
                          endAdornment: (
                            <IconButton
                              onClick={() => setShowApiKey(prev => ({ ...prev, anthropic: !prev.anthropic }))}
                              edge="end"
                              size="small"
                            >
                              {showApiKey.anthropic ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          )
                        }}
                      />
                    </CardContent>
                    <Divider />
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleSaveProviderKey('anthropic', anthropicApiKey, setAnthropicConfigured, setAnthropicApiKey)}
                        disabled={savingApiKey.anthropic || !anthropicApiKey.trim()}
                      >
                        {savingApiKey.anthropic ? 'Saving...' : 'Save Key'}
                      </Button>
                      {anthropicConfigured && (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleTestProviderConnection('anthropic')}
                            disabled={testingConnection.anthropic}
                          >
                            {testingConnection.anthropic ? 'Testing...' : 'Test Connection'}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => handleRemoveProviderKey('anthropic', setAnthropicConfigured, setAnthropicApiKey)}
                            disabled={savingApiKey.anthropic}
                          >
                            Remove Key
                          </Button>
                        </>
                      )}
                    </CardActions>
                  </Card>
                )}

                {/* Grok Integration (System Admin only) */}
                {user?.role === UserRole.SYSTEM_ADMIN && (
                  <Card sx={{ mb: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Typography variant="h6">Grok (xAI)</Typography>
                          {grokConfigured ? (
                            <Chip icon={<CheckCircleOutline />} label="Configured" color="success" size="small" />
                          ) : (
                            <Chip icon={<WarningAmber />} label="Not Configured" color="warning" size="small" />
                          )}
                        </Box>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Configure your Grok API key to use xAI's models. Supports Grok-beta and Grok-2.
                      </Typography>
                      <TextField
                        fullWidth
                        type={showApiKey.grok ? 'text' : 'password'}
                        label="Grok API Key"
                        value={grokApiKey}
                        onChange={(e) => setGrokApiKey(e.target.value)}
                        placeholder={grokConfigured ? '••••••••••••••••' : 'xai-...'}
                        helperText={grokConfigured ? 'Enter a new key to update' : 'Enter your Grok API key (starts with xai-)'}
                        InputProps={{
                          endAdornment: (
                            <IconButton
                              onClick={() => setShowApiKey(prev => ({ ...prev, grok: !prev.grok }))}
                              edge="end"
                              size="small"
                            >
                              {showApiKey.grok ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          )
                        }}
                      />
                    </CardContent>
                    <Divider />
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleSaveProviderKey('grok', grokApiKey, setGrokConfigured, setGrokApiKey)}
                        disabled={savingApiKey.grok || !grokApiKey.trim()}
                      >
                        {savingApiKey.grok ? 'Saving...' : 'Save Key'}
                      </Button>
                      {grokConfigured && (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleTestProviderConnection('grok')}
                            disabled={testingConnection.grok}
                          >
                            {testingConnection.grok ? 'Testing...' : 'Test Connection'}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => handleRemoveProviderKey('grok', setGrokConfigured, setGrokApiKey)}
                            disabled={savingApiKey.grok}
                          >
                            Remove Key
                          </Button>
                        </>
                      )}
                    </CardActions>
                  </Card>
                )}

                {/* Gemini Integration (System Admin only) */}
                {user?.role === UserRole.SYSTEM_ADMIN && (
                  <Card sx={{ mb: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Typography variant="h6">Google Gemini</Typography>
                          {geminiConfigured ? (
                            <Chip icon={<CheckCircleOutline />} label="Configured" color="success" size="small" />
                          ) : (
                            <Chip icon={<WarningAmber />} label="Not Configured" color="warning" size="small" />
                          )}
                        </Box>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Configure your Google Gemini API key. Supports Gemini 1.5 Pro and Flash models.
                      </Typography>
                      <TextField
                        fullWidth
                        type={showApiKey.gemini ? 'text' : 'password'}
                        label="Gemini API Key"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder={geminiConfigured ? '••••••••••••••••' : 'AIza...'}
                        helperText={geminiConfigured ? 'Enter a new key to update' : 'Enter your Gemini API key (starts with AIza)'}
                        InputProps={{
                          endAdornment: (
                            <IconButton
                              onClick={() => setShowApiKey(prev => ({ ...prev, gemini: !prev.gemini }))}
                              edge="end"
                              size="small"
                            >
                              {showApiKey.gemini ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          )
                        }}
                      />
                    </CardContent>
                    <Divider />
                    <CardActions>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleSaveProviderKey('gemini', geminiApiKey, setGeminiConfigured, setGeminiApiKey)}
                        disabled={savingApiKey.gemini || !geminiApiKey.trim()}
                      >
                        {savingApiKey.gemini ? 'Saving...' : 'Save Key'}
                      </Button>
                      {geminiConfigured && (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleTestProviderConnection('gemini')}
                            disabled={testingConnection.gemini}
                          >
                            {testingConnection.gemini ? 'Testing...' : 'Test Connection'}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => handleRemoveProviderKey('gemini', setGeminiConfigured, setGeminiApiKey)}
                            disabled={savingApiKey.gemini}
                          >
                            Remove Key
                          </Button>
                        </>
                      )}
                    </CardActions>
                  </Card>
                )}
              </>
            )}
          </TabPanel>

          {/* LLM Settings Tab (System Admin only) */}
          {user?.role === UserRole.SYSTEM_ADMIN && (
            <TabPanel value={activeTab} index={2}>
              <Typography variant="h5" gutterBottom>
                LLM Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                Configure default LLM provider and model, and manage per-prompt overrides
              </Typography>

              {/* Default LLM Configuration Section */}
              <Card sx={{ mb: 4 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Default LLM Configuration
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Set the default LLM provider and model to use when no prompt-specific override is configured
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <TextField
                      select
                      label="Provider"
                      value={defaultProvider}
                      onChange={(e) => {
                        setDefaultProvider(e.target.value);
                        // Set default model for selected provider
                        const models = LLM_MODELS[e.target.value];
                        if (models && models.length > 0) {
                          setDefaultModel(models[0]);
                        }
                      }}
                      sx={{ minWidth: 200 }}
                    >
                      <MenuItem value="openai">OpenAI</MenuItem>
                      <MenuItem value="anthropic">Anthropic</MenuItem>
                      <MenuItem value="grok">Grok (xAI)</MenuItem>
                      <MenuItem value="gemini">Google Gemini</MenuItem>
                    </TextField>

                    <TextField
                      select
                      label="Model"
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                      sx={{ minWidth: 300 }}
                    >
                      {LLM_MODELS[defaultProvider]?.map((model) => (
                        <MenuItem key={model} value={model}>
                          {model}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>

                  <Button
                    variant="contained"
                    onClick={handleSaveDefaultLLMConfig}
                    disabled={savingDefaultConfig}
                  >
                    {savingDefaultConfig ? 'Saving...' : 'Save Default Configuration'}
                  </Button>
                </CardContent>
              </Card>

              {/* Default Image LLM Configuration Section */}
              <Card sx={{ mb: 4 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Image Generation Model
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Image generation is powered by OpenAI's GPT-Image-1.5 (Latest, as of late 2025)
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
                    <TextField
                      label="Provider"
                      value="OpenAI"
                      disabled
                      sx={{ minWidth: 200 }}
                    />

                    <TextField
                      label="Model"
                      value="GPT-Image-1.5 (Latest)"
                      disabled
                      sx={{ minWidth: 300 }}
                    />
                  </Box>

                  <Alert severity="info" sx={{ mt: 2 }}>
                    <Typography variant="body2">
                      All image generation uses <strong>gpt-image-1.5</strong>, OpenAI's latest and most advanced image model.
                      This ensures the highest quality and consistency across all generated posters.
                    </Typography>
                  </Alert>
                </CardContent>
              </Card>

              {/* Per-Prompt Overrides Section */}
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Per-Prompt LLM Overrides
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Configure specific LLM provider and model for individual prompts
                  </Typography>

                  {promptsLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress />
                    </Box>
                  ) : prompts.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <Typography variant="body1" color="text.secondary">
                        No prompts available. Create prompts in the Prompts tab to configure overrides.
                      </Typography>
                    </Box>
                  ) : (
                    <TableContainer>
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableCell>Prompt Name</TableCell>
                            <TableCell>Text Provider</TableCell>
                            <TableCell>Text Model</TableCell>
                            <TableCell>Image Provider</TableCell>
                            <TableCell>Image Model</TableCell>
                            <TableCell align="right">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {prompts.map((prompt) => {
                            const promptProvider = prompt.llmProvider || defaultProvider;
                            const promptModel = prompt.llmModel || defaultModel;
                            const promptImageProvider = prompt.imageLLMProvider || defaultImageProvider;
                            const promptImageModel = prompt.imageLLMModel || defaultImageModel;
                            const isTextOverridden = !!prompt.llmProvider;
                            const isImageOverridden = !!prompt.imageLLMProvider;

                            return (
                              <TableRow key={prompt._id}>
                                <TableCell>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body2" fontWeight="500">
                                      {prompt.name}
                                    </Typography>
                                    {!isTextOverridden && !isImageOverridden && (
                                      <Chip label="Using Defaults" size="small" variant="outlined" />
                                    )}
                                  </Box>
                                </TableCell>
                                <TableCell>
                                  <TextField
                                    select
                                    size="small"
                                    value={promptProvider}
                                    onChange={async (e) => {
                                      const newProvider = e.target.value;
                                      const newModel = LLM_MODELS[newProvider][0];
                                      try {
                                        await promptAPI.update(prompt._id, {
                                          llmProvider: newProvider,
                                          llmModel: newModel
                                        });
                                        fetchPrompts();
                                        setMessage({ type: 'success', text: `Updated ${prompt.name} text provider to ${newProvider}` });
                                      } catch (error) {
                                        setMessage({ type: 'error', text: 'Failed to update prompt configuration' });
                                      }
                                    }}
                                    sx={{ minWidth: 130 }}
                                  >
                                    <MenuItem value="openai">OpenAI</MenuItem>
                                    <MenuItem value="anthropic">Anthropic</MenuItem>
                                    <MenuItem value="grok">Grok</MenuItem>
                                    <MenuItem value="gemini">Gemini</MenuItem>
                                  </TextField>
                                </TableCell>
                                <TableCell>
                                  <TextField
                                    select
                                    size="small"
                                    value={promptModel}
                                    onChange={async (e) => {
                                      try {
                                        await promptAPI.update(prompt._id, {
                                          llmProvider: promptProvider,
                                          llmModel: e.target.value
                                        });
                                        fetchPrompts();
                                        setMessage({ type: 'success', text: `Updated ${prompt.name} text model` });
                                      } catch (error) {
                                        setMessage({ type: 'error', text: 'Failed to update prompt model' });
                                      }
                                    }}
                                    sx={{ minWidth: 180 }}
                                  >
                                    {LLM_MODELS[promptProvider]?.map((model) => (
                                      <MenuItem key={model} value={model}>
                                        {model}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                </TableCell>
                                <TableCell>
                                  <TextField
                                    size="small"
                                    value="OpenAI"
                                    disabled
                                    sx={{ minWidth: 130 }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <TextField
                                    size="small"
                                    value="GPT-Image-1.5 (Latest)"
                                    disabled
                                    sx={{ minWidth: 180 }}
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  {(isTextOverridden || isImageOverridden) && (
                                    <Button
                                      size="small"
                                      onClick={async () => {
                                        try {
                                          await promptAPI.update(prompt._id, {
                                            llmProvider: null,
                                            llmModel: null,
                                            imageLLMProvider: null,
                                            imageLLMModel: null
                                          });
                                          fetchPrompts();
                                          setMessage({ type: 'success', text: `${prompt.name} now uses default configuration` });
                                        } catch (error) {
                                          setMessage({ type: 'error', text: 'Failed to clear override' });
                                        }
                                      }}
                                    >
                                      Use Default
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            </TabPanel>
          )}

          {/* Prompts Tab (System Admin only) */}
          {user?.role === UserRole.SYSTEM_ADMIN && (
            <TabPanel value={activeTab} index={3}>
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
                    <strong>Tip:</strong> Use placeholders like {'{companyInfo}'}, {'{campaignDetails}'}, {'{taskDescription}'}, {'{brandGuidelines}'}, {'{primaryLogo}'}, etc. in your prompts.
                    These will be automatically replaced with actual data when generating content.
                  </Typography>
                </Alert>
              </Box>

              {/* Command Mappings Section */}
              <Divider sx={{ my: 4 }} />

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Command Mappings
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Map commands to prompts for dynamic LLM execution
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleCreateCommandMapping}
                >
                  Add Mapping
                </Button>
              </Box>

              {commandMappingsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : commandMappings.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body1" color="text.secondary">
                    No command mappings configured yet. Create your first mapping to get started.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Command</TableCell>
                        <TableCell>Mapped Prompt</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {commandMappings.map((mapping) => (
                        <TableRow key={mapping._id}>
                          <TableCell>
                            <Chip
                              label={mapping.command}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {mapping.promptId?.name || 'N/A'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Edit mapping">
                              <IconButton
                                size="small"
                                onClick={() => handleEditCommandMapping(mapping)}
                                color="primary"
                              >
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete mapping">
                              <IconButton
                                size="small"
                                onClick={() => handleDeleteCommandMapping(mapping._id)}
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
                    <strong>How it works:</strong> Commands like "generate-campaign" can be configured to use specific prompts.
                    When users trigger these commands, the system automatically uses the mapped prompt for LLM execution.
                  </Typography>
                </Alert>
              </Box>
            </TabPanel>
          )}

          <TabPanel value={activeTab} index={user?.role === UserRole.SYSTEM_ADMIN ? 4 : (user?.role === UserRole.HYBRID ? 3 : 2)}>
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
                  <strong>Available Placeholders:</strong><br />
                  <strong>Company:</strong> {'{companyInfo}'} (full object), {'{companyName}'}, {'{sector}'}, {'{brandTone}'}, {'{brandGuidelines}'}<br />
                  <strong>Campaign:</strong> {'{campaignDetails}'} (full object), {'{campaignName}'}, {'{coreMessages}'}, {'{hashtags}'}<br />
                  <strong>Task:</strong> {'{taskDescription}'}, {'{baseImage}'} (URL of task's original image)<br />
                  <strong>Brand Assets:</strong> {'{primaryLogo}'}, {'{secondaryLogo}'}, {'{tertiaryLogo}'} (logo URLs)
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

        {/* Command Mapping Create/Edit Modal */}
        <Dialog open={commandMappingModalOpen} onClose={handleCloseCommandMappingModal} maxWidth="sm" fullWidth>
          <DialogTitle>
            {editingCommandMapping ? 'Edit Command Mapping' : 'Create New Command Mapping'}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="Command Name"
                value={commandMappingForm.command}
                onChange={(e) => setCommandMappingForm({ ...commandMappingForm, command: e.target.value })}
                margin="normal"
                placeholder="e.g., generate-campaign"
                helperText="Unique command identifier (e.g., generate-campaign, summarize-campaign)"
                required
                disabled={!!editingCommandMapping}
              />
              <TextField
                fullWidth
                select
                label="Select Prompt"
                value={commandMappingForm.promptId}
                onChange={(e) => setCommandMappingForm({ ...commandMappingForm, promptId: e.target.value })}
                margin="normal"
                helperText="Choose which prompt this command should use"
                required
              >
                {prompts.length === 0 ? (
                  <MenuItem value="" disabled>
                    No prompts available. Create a prompt first.
                  </MenuItem>
                ) : (
                  prompts.map((prompt) => (
                    <MenuItem key={prompt._id} value={prompt._id}>
                      {prompt.name}
                    </MenuItem>
                  ))
                )}
              </TextField>
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  This mapping allows the specified command to dynamically use the selected prompt for LLM execution.
                </Typography>
              </Alert>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseCommandMappingModal}>Cancel</Button>
            <Button
              onClick={handleSaveCommandMapping}
              variant="contained"
              disabled={commandMappingSaving}
            >
              {commandMappingSaving ? 'Saving...' : (editingCommandMapping ? 'Update' : 'Create')}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Container>
  );
}
