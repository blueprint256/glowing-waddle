import { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Chip
} from '@mui/material';
import {
  CalendarMonth as CalendarMonthIcon,
  ViewWeek as ViewWeekIcon
} from '@mui/icons-material';
import { Calendar as BigCalendar, momentLocalizer, View } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import '../styles/calendar.css';
import { useAuthStore } from '../store/authStore';
import { taskAPI } from '../services/api';
import { Task, TaskStatus, UserRole, Campaign, Project } from '../types';
import FilterToolbar, { FilterOptions } from '../components/FilterToolbar';

const localizer = momentLocalizer(moment);

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Task;
}

export default function CalendarView() {
  const { user } = useAuthStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('month');
  const [date, setDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Task | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editedTask, setEditedTask] = useState<Task | null>(null);
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

  // Convert tasks to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    return tasks
      .filter((task) => task.taskDate)
      .map((task) => {
        const startDate = new Date(task.taskDate!);
        const endDate = new Date(task.taskDate!);
        endDate.setHours(23, 59, 59);

        return {
          id: task._id,
          title: task.name,
          start: startDate,
          end: endDate,
          resource: task
        };
      });
  }, [tasks]);

  // Get color based on task status
  const getEventStyle = (event: CalendarEvent) => {
    const task = event.resource;
    let backgroundColor = '#6366F1'; // Default blue-purple

    switch (task.status) {
      case TaskStatus.PENDING:
        backgroundColor = '#F59E0B'; // Orange
        break;
      case TaskStatus.IN_PROGRESS:
        backgroundColor = '#3B82F6'; // Blue
        break;
      case TaskStatus.COMPLETED:
        backgroundColor = '#10B981'; // Green
        break;
    }

    return {
      style: {
        backgroundColor,
        borderRadius: '4px',
        opacity: 0.9,
        color: 'white',
        border: 'none',
        display: 'block',
        fontSize: '0.875rem',
        padding: '2px 5px'
      }
    };
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event.resource);
    setEditedTask(event.resource);
    setEditModalOpen(true);
  };

  const handleViewChange = (_event: React.MouseEvent<HTMLElement>, newView: View | null) => {
    if (newView !== null) {
      setView(newView);
    }
  };

  const handleNavigate = (newDate: Date) => {
    setDate(newDate);
  };

  const handleCloseEditModal = () => {
    setEditModalOpen(false);
    setSelectedEvent(null);
    setEditedTask(null);
  };

  const handleSaveTask = async () => {
    if (!editedTask) return;

    try {
      await taskAPI.update(editedTask._id, {
        name: editedTask.name,
        description: editedTask.description,
        status: editedTask.status,
        taskDate: editedTask.taskDate
      });

      // Reload tasks
      await loadTasks();
      handleCloseEditModal();
    } catch (error) {
      console.error('Error updating task:', error);
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
        Task Calendar
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        View and manage tasks in a calendar format with monthly and weekly views
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

      {/* View Toggle and Legend */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={handleViewChange}
          size="small"
          sx={{ backgroundColor: 'white' }}
        >
          <ToggleButton value="month" aria-label="month view">
            <CalendarMonthIcon sx={{ mr: 1 }} />
            Month
          </ToggleButton>
          <ToggleButton value="week" aria-label="week view">
            <ViewWeekIcon sx={{ mr: 1 }} />
            Week
          </ToggleButton>
        </ToggleButtonGroup>

        {/* Status Legend */}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Chip
            label="Pending"
            size="small"
            sx={{ backgroundColor: '#F59E0B', color: 'white', fontWeight: 600 }}
          />
          <Chip
            label="In Progress"
            size="small"
            sx={{ backgroundColor: '#3B82F6', color: 'white', fontWeight: 600 }}
          />
          <Chip
            label="Completed"
            size="small"
            sx={{ backgroundColor: '#10B981', color: 'white', fontWeight: 600 }}
          />
        </Box>
      </Box>

      {/* Calendar */}
      <Paper sx={{ p: 2, height: 700 }}>
        <BigCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={setView}
          date={date}
          onNavigate={handleNavigate}
          onSelectEvent={handleSelectEvent}
          eventPropGetter={getEventStyle}
          views={['month', 'week']}
          style={{ height: '100%' }}
          popup
        />
      </Paper>

      {/* Task Details/Edit Modal */}
      <Dialog
        open={editModalOpen}
        onClose={handleCloseEditModal}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Task Details
          {selectedEvent && (
            <Chip
              label={selectedEvent.status}
              size="small"
              sx={{
                ml: 2,
                backgroundColor:
                  selectedEvent.status === TaskStatus.PENDING
                    ? '#F59E0B'
                    : selectedEvent.status === TaskStatus.IN_PROGRESS
                    ? '#3B82F6'
                    : '#10B981',
                color: 'white',
                fontWeight: 600
              }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          {editedTask && (
            <Box sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="Task Name"
                value={editedTask.name}
                onChange={(e) =>
                  setEditedTask({ ...editedTask, name: e.target.value })
                }
                margin="normal"
              />

              <TextField
                fullWidth
                label="Description"
                value={editedTask.description || ''}
                onChange={(e) =>
                  setEditedTask({ ...editedTask, description: e.target.value })
                }
                margin="normal"
                multiline
                rows={3}
              />

              <FormControl fullWidth margin="normal">
                <InputLabel>Status</InputLabel>
                <Select
                  value={editedTask.status}
                  label="Status"
                  onChange={(e) =>
                    setEditedTask({
                      ...editedTask,
                      status: e.target.value as TaskStatus
                    })
                  }
                >
                  {Object.values(TaskStatus).map((status) => (
                    <MenuItem key={status} value={status}>
                      {status}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="Task Date"
                type="date"
                value={
                  editedTask.taskDate
                    ? new Date(editedTask.taskDate).toISOString().split('T')[0]
                    : ''
                }
                onChange={(e) =>
                  setEditedTask({ ...editedTask, taskDate: e.target.value })
                }
                margin="normal"
                InputLabelProps={{
                  shrink: true
                }}
              />

              <Box sx={{ mt: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  <strong>Campaign:</strong> {getCampaignName(editedTask)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  <strong>Project:</strong> {getProjectName(editedTask)}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditModal}>Cancel</Button>
          <Button onClick={handleSaveTask} variant="contained" color="primary">
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Empty State */}
      {events.length === 0 && !loading && (
        <Paper sx={{ p: 4, mt: 3, textAlign: 'center' }}>
          <Typography color="text.secondary" variant="h6">
            No tasks found
          </Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
            Try adjusting your filters or create a new task from the Details Sheet
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
