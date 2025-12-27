import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Chip,
  Breadcrumbs,
  Link,
  Button
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { projectAPI, taskAPI } from '../../services/api';
import { Project, Task } from '../../types';
import CreateTaskModal from '../../components/CreateTaskModal';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);

  useEffect(() => {
    if (id) {
      loadProject();
      loadTasks();
    }
  }, [id]);

  const loadProject = async () => {
    try {
      const res = await projectAPI.getById(id!);
      setProject(res.data.project);
    } catch (error) {
      console.error('Error loading project:', error);
    }
  };

  const loadTasks = async () => {
    try {
      const res = await taskAPI.getAll({ projectId: id });
      setTasks(res.data.tasks || []);
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  };

  const handleTaskCreated = async () => {
    await loadTasks();
    setCreateTaskModalOpen(false);
  };

  if (!project) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" onClick={() => navigate('/campaigns')}>
          Campaigns
        </Link>
        <Typography color="text.primary">{project.name}</Typography>
      </Breadcrumbs>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          {project.name}
        </Typography>
        <Typography variant="body1" paragraph>
          {project.description}
        </Typography>
        <Chip label={project.status} color="primary" />

        {project.assignments && project.assignments.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              Project Assignments
            </Typography>
            <List>
              {project.assignments.map((assignment: any, idx: number) => (
                <ListItem key={idx}>
                  <ListItemText
                    primary={
                      assignment.userId
                        ? `${assignment.userId.firstName} ${assignment.userId.lastName}`
                        : 'Unknown'
                    }
                    secondary={assignment.role}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}
      </Paper>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">
          Tasks
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateTaskModalOpen(true)}
          sx={{
            backgroundColor: '#4CAF50',
            '&:hover': { backgroundColor: '#45a049' }
          }}
        >
          Add Task
        </Button>
      </Box>
      <List>
        {tasks.map((task) => (
          <ListItem
            key={task._id}
            button
            onClick={() => navigate(`/tasks/${task._id}`)}
          >
            <ListItemText
              primary={task.name}
              secondary={`Status: ${task.status}`}
            />
            <Chip label={task.status} size="small" />
          </ListItem>
        ))}
        {tasks.length === 0 && (
          <Typography color="text.secondary">No tasks found</Typography>
        )}
      </List>

      {/* Create Task Modal */}
      {project && (
        <CreateTaskModal
          open={createTaskModalOpen}
          onClose={() => setCreateTaskModalOpen(false)}
          projectId={project._id}
          campaignId={project.campaignId}
          onTaskCreated={handleTaskCreated}
        />
      )}
    </Box>
  );
}
