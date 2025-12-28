import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  Select,
  MenuItem,
  FormControl,
  SelectChangeEvent,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  CalendarToday as CalendarIcon,
  Visibility as VisibilityIcon,
  Brush as BrushIcon
} from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { taskAPI, integrationsAPI } from '../services/api';
import { Task, TaskStatus, UserRole, Campaign, Project } from '../types';
import FilterToolbar, { FilterOptions } from '../components/FilterToolbar';
import SocialPreviewModal from '../components/SocialPreviewModal';

interface EditingCell {
  taskId: string;
  field: string;
}

export default function TasksSheet() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [previewTask, setPreviewTask] = useState<Task | null>(null);
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [syncingTask, setSyncingTask] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterOptions>({
    search: '',
    campaignIds: [],
    projectIds: [],
    statuses: [],
    dateFrom: '',
    dateTo: '',
    createdBy: []
  });

  // Load tasks based on filters
  useEffect(() => {
    loadTasks();
  }, [filters]);

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Check Canva connection status
  useEffect(() => {
    checkCanvaConnection();
  }, []);

  const checkCanvaConnection = async () => {
    try {
      const response = await integrationsAPI.getStatus();
      if (response.data.success) {
        setCanvaConnected(response.data.integrations.canva.connected);
      }
    } catch (error) {
      console.error('Error checking Canva connection:', error);
    }
  };

  const loadTasks = async () => {
    try {
      setLoading(true);
      setError(null);

      // Build query parameters from filters
      const params: any = { limit: 10000 };

      if (filters.search) {
        params.search = filters.search;
      }
      if (filters.campaignIds && filters.campaignIds.length > 0) {
        params.campaignId = filters.campaignIds.join(',');
      }
      if (filters.projectIds && filters.projectIds.length > 0) {
        params.projectId = filters.projectIds.join(',');
      }
      if (filters.statuses && filters.statuses.length > 0) {
        params.status = filters.statuses.join(',');
      }
      if (filters.dateFrom) {
        params.dateFrom = filters.dateFrom;
      }
      if (filters.dateTo) {
        params.dateTo = filters.dateTo;
      }
      if (filters.createdBy && filters.createdBy.length > 0 && user?.role === UserRole.SYSTEM_ADMIN) {
        params.createdBy = filters.createdBy.join(',');
      }

      const res = await taskAPI.getAll(params);
      setTasks(res.data.tasks || []);
    } catch (error: any) {
      console.error('Error loading tasks:', error);
      setError(error.response?.data?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const getCampaignName = (task: Task): string => {
    if (task.campaignId && typeof task.campaignId === 'object' && 'name' in task.campaignId) {
      return (task.campaignId as Campaign).name;
    }
    return 'Unknown Campaign';
  };

  const getProjectName = (task: Task): string => {
    if (task.projectId && typeof task.projectId === 'object' && 'name' in task.projectId) {
      return (task.projectId as Project).name;
    }
    return 'Unknown Project';
  };

  const handleEditStart = (taskId: string, field: string, currentValue: string) => {
    setEditingCell({ taskId, field });
    setEditValue(currentValue);
  };

  const handleEditCancel = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const handleEditSave = async (taskId: string, field: string) => {
    try {
      const updateData: any = {};
      updateData[field] = editValue;

      await taskAPI.update(taskId, updateData);

      // Update local state
      setTasks((prev) =>
        prev.map((task) =>
          task._id === taskId ? { ...task, [field]: editValue } : task
        )
      );

      setEditingCell(null);
      setEditValue('');
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    try {
      await taskAPI.update(taskId, { status: newStatus });

      // Update local state
      setTasks((prev) =>
        prev.map((task) =>
          task._id === taskId ? { ...task, status: newStatus } : task
        )
      );
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  const handleDateChange = async (taskId: string, newDate: string) => {
    try {
      await taskAPI.update(taskId, { taskDate: newDate });

      // Update local state
      setTasks((prev) =>
        prev.map((task) =>
          task._id === taskId ? { ...task, taskDate: newDate } : task
        )
      );
    } catch (error) {
      console.error('Error updating task date:', error);
    }
  };

  const handleEditInCanva = async (task: Task) => {
    if (!canvaConnected) {
      alert('Please connect your Canva account in Settings → Integrations before editing designs.');
      return;
    }

    try {
      const response = await taskAPI.canvaEdit(task._id);
      if (response.data.success) {
        const { editorUrl, designId } = response.data;

        // Update local state with Canva design info
        setTasks((prev) =>
          prev.map((t) =>
            t._id === task._id ? { ...t, canvaDesignId: designId, canvaDesignUrl: editorUrl } : t
          )
        );

        // Open Canva editor in new tab
        window.open(editorUrl, '_blank');
      }
    } catch (error: any) {
      console.error('Error opening Canva editor:', error);
      alert(error.response?.data?.message || 'Failed to open Canva editor. Please try again.');
    }
  };

  const handleSyncFromCanva = async (taskId: string) => {
    try {
      setSyncingTask(taskId);
      const response = await taskAPI.canvaSync(taskId);
      if (response.data.success) {
        // Update local state with synced task
        setTasks((prev) =>
          prev.map((t) =>
            t._id === taskId ? response.data.task : t
          )
        );
        alert('Design synced from Canva successfully!');
      }
    } catch (error: any) {
      console.error('Error syncing from Canva:', error);
      alert(error.response?.data?.message || 'Failed to sync from Canva. Please try again.');
    } finally {
      setSyncingTask(null);
    }
  };

  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.PENDING:
        return '#F59E0B';
      case TaskStatus.IN_PROGRESS:
        return '#3B82F6';
      case TaskStatus.COMPLETED:
        return '#10B981';
      default:
        return '#6B7280';
    }
  };

  const renderEditableCell = (
    task: Task,
    field: 'name' | 'description',
    value: string
  ) => {
    const isEditing =
      editingCell?.taskId === task._id && editingCell?.field === field;

    if (isEditing) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            inputRef={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleEditSave(task._id, field);
              } else if (e.key === 'Escape') {
                handleEditCancel();
              }
            }}
            size="small"
            fullWidth
            multiline={field === 'description'}
            rows={field === 'description' ? 2 : 1}
          />
          <IconButton size="small" onClick={() => handleEditSave(task._id, field)}>
            <CheckIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={handleEditCancel}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      );
    }

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          '&:hover .edit-icon': {
            opacity: 1
          }
        }}
      >
        <Typography variant="body2" sx={{ flex: 1 }}>
          {value || '-'}
        </Typography>
        <IconButton
          className="edit-icon"
          size="small"
          onClick={() => handleEditStart(task._id, field, value)}
          sx={{ opacity: 0, transition: 'opacity 0.2s' }}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  };

  // Group tasks by campaign for better organization
  const tasksByCampaign = tasks.reduce((acc, task) => {
    const campaignName = getCampaignName(task);
    if (!acc[campaignName]) {
      acc[campaignName] = [];
    }
    acc[campaignName].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

  if (loading && tasks.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 1 }}>
        Tasks Sheet
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Flat view of all tasks with inline editing and advanced filtering
      </Typography>

      {/* Filter Toolbar */}
      <FilterToolbar
        filters={filters}
        onFilterChange={setFilters}
        showCampaignFilter={true}
        showProjectFilter={true}
        showStatusFilter={true}
        statusType="task"
        showDateFilter={true}
        showCreatorFilter={user?.role === UserRole.SYSTEM_ADMIN}
        placeholder="Search tasks by name or description..."
      />

      {/* Tasks Table */}
      {tasks.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary" variant="h6">
            No tasks found
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
            Try adjusting your filters or create a new task from the Details Sheet
          </Typography>
        </Paper>
      ) : (
        <>
          {/* Flat Table View */}
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#F3F4F6' }}>
                  <TableCell sx={{ fontWeight: 700, width: '18%' }}>Task Name</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: '13%' }}>Campaign</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: '13%' }}>Project</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: '10%' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: '10%' }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: '26%' }}>Description</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: '10%', textAlign: 'center' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tasks.map((task, index) => (
                  <TableRow
                    key={task._id}
                    sx={{
                      backgroundColor: index % 2 === 0 ? '#FFFFFF' : '#F9FAFB',
                      '&:hover': {
                        backgroundColor: '#F3F4F6'
                      }
                    }}
                  >
                    <TableCell>{renderEditableCell(task, 'name', task.name)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="primary">
                        {getCampaignName(task)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {getProjectName(task)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={task.status}
                          onChange={(e) =>
                            handleStatusChange(task._id, e.target.value as TaskStatus)
                          }
                          sx={{
                            backgroundColor: getStatusColor(task.status),
                            color: 'white',
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            '& .MuiOutlinedInput-notchedOutline': {
                              border: 'none'
                            },
                            '& .MuiSvgIcon-root': {
                              color: 'white'
                            }
                          }}
                        >
                          {Object.values(TaskStatus).map((status) => (
                            <MenuItem key={status} value={status}>
                              {status}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell>
                      <TextField
                        type="date"
                        value={
                          task.taskDate
                            ? new Date(task.taskDate).toISOString().split('T')[0]
                            : ''
                        }
                        onChange={(e) => handleDateChange(task._id, e.target.value)}
                        size="small"
                        InputProps={{
                          startAdornment: <CalendarIcon sx={{ mr: 0.5, fontSize: '1rem', color: 'text.secondary' }} />
                        }}
                        sx={{ width: '100%' }}
                      />
                    </TableCell>
                    <TableCell>
                      {renderEditableCell(task, 'description', task.description || '')}
                    </TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        <Tooltip title="Edit in Canva - Open this image in Canva for editing">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => handleEditInCanva(task)}
                              color="secondary"
                              disabled={!canvaConnected}
                            >
                              <BrushIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Preview on Social Media">
                          <IconButton
                            size="small"
                            onClick={() => setPreviewTask(task)}
                            color="primary"
                            disabled={!task.name && !task.designedImage}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Social Preview Modal */}
          {previewTask && (
            <SocialPreviewModal
              open={!!previewTask}
              onClose={() => setPreviewTask(null)}
              task={previewTask}
            />
          )}

          {/* Summary Statistics */}
          <Paper sx={{ p: 2, backgroundColor: '#F3F4F6' }}>
            <Box sx={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: '#F59E0B' }}>
                  {tasks.filter((t) => t.status === TaskStatus.PENDING).length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Pending
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: '#3B82F6' }}>
                  {tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  In Progress
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: '#10B981' }}>
                  {tasks.filter((t) => t.status === TaskStatus.COMPLETED).length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Completed
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: '#6B7280' }}>
                  {tasks.length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Total Tasks
                </Typography>
              </Box>
            </Box>
          </Paper>
        </>
      )}
    </Box>
  );
}
