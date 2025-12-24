import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Button,
  TextField,
  List,
  ListItem,
  ListItemText,
  Divider
} from '@mui/material';
import { eventAPI, commentAPI } from '../../services/api';
import { Event, Comment } from '../../types';

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    if (id) {
      loadEvent();
      loadComments();
    }
  }, [id]);

  const loadEvent = async () => {
    try {
      const res = await eventAPI.getById(id!);
      setEvent(res.data.event);
    } catch (error) {
      console.error('Error loading event:', error);
    }
  };

  const loadComments = async () => {
    try {
      const res = await commentAPI.getAll({ eventId: id });
      setComments(res.data.comments || []);
    } catch (error) {
      console.error('Error loading comments:', error);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      await commentAPI.create({ content: newComment, eventId: id });
      setNewComment('');
      loadComments();
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  if (!event) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h4">{event.name}</Typography>
          <Chip label={event.status} color="primary" />
        </Box>
        <Typography variant="body1" paragraph>
          {event.description}
        </Typography>
        <Typography variant="subtitle2">Type: {event.type}</Typography>
        {event.scheduledDate && (
          <Typography variant="subtitle2">
            Scheduled: {new Date(event.scheduledDate).toLocaleDateString()}
          </Typography>
        )}
        {event.content && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
            <Typography variant="body2">{event.content}</Typography>
          </Box>
        )}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Comments
        </Typography>
        <Box sx={{ mb: 2 }}>
          <TextField
            fullWidth
            multiline
            rows={2}
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
          />
          <Button
            variant="contained"
            onClick={handleAddComment}
            sx={{ mt: 1 }}
            disabled={!newComment.trim()}
          >
            Add Comment
          </Button>
        </Box>
        <Divider sx={{ my: 2 }} />
        <List>
          {comments.map((comment) => (
            <ListItem key={comment._id} alignItems="flex-start">
              <ListItemText
                primary={
                  comment.authorId
                    ? `${comment.authorId.firstName} ${comment.authorId.lastName}`
                    : 'Unknown'
                }
                secondary={
                  <>
                    <Typography variant="body2" color="text.primary">
                      {comment.content}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(comment.createdAt).toLocaleString()}
                    </Typography>
                  </>
                }
              />
            </ListItem>
          ))}
          {comments.length === 0 && (
            <Typography color="text.secondary">No comments yet</Typography>
          )}
        </List>
      </Paper>
    </Box>
  );
}
