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
  Link
} from '@mui/material';
import { projectAPI, eventAPI } from '../../services/api';
import { Project, Event } from '../../types';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    if (id) {
      loadProject();
      loadEvents();
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

  const loadEvents = async () => {
    try {
      const res = await eventAPI.getAll({ projectId: id });
      setEvents(res.data.events || []);
    } catch (error) {
      console.error('Error loading events:', error);
    }
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
              Team Assignments
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

      <Typography variant="h5" gutterBottom>
        Events
      </Typography>
      <List>
        {events.map((event) => (
          <ListItem
            key={event._id}
            button
            onClick={() => navigate(`/events/${event._id}`)}
          >
            <ListItemText
              primary={event.name}
              secondary={`Type: ${event.type} | Status: ${event.status}`}
            />
            <Chip label={event.status} size="small" />
          </ListItem>
        ))}
        {events.length === 0 && (
          <Typography color="text.secondary">No events found</Typography>
        )}
      </List>
    </Box>
  );
}
