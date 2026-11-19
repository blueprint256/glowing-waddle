import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { Add, Delete, Edit, Info } from '@mui/icons-material';
import { promptAPI, commandMappingAPI, chainAPI } from '../../services/api';
import { LLM_MODELS } from './settingsShared';
import { notify } from '../../store/toastStore';
import { useConfirm } from '../../components/ui/useConfirm';
import PromptTextEditor from '../../components/Settings/PromptTextEditor';

/**
 * Settings → Prompts (admins): the prompts, multi-step chains and commands behind the app's AI
 * features (Improve caption, Plan with AI, Create image with AI…).
 */
export default function PromptsSection() {
  const [confirm, confirmDialog] = useConfirm();
  // Messages go to the shared notifications.
  const setMessage = (m: { type: 'success' | 'error'; text: string }) => notify(m.text, { tone: m.type === 'error' ? 'error' : 'success' });

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

  useEffect(() => {
    fetchPrompts();
    fetchChains();
    fetchCommandMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!(await confirm({ title: 'Delete this prompt?', body: 'Commands that use it will stop working. This can’t be undone.', action: 'Delete', danger: true }))) {
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
    if (!(await confirm({ title: 'Delete this chain?', body: 'Commands that use it will stop working. This can’t be undone.', action: 'Delete', danger: true }))) {
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
    if (!(await confirm({ title: 'Delete this command?', body: 'The feature that uses it goes back to the built-in prompt (or stops, if it has none).', action: 'Delete', danger: true }))) {
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


  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Prompts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Instructions for the AI, with placeholders the app fills in.
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
            Multi-step chains
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Several prompts run one after another, each step can use a different model.
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
            Commands
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Which prompt or chain each AI feature runs: improve-caption, refine-task-description (Improve brief), generate-campaign (Plan with AI), generate-photo (AI photos, with no words) and change-image (changing a photo). Without one, a feature uses its built-in prompt. Posters are made by the poster engine (Settings › AI), so generate-poster is no longer used.
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
          <PromptTextEditor
            label="Prompt"
            value={promptForm.details}
            onChange={(details) => setPromptForm({ ...promptForm, details })}
            rows={12}
            placeholder="Write the instructions for the AI. Insert placeholders such as {brand}, {campaign}, {brief} or {caption}; the app fills them in."
            required
          />
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

              <PromptTextEditor
                label="Prompt for this step"
                value={step.prompt}
                onChange={(v) => handleChainStepChange(index, 'prompt', v)}
                rows={6}
                helperText="{previousOutput} is the answer of the step before."
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
      {confirmDialog}
    </Box>
  );
}
