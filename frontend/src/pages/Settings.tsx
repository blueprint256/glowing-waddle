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
  Tooltip,
  FormControlLabel,
  Switch,
  useMediaQuery,
  useTheme
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
import api, { promptAPI, commandMappingAPI, chainAPI } from '../services/api';

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
      {value === index && <Box sx={{ p: { xs: 2, sm: 3 } }}>{children}</Box>}
    </div>
  );
}

const SECTORS = ['Tech', 'Retail', 'Healthcare', 'Finance', 'Education', 'Manufacturing', 'Other'];
const BRAND_TONES = ['Professional', 'Fun', 'Serious', 'Casual', 'Formal', 'Friendly'];

// LLM Provider models (for text generation and image generation)
const LLM_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-image-1.5'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  grok: ['grok-beta', 'grok-2'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash']
};

// Image LLM Provider models (for image generation)
// RESTRICTED TO GPT-IMAGE-1.5 ONLY as of late 2025
// const IMAGE_LLM_MODELS: Record<string, string[]> = {
//   openai: ['gpt-image-1.5']
// };

export default function Settings() {
  const [searchParams] = useSearchParams();
  const { user } = useAuthStore();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // <600px
  const [activeTab, setActiveTab] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [canvaConnectedAt, setCanvaConnectedAt] = useState<Date | null>(null);
  const [twitterConnected, setTwitterConnected] = useState(false);
  const [twitterConnectedAt, setTwitterConnectedAt] = useState<Date | null>(null);
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [linkedinConnectedAt, setLinkedinConnectedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<{[key: string]: boolean}>({});
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

  // Command Mappings state (System Admin only)
  const [commandMappings, setCommandMappings] = useState<any[]>([]);
  const [commandMappingsLoading, setCommandMappingsLoading] = useState(false);
  const [commandMappingModalOpen, setCommandMappingModalOpen] = useState(false);
  const [editingCommandMapping, setEditingCommandMapping] = useState<any>(null);
  const [commandMappingForm, setCommandMappingForm] = useState<{
    command: string;
    mappingType: 'prompt' | 'chain' | 'steps'; // Type of mapping
    promptId?: string; // For single prompt mode
    chainId?: string; // For chain mode
    steps: Array<{ promptId: string; provider: string; model: string }>; // For legacy mode
  }>({
    command: '',
    mappingType: 'prompt',
    promptId: '',
    chainId: '',
    steps: [{ promptId: '', provider: '', model: '' }]
  });
  const [commandMappingSaving, setCommandMappingSaving] = useState(false);

  // Chains state (System Admin only)
  const [chains, setChains] = useState<any[]>([]);
  const [chainsLoading, setChainsLoading] = useState(false);
  const [chainModalOpen, setChainModalOpen] = useState(false);
  const [editingChain, setEditingChain] = useState<any>(null);
  const [chainForm, setChainForm] = useState<{
    name: string;
    steps: Array<{ description: string; prompt: string; provider: string; model: string; carryForwardImages?: boolean }>;
  }>({
    name: '',
    steps: [{ description: '', prompt: '', provider: 'openai', model: 'gpt-4o-mini', carryForwardImages: true }]
  });
  const [chainSaving, setChainSaving] = useState(false);

  // Twitter OAuth configuration state (System Admin only)
  const [twitterOAuthConfigured, setTwitterOAuthConfigured] = useState(false);
  const [twitterClientId, setTwitterClientId] = useState('');
  const [twitterClientSecret, setTwitterClientSecret] = useState('');
  const [showTwitterClientSecret, setShowTwitterClientSecret] = useState(false);
  const [savingTwitterConfig, setSavingTwitterConfig] = useState(false);

  useEffect(() => {
    // Check for integration callback status
    const integration = searchParams.get('integration');
    const status = searchParams.get('status');

    if (integration && status) {
      const integrationTab = user?.role === UserRole.HYBRID ? 2 : 1;

      if (status === 'success') {
        const platformName = integration.charAt(0).toUpperCase() + integration.slice(1);
        setMessage({ type: 'success', text: `${platformName} integration connected successfully!` });
        setActiveTab(integrationTab); // Switch to Integrations tab
        fetchIntegrationStatus();
      } else {
        const platformName = integration.charAt(0).toUpperCase() + integration.slice(1);
        setMessage({ type: 'error', text: `Failed to connect ${platformName} integration. Please try again.` });
        setActiveTab(integrationTab);
      }
    } else {
      fetchIntegrationStatus();
    }

    // Fetch company info if user is Hybrid
    if (user?.role === UserRole.HYBRID) {
      fetchCompanyInfo();
    }

    // Fetch prompts, chains, and command mappings if user is System Admin
    if (user?.role === UserRole.SYSTEM_ADMIN) {
      fetchPrompts();
      fetchChains();
      fetchCommandMappings();
      fetchDefaultLLMConfig();
      fetchTwitterOAuthStatus();
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
        // Canva integration
        setCanvaConnected(response.data.integrations.canva.connected);
        if (response.data.integrations.canva.connectedAt) {
          setCanvaConnectedAt(new Date(response.data.integrations.canva.connectedAt));
        }

        // Twitter integration
        if (response.data.integrations.twitter) {
          setTwitterConnected(response.data.integrations.twitter.connected);
          if (response.data.integrations.twitter.connectedAt) {
            setTwitterConnectedAt(new Date(response.data.integrations.twitter.connectedAt));
          }
        }

        // LinkedIn integration
        if (response.data.integrations.linkedin) {
          setLinkedinConnected(response.data.integrations.linkedin.connected);
          if (response.data.integrations.linkedin.connectedAt) {
            setLinkedinConnectedAt(new Date(response.data.integrations.linkedin.connectedAt));
          }
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

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setMessage(null);
  };

  const handleConnectCanva = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${apiUrl}/integrations/canva`;
  };

  const handleDisconnectCanva = async () => {
    try {
      setDisconnecting(prev => ({ ...prev, canva: true }));
      const response = await api.post('/integrations/canva/disconnect');
      if (response.data.success) {
        setCanvaConnected(false);
        setCanvaConnectedAt(null);
        setMessage({ type: 'success', text: 'Canva integration disconnected successfully.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to disconnect Canva integration. Please try again.' });
    } finally {
      setDisconnecting(prev => ({ ...prev, canva: false }));
    }
  };

  const handleConnectTwitter = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${apiUrl}/integrations/twitter`;
  };

  const handleDisconnectTwitter = async () => {
    try {
      setDisconnecting(prev => ({ ...prev, twitter: true }));
      const response = await api.post('/integrations/twitter/disconnect');
      if (response.data.success) {
        setTwitterConnected(false);
        setTwitterConnectedAt(null);
        setMessage({ type: 'success', text: 'Twitter integration disconnected successfully.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to disconnect Twitter integration. Please try again.' });
    } finally {
      setDisconnecting(prev => ({ ...prev, twitter: false }));
    }
  };

  const handleConnectLinkedin = () => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${apiUrl}/integrations/linkedin`;
  };

  const handleDisconnectLinkedin = async () => {
    try {
      setDisconnecting(prev => ({ ...prev, linkedin: true }));
      const response = await api.post('/integrations/linkedin/disconnect');
      if (response.data.success) {
        setLinkedinConnected(false);
        setLinkedinConnectedAt(null);
        setMessage({ type: 'success', text: 'LinkedIn integration disconnected successfully.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to disconnect LinkedIn integration. Please try again.' });
    } finally {
      setDisconnecting(prev => ({ ...prev, linkedin: false }));
    }
  };

  // Twitter OAuth configuration functions (Admin only)
  const fetchTwitterOAuthStatus = async () => {
    try {
      const response = await api.get('/integrations/twitter/config/status');
      if (response.data.success) {
        setTwitterOAuthConfigured(response.data.configured);
      }
    } catch (error) {
      console.error('Error fetching Twitter OAuth status:', error);
    }
  };

  const handleSaveTwitterOAuthConfig = async () => {
    try {
      setSavingTwitterConfig(true);
      const response = await api.patch('/integrations/twitter/config', {
        clientId: twitterClientId,
        clientSecret: twitterClientSecret
      });

      if (response.data.success) {
        setMessage({ type: 'success', text: 'Twitter OAuth credentials saved successfully!' });
        setTwitterOAuthConfigured(true);
        setTwitterClientId('');
        setTwitterClientSecret('');
        setShowTwitterClientSecret(false);
        fetchTwitterOAuthStatus();
      }
    } catch (error: any) {
      console.error('Error saving Twitter OAuth config:', error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to save Twitter OAuth credentials'
      });
    } finally {
      setSavingTwitterConfig(false);
    }
  };

  const handleRemoveTwitterOAuthConfig = async () => {
    if (!confirm('Are you sure you want to remove the Twitter OAuth configuration? This will disconnect all users\' Twitter accounts.')) {
      return;
    }

    try {
      setSavingTwitterConfig(true);
      const response = await api.delete('/integrations/twitter/config');

      if (response.data.success) {
        setMessage({ type: 'success', text: 'Twitter OAuth credentials removed successfully.' });
        setTwitterOAuthConfigured(false);
        setTwitterClientId('');
        setTwitterClientSecret('');
        fetchTwitterOAuthStatus();
      }
    } catch (error: any) {
      console.error('Error removing Twitter OAuth config:', error);
      setMessage({ type: 'error', text: 'Failed to remove Twitter OAuth credentials' });
    } finally {
      setSavingTwitterConfig(false);
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

  // Chain management functions
  const fetchChains = async () => {
    try {
      setChainsLoading(true);
      const response = await chainAPI.getAll();
      if (response.data.success) {
        setChains(response.data.chains);
      }
    } catch (error) {
      console.error('Error fetching chains:', error);
      setMessage({ type: 'error', text: 'Failed to load chains. Please try again.' });
    } finally {
      setChainsLoading(false);
    }
  };

  const handleCreateChain = () => {
    setEditingChain(null);
    setChainForm({
      name: '',
      steps: [{ description: '', prompt: '', provider: 'openai', model: 'gpt-4o-mini', carryForwardImages: true }]
    });
    setChainModalOpen(true);
  };

  const handleEditChain = (chain: any) => {
    setEditingChain(chain);
    setChainForm({ name: chain.name, steps: chain.steps || [] });
    setChainModalOpen(true);
  };

  const handleCloseChainModal = () => {
    setChainModalOpen(false);
    setEditingChain(null);
    setChainForm({
      name: '',
      steps: [{ description: '', prompt: '', provider: 'openai', model: 'gpt-4o-mini', carryForwardImages: true }]
    });
  };

  const handleAddChainStep = () => {
    setChainForm({
      ...chainForm,
      steps: [...chainForm.steps, { description: '', prompt: '', provider: 'openai', model: 'gpt-4o-mini', carryForwardImages: true }]
    });
  };

  const handleRemoveChainStep = (index: number) => {
    if (chainForm.steps.length > 1) {
      setChainForm({
        ...chainForm,
        steps: chainForm.steps.filter((_, i) => i !== index)
      });
    }
  };

  const handleChainStepChange = (index: number, field: string, value: string | boolean) => {
    const updatedSteps = [...chainForm.steps];
    updatedSteps[index] = { ...updatedSteps[index], [field]: value };
    setChainForm({ ...chainForm, steps: updatedSteps });
  };

  const handleSaveChain = async () => {
    try {
      setChainSaving(true);

      if (!chainForm.name.trim()) {
        setMessage({ type: 'error', text: 'Chain name is required.' });
        return;
      }

      if (chainForm.steps.length === 0) {
        setMessage({ type: 'error', text: 'At least one step is required.' });
        return;
      }

      // Validate each step
      for (let i = 0; i < chainForm.steps.length; i++) {
        const step = chainForm.steps[i];
        if (!step.description.trim() || !step.prompt.trim() || !step.provider || !step.model) {
          setMessage({ type: 'error', text: `Step ${i + 1}: All fields are required.` });
          return;
        }
      }

      if (editingChain) {
        // Update existing chain
        const response = await chainAPI.update(editingChain._id, chainForm);
        if (response.data.success) {
          setMessage({ type: 'success', text: 'Chain updated successfully!' });
          fetchChains();
          handleCloseChainModal();
        }
      } else {
        // Create new chain
        const response = await chainAPI.create(chainForm);
        if (response.data.success) {
          setMessage({ type: 'success', text: 'Chain created successfully!' });
          fetchChains();
          handleCloseChainModal();
        }
      }
    } catch (error: any) {
      console.error('Error saving chain:', error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Failed to save chain. Please try again.'
      });
    } finally {
      setChainSaving(false);
    }
  };

  const handleDeleteChain = async (chainId: string) => {
    if (!window.confirm('Are you sure you want to delete this chain? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await chainAPI.delete(chainId);
      if (response.data.success) {
        setMessage({ type: 'success', text: 'Chain deleted successfully!' });
        fetchChains();
        // Also refresh command mappings in case deleted chain was used in a mapping
        fetchCommandMappings();
      }
    } catch (error) {
      console.error('Error deleting chain:', error);
      setMessage({ type: 'error', text: 'Failed to delete chain. Please try again.' });
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
    setCommandMappingForm({
      command: '',
      mappingType: 'prompt',
      promptId: '',
      chainId: '',
      steps: [{ promptId: '', provider: '', model: '' }]
    });
    setCommandMappingModalOpen(true);
  };

  const handleEditCommandMapping = (mapping: any) => {
    setEditingCommandMapping(mapping);

    // Determine mapping type and populate form
    let mappingType: 'prompt' | 'chain' | 'steps' = 'prompt';
    let formData: any = {
      command: mapping.command,
      promptId: '',
      chainId: '',
      steps: [{ promptId: '', provider: '', model: '' }]
    };

    if (mapping.chainId) {
      // Chain mapping
      mappingType = 'chain';
      formData.chainId = mapping.chainId._id || mapping.chainId;
    } else if (mapping.steps && Array.isArray(mapping.steps) && mapping.steps.length > 0) {
      // Legacy steps format
      mappingType = 'steps';
      formData.steps = mapping.steps.map((step: any) => ({
        promptId: step.promptId?._id || step.promptId || '',
        provider: step.provider || '',
        model: step.model || ''
      }));
    } else if (mapping.promptId) {
      // Single prompt mapping
      mappingType = 'prompt';
      formData.promptId = mapping.promptId._id || mapping.promptId;
    }

    setCommandMappingForm({
      ...formData,
      mappingType
    });
    setCommandMappingModalOpen(true);
  };

  const handleCloseCommandMappingModal = () => {
    setCommandMappingModalOpen(false);
    setEditingCommandMapping(null);
    setCommandMappingForm({
      command: '',
      mappingType: 'prompt',
      promptId: '',
      chainId: '',
      steps: [{ promptId: '', provider: '', model: '' }]
    });
  };

  const handleSaveCommandMapping = async () => {
    try {
      setCommandMappingSaving(true);

      if (!commandMappingForm.command.trim()) {
        setMessage({ type: 'error', text: 'Command name is required.' });
        return;
      }

      // Build payload based on mapping type
      const payload: any = {
        command: commandMappingForm.command.trim()
      };

      if (commandMappingForm.mappingType === 'prompt') {
        // Single prompt mapping
        if (!commandMappingForm.promptId) {
          setMessage({ type: 'error', text: 'Please select a prompt.' });
          return;
        }
        payload.promptId = commandMappingForm.promptId;
      } else if (commandMappingForm.mappingType === 'chain') {
        // Chain mapping
        if (!commandMappingForm.chainId) {
          setMessage({ type: 'error', text: 'Please select a chain.' });
          return;
        }
        payload.chainId = commandMappingForm.chainId;
      } else if (commandMappingForm.mappingType === 'steps') {
        // Legacy steps array mapping
        // Validate that all steps have a promptId
        for (let i = 0; i < commandMappingForm.steps.length; i++) {
          if (!commandMappingForm.steps[i].promptId) {
            setMessage({ type: 'error', text: `Step ${i + 1}: Please select a prompt.` });
            return;
          }
        }
        // Filter out empty provider/model values
        const steps = commandMappingForm.steps.map(step => ({
          promptId: step.promptId,
          ...(step.provider && { provider: step.provider }),
          ...(step.model && { model: step.model })
        }));
        payload.steps = steps;
      }

      if (editingCommandMapping) {
        // Update existing mapping
        const response = await commandMappingAPI.update(editingCommandMapping._id, payload);
        if (response.data.success) {
          setMessage({ type: 'success', text: 'Command mapping updated successfully!' });
          fetchCommandMappings();
          handleCloseCommandMappingModal();
        }
      } else {
        // Create new mapping
        const response = await commandMappingAPI.create(payload);
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
    <Container maxWidth="lg" sx={{ px: { xs: 1, sm: 2, md: 3 } }}>
      <Box sx={{ py: { xs: 2, sm: 3, md: 4 } }}>
        <Typography
          variant="h4"
          gutterBottom
          sx={{
            fontSize: { xs: '1.5rem', sm: '2rem', md: '2.125rem' },
            fontWeight: 600
          }}
        >
          Settings
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mb: 3,
            fontSize: { xs: '0.875rem', sm: '1rem' }
          }}
        >
          Manage your account settings and integrations
        </Typography>

        {message && (
          <Alert
            severity={message.type}
            sx={{
              mb: 3,
              fontSize: { xs: '0.875rem', sm: '1rem' }
            }}
            onClose={() => setMessage(null)}
          >
            {message.text}
          </Alert>
        )}

        <Paper sx={{ borderRadius: { xs: '8px', sm: '12px' } }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            aria-label="settings tabs"
            variant={isMobile ? 'scrollable' : 'standard'}
            scrollButtons={isMobile ? 'auto' : false}
            allowScrollButtonsMobile
            sx={{
              '& .MuiTab-root': {
                fontSize: { xs: '0.8125rem', sm: '0.875rem' },
                minHeight: { xs: '48px', sm: '48px' },
                minWidth: { xs: 'auto', sm: 90 },
                px: { xs: 1.5, sm: 2 }
              }
            }}
          >
            <Tab label="Profile" />
            {user?.role === UserRole.HYBRID && <Tab label="Company Info" />}
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
                <Card sx={{
                  mb: 2,
                  borderRadius: { xs: '8px', sm: '12px' },
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}>
                  <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                    <Box sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                      gap: { xs: 1.5, sm: 2 },
                      mb: 2
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
                          Canva
                        </Typography>
                        {canvaConnected ? (
                          <Chip
                            icon={<CheckCircle />}
                            label="Connected"
                            color="success"
                            size="small"
                            sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                          />
                        ) : (
                          <Chip
                            icon={<Cancel />}
                            label="Not Connected"
                            color="default"
                            size="small"
                            sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                          />
                        )}
                      </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
                      Connect your Canva account to import designs and images directly into your tasks.
                      This integration allows you to browse and use your Canva designs within the campaign
                      management platform.
                    </Typography>
                    {canvaConnected && canvaConnectedAt && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 1, display: 'block', fontSize: { xs: '0.6875rem', sm: '0.75rem' } }}
                      >
                        Connected on {canvaConnectedAt.toLocaleDateString()} at{' '}
                        {canvaConnectedAt.toLocaleTimeString()}
                      </Typography>
                    )}
                  </CardContent>
                  <Divider />
                  <CardActions sx={{ p: { xs: 1.5, sm: 2 } }}>
                    {canvaConnected ? (
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDisconnectCanva}
                        disabled={disconnecting.canva}
                        fullWidth={isMobile}
                        sx={{
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.875rem', sm: '0.875rem' }
                        }}
                      >
                        {disconnecting.canva ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LinkIcon />}
                        onClick={handleConnectCanva}
                        fullWidth={isMobile}
                        sx={{
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.875rem', sm: '0.875rem' }
                        }}
                      >
                        Connect Canva
                      </Button>
                    )}
                  </CardActions>
                </Card>

                {/* Twitter Integration */}
                <Card sx={{
                  mb: 2,
                  borderRadius: { xs: '8px', sm: '12px' },
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}>
                  <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                    <Box sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                      gap: { xs: 1.5, sm: 2 },
                      mb: 2
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
                          Twitter (X)
                        </Typography>
                        {twitterConnected ? (
                          <Chip
                            icon={<CheckCircle />}
                            label="Connected"
                            color="success"
                            size="small"
                            sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                          />
                        ) : (
                          <Chip
                            icon={<Cancel />}
                            label="Not Connected"
                            color="default"
                            size="small"
                            sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                          />
                        )}
                      </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
                      Connect your Twitter account to manage and publish content directly to your Twitter profile.
                      This integration enables you to streamline your social media workflow and maintain consistent
                      brand presence on Twitter.
                    </Typography>
                    {twitterConnected && twitterConnectedAt && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 1, display: 'block', fontSize: { xs: '0.6875rem', sm: '0.75rem' } }}
                      >
                        Connected on {twitterConnectedAt.toLocaleDateString()} at{' '}
                        {twitterConnectedAt.toLocaleTimeString()}
                      </Typography>
                    )}
                  </CardContent>
                  <Divider />
                  <CardActions sx={{ p: { xs: 1.5, sm: 2 } }}>
                    {twitterConnected ? (
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDisconnectTwitter}
                        disabled={disconnecting.twitter}
                        fullWidth={isMobile}
                        sx={{
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.875rem', sm: '0.875rem' }
                        }}
                      >
                        {disconnecting.twitter ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LinkIcon />}
                        onClick={handleConnectTwitter}
                        fullWidth={isMobile}
                        sx={{
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.875rem', sm: '0.875rem' }
                        }}
                      >
                        Connect Twitter
                      </Button>
                    )}
                  </CardActions>
                </Card>

                {/* LinkedIn Integration */}
                <Card sx={{
                  mb: 2,
                  borderRadius: { xs: '8px', sm: '12px' },
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                }}>
                  <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                    <Box sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                      gap: { xs: 1.5, sm: 2 },
                      mb: 2
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' } }}>
                          LinkedIn
                        </Typography>
                        {linkedinConnected ? (
                          <Chip
                            icon={<CheckCircle />}
                            label="Connected"
                            color="success"
                            size="small"
                            sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                          />
                        ) : (
                          <Chip
                            icon={<Cancel />}
                            label="Not Connected"
                            color="default"
                            size="small"
                            sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                          />
                        )}
                      </Box>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
                      Connect your LinkedIn account to manage and publish professional content directly to your LinkedIn profile
                      or company page. This integration helps you maintain consistent professional presence and engage with
                      your network effectively.
                    </Typography>
                    {linkedinConnected && linkedinConnectedAt && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mt: 1, display: 'block', fontSize: { xs: '0.6875rem', sm: '0.75rem' } }}
                      >
                        Connected on {linkedinConnectedAt.toLocaleDateString()} at{' '}
                        {linkedinConnectedAt.toLocaleTimeString()}
                      </Typography>
                    )}
                  </CardContent>
                  <Divider />
                  <CardActions sx={{ p: { xs: 1.5, sm: 2 } }}>
                    {linkedinConnected ? (
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDisconnectLinkedin}
                        disabled={disconnecting.linkedin}
                        fullWidth={isMobile}
                        sx={{
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.875rem', sm: '0.875rem' }
                        }}
                      >
                        {disconnecting.linkedin ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LinkIcon />}
                        onClick={handleConnectLinkedin}
                        fullWidth={isMobile}
                        sx={{
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.875rem', sm: '0.875rem' }
                        }}
                      >
                        Connect LinkedIn
                      </Button>
                    )}
                  </CardActions>
                </Card>

                {/* Twitter OAuth Configuration (System Admin only) */}
                {user?.role === UserRole.SYSTEM_ADMIN && (
                  <Card sx={{
                    mb: 2,
                    borderRadius: { xs: '8px', sm: '12px' },
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                    border: '2px solid #1DA1F2'
                  }}>
                    <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                      <Box sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        justifyContent: 'space-between',
                        gap: { xs: 1.5, sm: 2 },
                        mb: 2
                      }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                          <Typography variant="h6" sx={{ fontSize: { xs: '1.125rem', sm: '1.25rem' }, color: '#1DA1F2' }}>
                            Twitter (X) OAuth Configuration
                          </Typography>
                          {twitterOAuthConfigured ? (
                            <Chip
                              icon={<CheckCircleOutline />}
                              label="Configured"
                              color="success"
                              size="small"
                              sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                            />
                          ) : (
                            <Chip
                              icon={<WarningAmber />}
                              label="Not Configured"
                              color="warning"
                              size="small"
                              sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' } }}
                            />
                          )}
                        </Box>
                      </Box>

                      <Alert severity="info" sx={{ mb: 2, fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
                        <strong>Admin Configuration:</strong> Set up Twitter OAuth credentials here once. Regular users will then be able to connect their own Twitter accounts to post tweets.
                      </Alert>

                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: { xs: '0.875rem', sm: '0.875rem' } }}>
                        Configure Twitter Developer App OAuth 2.0 credentials. Users will authenticate via OAuth with PKCE to grant permission to post on their behalf.
                      </Typography>

                      <TextField
                        fullWidth
                        label="Twitter Client ID"
                        value={twitterClientId}
                        onChange={(e) => setTwitterClientId(e.target.value)}
                        placeholder={twitterOAuthConfigured ? 'Enter new Client ID to update' : 'Enter your Twitter Client ID'}
                        helperText={twitterOAuthConfigured ? 'Current credentials are saved. Enter new values to update.' : 'Get this from your Twitter Developer Portal'}
                        margin="normal"
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            fontSize: { xs: '0.875rem', sm: '1rem' }
                          }
                        }}
                      />

                      <TextField
                        fullWidth
                        type={showTwitterClientSecret ? 'text' : 'password'}
                        label="Twitter Client Secret"
                        value={twitterClientSecret}
                        onChange={(e) => setTwitterClientSecret(e.target.value)}
                        placeholder={twitterOAuthConfigured ? 'Enter new Client Secret to update' : 'Enter your Twitter Client Secret'}
                        helperText={twitterOAuthConfigured ? 'Enter a new secret to update' : 'Keep this secret secure - never share it'}
                        margin="normal"
                        InputProps={{
                          endAdornment: (
                            <IconButton
                              onClick={() => setShowTwitterClientSecret(!showTwitterClientSecret)}
                              edge="end"
                              size="small"
                            >
                              {showTwitterClientSecret ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          )
                        }}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            fontSize: { xs: '0.875rem', sm: '1rem' }
                          }
                        }}
                      />
                    </CardContent>
                    <Divider />
                    <CardActions sx={{ p: { xs: 1.5, sm: 2 }, gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                      <Button
                        variant="contained"
                        onClick={handleSaveTwitterOAuthConfig}
                        disabled={savingTwitterConfig || !twitterClientId.trim() || !twitterClientSecret.trim()}
                        fullWidth={isMobile}
                        sx={{
                          minHeight: { xs: '44px', sm: 'auto' },
                          fontSize: { xs: '0.875rem', sm: '0.875rem' },
                          backgroundColor: '#1DA1F2',
                          '&:hover': {
                            backgroundColor: '#1A8CD8'
                          }
                        }}
                      >
                        {savingTwitterConfig ? 'Saving...' : 'Save OAuth Credentials'}
                      </Button>
                      {twitterOAuthConfigured && (
                        <Button
                          size="small"
                          color="error"
                          onClick={handleRemoveTwitterOAuthConfig}
                          disabled={savingTwitterConfig}
                          fullWidth={isMobile}
                          sx={{
                            minHeight: { xs: '44px', sm: 'auto' },
                            fontSize: { xs: '0.875rem', sm: '0.875rem' }
                          }}
                        >
                          Remove OAuth Configuration
                        </Button>
                      )}
                    </CardActions>
                  </Card>
                )}

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
                        type={showApiKey['openai'] ? 'text' : 'password'}
                        label="OpenAI API Key"
                        value={openAIApiKey}
                        onChange={(e) => setOpenAIApiKey(e.target.value)}
                        placeholder={openAIConfigured ? '••••••••••••••••' : 'sk-...'}
                        helperText={openAIConfigured ? 'Enter a new key to update' : 'Enter your OpenAI API key (starts with sk-)'}
                        InputProps={{
                          endAdornment: (
                            <IconButton
                              onClick={() => setShowApiKey({...showApiKey, openai: !showApiKey['openai']})}
                              edge="end"
                              size="small"
                            >
                              {showApiKey['openai'] ? <VisibilityOff /> : <Visibility />}
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
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={handleCreatePrompt}
                  >
                    Create Prompt
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Add />}
                    onClick={handleCreateChain}
                  >
                    Create Chain
                  </Button>
                </Box>
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

              {/* Chains Section */}
              <Divider sx={{ my: 4 }} />

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Chain Management
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Create multi-step LLM chains with different models for each step
                  </Typography>
                </Box>
              </Box>

              {chainsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : chains.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body1" color="text.secondary">
                    No chains created yet. Create your first chain to get started.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Chain Name</TableCell>
                        <TableCell>Steps</TableCell>
                        <TableCell>Step Details</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {chains.map((chain) => (
                        <TableRow key={chain._id}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="500">
                              {chain.name}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip label={`${chain.steps?.length || 0} step(s)`} size="small" />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ maxWidth: 400 }}>
                              {chain.steps?.map((step: any, idx: number) => (
                                <Typography
                                  key={idx}
                                  variant="caption"
                                  display="block"
                                  color="text.secondary"
                                  sx={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {idx + 1}. {step.description} ({step.provider}/{step.model})
                                </Typography>
                              ))}
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Edit chain">
                              <IconButton
                                size="small"
                                onClick={() => handleEditChain(chain)}
                                color="primary"
                              >
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete chain">
                              <IconButton
                                size="small"
                                onClick={() => handleDeleteChain(chain._id)}
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
                    <strong>Chains:</strong> Create multi-step workflows where each step can use a different LLM model.
                    The output from each step is automatically passed to the next step as {'{previousOutput}'}.
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
                        <TableCell>Configuration</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {commandMappings.map((mapping) => {
                        // Determine mapping type
                        const hasChain = !!mapping.chainId;
                        const hasSteps = mapping.steps && Array.isArray(mapping.steps) && mapping.steps.length > 0;
                        const hasPrompt = !!mapping.promptId;

                        return (
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
                              {hasChain ? (
                                <Box>
                                  <Chip label="Chain" size="small" color="success" sx={{ mr: 1 }} />
                                  <Typography variant="body2" component="span" fontWeight="500">
                                    {mapping.chainId?.name || 'Unknown Chain'}
                                  </Typography>
                                  <Typography variant="caption" display="block" color="text.secondary">
                                    {mapping.chainId?.steps?.length || 0} step(s)
                                  </Typography>
                                </Box>
                              ) : hasSteps ? (
                                <Box>
                                  <Chip label="Legacy Steps" size="small" color="warning" sx={{ mr: 1 }} />
                                  <Typography variant="body2" fontWeight="500">
                                    Multi-step ({mapping.steps.length} steps)
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {mapping.steps.map((step: any, idx: number) =>
                                      step.promptId?.name || `Step ${idx + 1}`
                                    ).join(' → ')}
                                  </Typography>
                                </Box>
                              ) : hasPrompt ? (
                                <Box>
                                  <Chip label="Prompt" size="small" color="info" sx={{ mr: 1 }} />
                                  <Typography variant="body2" component="span">
                                    {mapping.promptId?.name || 'Unknown Prompt'}
                                  </Typography>
                                </Box>
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  N/A
                                </Typography>
                              )}
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
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              <Box sx={{ mt: 2 }}>
                <Alert severity="info" icon={<Info />}>
                  <Typography variant="body2">
                    <strong>How it works:</strong> Commands can be mapped to single prompts or multi-step chains.
                    Multi-step chains enable powerful workflows where each step's output feeds into the next
                    (e.g., Step 1: refine text, Step 2: generate image with refined text). Images and text outputs
                    are automatically carried forward through the chain.
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
                  <strong>Brand Assets:</strong> {'{primaryLogo}'}, {'{secondaryLogo}'}, {'{tertiaryLogo}'} (logo URLs)<br />
                  <strong>Multi-step Chains:</strong> {'{previousOutput}'} (output from previous step in a chain)
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

        {/* Chain Create/Edit Modal */}
        <Dialog open={chainModalOpen} onClose={handleCloseChainModal} maxWidth="lg" fullWidth>
          <DialogTitle>
            {editingChain ? 'Edit Chain' : 'Create New Chain'}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="Chain Name"
                value={chainForm.name}
                onChange={(e) => setChainForm({ ...chainForm, name: e.target.value })}
                margin="normal"
                placeholder="e.g., Poster Generation Chain"
                helperText="Unique identifier for this chain"
                required
              />

              <Typography variant="h6" sx={{ mt: 3, mb: 2 }}>
                Chain Steps
              </Typography>

              {chainForm.steps.map((step, index) => (
                <Paper key={index} sx={{ p: 2, mb: 2 }} variant="outlined">
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight="500">
                      Step {index + 1}
                    </Typography>
                    {chainForm.steps.length > 1 && (
                      <Button
                        size="small"
                        color="error"
                        startIcon={<Delete />}
                        onClick={() => handleRemoveChainStep(index)}
                      >
                        Remove
                      </Button>
                    )}
                  </Box>

                  <TextField
                    fullWidth
                    label="Step Description"
                    value={step.description}
                    onChange={(e) => handleChainStepChange(index, 'description', e.target.value)}
                    margin="normal"
                    placeholder="e.g., Refine campaign description"
                    helperText="Brief description of what this step does"
                    required
                  />

                  <TextField
                    fullWidth
                    label="Prompt Text"
                    value={step.prompt}
                    onChange={(e) => handleChainStepChange(index, 'prompt', e.target.value)}
                    margin="normal"
                    multiline
                    rows={6}
                    placeholder="Enter the prompt for this step. Use {previousOutput} to reference output from the previous step."
                    helperText="The prompt text with placeholders. Use {previousOutput} to reference output from the previous step."
                    required
                  />

                  <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                    <TextField
                      select
                      label="LLM Provider"
                      value={step.provider}
                      onChange={(e) => {
                        handleChainStepChange(index, 'provider', e.target.value);
                        // Reset model when provider changes
                        const defaultModel = LLM_MODELS[e.target.value]?.[0] || '';
                        handleChainStepChange(index, 'model', defaultModel);
                      }}
                      sx={{ flex: 1 }}
                      required
                    >
                      <MenuItem value="openai">OpenAI</MenuItem>
                      <MenuItem value="anthropic">Anthropic</MenuItem>
                      <MenuItem value="grok">Grok</MenuItem>
                      <MenuItem value="gemini">Gemini</MenuItem>
                    </TextField>

                    <TextField
                      select
                      label="Model"
                      value={step.model}
                      onChange={(e) => handleChainStepChange(index, 'model', e.target.value)}
                      sx={{ flex: 1 }}
                      required
                    >
                      {(LLM_MODELS[step.provider] || []).map((model) => (
                        <MenuItem key={model} value={model}>
                          {model}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>

                  <FormControlLabel
                    control={
                      <Switch
                        checked={step.carryForwardImages !== false}
                        onChange={(e) => handleChainStepChange(index, 'carryForwardImages', e.target.checked)}
                      />
                    }
                    label="Carry forward images from previous steps"
                    sx={{ mt: 2 }}
                  />
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: 0.5 }}>
                    When enabled, any images generated or attached in previous steps will be available as attachments in this step's prompt
                  </Typography>
                </Paper>
              ))}

              <Button
                variant="outlined"
                startIcon={<Add />}
                onClick={handleAddChainStep}
                fullWidth
                sx={{ mt: 2 }}
              >
                Add Step
              </Button>

              <Alert severity="info" sx={{ mt: 3 }}>
                <Typography variant="body2">
                  <strong>Chain Execution:</strong> Steps run sequentially. Each step's output is passed to the next step as {'{previousOutput}'}.
                  You can also use standard placeholders like {'{companyInfo}'}, {'{campaignDetails}'}, etc.
                </Typography>
              </Alert>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseChainModal}>Cancel</Button>
            <Button
              onClick={handleSaveChain}
              variant="contained"
              disabled={chainSaving}
            >
              {chainSaving ? 'Saving...' : (editingChain ? 'Update' : 'Create')}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Command Mapping Create/Edit Modal */}
        <Dialog open={commandMappingModalOpen} onClose={handleCloseCommandMappingModal} maxWidth="md" fullWidth>
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

              <Divider sx={{ my: 3 }} />

              <Typography variant="h6" gutterBottom>
                Mapping Type
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                <Button
                  variant={commandMappingForm.mappingType === 'prompt' ? 'contained' : 'outlined'}
                  onClick={() => setCommandMappingForm({ ...commandMappingForm, mappingType: 'prompt' })}
                  fullWidth
                >
                  Single Prompt
                </Button>
                <Button
                  variant={commandMappingForm.mappingType === 'chain' ? 'contained' : 'outlined'}
                  onClick={() => setCommandMappingForm({ ...commandMappingForm, mappingType: 'chain' })}
                  fullWidth
                >
                  Chain
                </Button>
              </Box>

              {commandMappingForm.mappingType === 'prompt' && (
                <>
                  <TextField
                    fullWidth
                    select
                    label="Select Prompt"
                    value={commandMappingForm.promptId || ''}
                    onChange={(e) => setCommandMappingForm({ ...commandMappingForm, promptId: e.target.value })}
                    margin="normal"
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
                      <strong>Single Prompt:</strong> The selected prompt will be executed when this command is triggered.
                    </Typography>
                  </Alert>
                </>
              )}

              {commandMappingForm.mappingType === 'chain' && (
                <>
                  <TextField
                    fullWidth
                    select
                    label="Select Chain"
                    value={commandMappingForm.chainId || ''}
                    onChange={(e) => setCommandMappingForm({ ...commandMappingForm, chainId: e.target.value })}
                    margin="normal"
                    required
                  >
                    {chains.length === 0 ? (
                      <MenuItem value="" disabled>
                        No chains available. Create a chain first.
                      </MenuItem>
                    ) : (
                      chains.map((chain) => (
                        <MenuItem key={chain._id} value={chain._id}>
                          {chain.name} ({chain.steps?.length || 0} step(s))
                        </MenuItem>
                      ))
                    )}
                  </TextField>
                  <Alert severity="info" sx={{ mt: 2 }}>
                    <Typography variant="body2">
                      <strong>Chain:</strong> The selected multi-step chain will be executed sequentially.
                      Each step's output feeds into the next as {'{previousOutput}'}.
                    </Typography>
                  </Alert>
                </>
              )}
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
