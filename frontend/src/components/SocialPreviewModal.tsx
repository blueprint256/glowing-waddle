import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Tabs,
  Tab,
  Typography,
  IconButton,
  Avatar,
  Divider,
  Paper,
  TextField,
} from '@mui/material';
import {
  Close as CloseIcon,
  FavoriteBorder as FavoriteIcon,
  ChatBubbleOutline as CommentIcon,
  Send as SendIcon,
  BookmarkBorder as BookmarkIcon,
  MoreHoriz as MoreIcon,
  Repeat as RetweetIcon,
  ThumbUpOutlined as ThumbUpIcon,
  Share as ShareIcon,
} from '@mui/icons-material';

interface SocialPreviewModalProps {
  open: boolean;
  onClose: () => void;
  task: {
    _id?: string;
    name: string;
    description?: string;
    content?: string;
    designedImage?: string;
    taskDate?: string;
  };
  editable?: boolean;
  onSave?: (taskId: string, description: string) => Promise<void>;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box>{children}</Box>}
    </div>
  );
};

const SocialPreviewModal: React.FC<SocialPreviewModalProps> = ({
  open,
  onClose,
  task,
  editable = false,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEditedDescription(task?.description || task?.content || '');
    }
  }, [open, task]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleSave = async () => {
    if (!task._id || !onSave) return;

    try {
      setSaving(true);
      await onSave(task._id, editedDescription);
      onClose();
    } catch (error) {
      console.error('Error saving description:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCaption = () => {
    const description = editable ? editedDescription : (task.description || task.content || '');
    const caption = `${task.name}\n\n${description}`;
    navigator.clipboard.writeText(caption.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  };

  const formatCaption = () => {
    let caption = task.name;
    const description = editable ? editedDescription : (task.description || task.content || '');
    if (description) caption += `\n\n${description}`;
    return caption;
  };

  // Instagram Feed Preview
  const InstagramFeedPreview = () => (
    <Paper
      elevation={3}
      sx={{
        maxWidth: 500,
        margin: '0 auto',
        backgroundColor: '#fff',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {/* Instagram Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1.5, gap: 1 }}>
        <Avatar sx={{ width: 32, height: 32, backgroundColor: '#E1306C' }}>U</Avatar>
        <Typography variant="subtitle2" fontWeight="bold">
          your_account
        </Typography>
        <Box sx={{ ml: 'auto' }}>
          <IconButton size="small">
            <MoreIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Image */}
      <Box
        sx={{
          width: '100%',
          aspectRatio: '1 / 1',
          backgroundColor: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {task.designedImage ? (
          <img
            src={task.designedImage}
            alt={task.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            No image
          </Typography>
        )}
      </Box>

      {/* Action buttons */}
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1, gap: 1 }}>
        <IconButton size="small">
          <FavoriteIcon />
        </IconButton>
        <IconButton size="small">
          <CommentIcon />
        </IconButton>
        <IconButton size="small">
          <SendIcon />
        </IconButton>
        <Box sx={{ ml: 'auto' }}>
          <IconButton size="small">
            <BookmarkIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Likes */}
      <Box sx={{ px: 2, pb: 0.5 }}>
        <Typography variant="subtitle2" fontWeight="bold">
          0 likes
        </Typography>
      </Box>

      {/* Caption */}
      <Box sx={{ px: 2, pb: 1.5 }}>
        <Typography variant="body2" component="div">
          <Typography component="span" fontWeight="bold" variant="body2">
            your_account
          </Typography>{' '}
          {formatCaption()}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {task.taskDate ? new Date(task.taskDate).toLocaleDateString() : 'Just now'}
        </Typography>
      </Box>
    </Paper>
  );

  // Instagram Story Preview
  const InstagramStoryPreview = () => (
    <Paper
      elevation={3}
      sx={{
        maxWidth: 350,
        margin: '0 auto',
        backgroundColor: '#000',
        borderRadius: 2,
        overflow: 'hidden',
        aspectRatio: '9 / 16',
        position: 'relative',
      }}
    >
      {/* Story Header */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)',
          p: 1.5,
          zIndex: 10,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Avatar sx={{ width: 28, height: 28, backgroundColor: '#E1306C' }}>U</Avatar>
          <Typography variant="caption" sx={{ color: '#fff', fontWeight: 'bold' }}>
            your_account
          </Typography>
          <Typography variant="caption" sx={{ color: '#fff', opacity: 0.7 }}>
            Just now
          </Typography>
        </Box>
      </Box>

      {/* Story Image */}
      <Box
        sx={{
          width: '100%',
          height: '100%',
          backgroundColor: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {task.designedImage ? (
          <img
            src={task.designedImage}
            alt={task.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <Typography variant="body2" sx={{ color: '#666' }}>
            No image
          </Typography>
        )}
      </Box>

      {/* Story Caption (if text exists) */}
      {(task.name || task.description) && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 80,
            left: 16,
            right: 16,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: 1,
            p: 1.5,
          }}
        >
          <Typography variant="body2" sx={{ color: '#fff' }}>
            {task.name}
          </Typography>
        </Box>
      )}

      {/* Story Actions */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 16,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <Box
          sx={{
            flex: 1,
            mx: 2,
            border: '1px solid rgba(255,255,255,0.5)',
            borderRadius: 20,
            px: 2,
            py: 0.75,
            backgroundColor: 'rgba(0,0,0,0.3)',
          }}
        >
          <Typography variant="caption" sx={{ color: '#fff' }}>
            Send message
          </Typography>
        </Box>
      </Box>
    </Paper>
  );

  // Facebook Post Preview
  const FacebookPreview = () => (
    <Paper
      elevation={3}
      sx={{
        maxWidth: 550,
        margin: '0 auto',
        backgroundColor: '#fff',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {/* Facebook Header */}
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 40, height: 40, backgroundColor: '#1877F2' }}>U</Avatar>
          <Box>
            <Typography variant="subtitle2" fontWeight="bold">
              Your Name
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {task.taskDate ? new Date(task.taskDate).toLocaleDateString() : 'Just now'} · 🌎
            </Typography>
          </Box>
          <Box sx={{ ml: 'auto' }}>
            <IconButton size="small">
              <MoreIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Post Text */}
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body1">{formatCaption()}</Typography>
        </Box>
      </Box>

      {/* Image */}
      {task.designedImage && (
        <Box
          sx={{
            width: '100%',
            maxHeight: 500,
            backgroundColor: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <img
            src={task.designedImage}
            alt={task.name}
            style={{
              width: '100%',
              maxHeight: '500px',
              objectFit: 'contain',
            }}
          />
        </Box>
      )}

      {/* Engagement Stats */}
      <Box sx={{ px: 2, py: 1, borderTop: '1px solid #e4e6eb' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            0 reactions
          </Typography>
          <Typography variant="caption" color="text.secondary">
            0 comments · 0 shares
          </Typography>
        </Box>
      </Box>

      {/* Action buttons */}
      <Divider />
      <Box sx={{ display: 'flex', justifyContent: 'space-around', p: 0.5 }}>
        <Button startIcon={<ThumbUpIcon />} sx={{ flex: 1, color: '#65676B' }}>
          Like
        </Button>
        <Button startIcon={<CommentIcon />} sx={{ flex: 1, color: '#65676B' }}>
          Comment
        </Button>
        <Button startIcon={<ShareIcon />} sx={{ flex: 1, color: '#65676B' }}>
          Share
        </Button>
      </Box>
    </Paper>
  );

  // Twitter/X Preview
  const TwitterPreview = () => {
    const tweetText = formatCaption();
    const displayText = tweetText.length > 280 ? truncateText(tweetText, 280) : tweetText;
    const isTruncated = tweetText.length > 280;

    return (
      <Paper
        elevation={3}
        sx={{
          maxWidth: 600,
          margin: '0 auto',
          backgroundColor: '#fff',
          borderRadius: 2,
          border: '1px solid #e1e8ed',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ p: 2 }}>
          {/* Twitter Header */}
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Avatar sx={{ width: 48, height: 48, backgroundColor: '#1DA1F2' }}>U</Avatar>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="subtitle2" fontWeight="bold">
                  Your Name
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  @yourusername
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  · {task.taskDate ? new Date(task.taskDate).toLocaleDateString() : 'now'}
                </Typography>
              </Box>

              {/* Tweet Text */}
              <Box sx={{ mt: 0.5 }}>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                  {displayText}
                  {isTruncated && (
                    <Typography component="span" color="primary" sx={{ ml: 0.5 }}>
                      Show more
                    </Typography>
                  )}
                </Typography>
                {isTruncated && (
                  <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                    Note: Text exceeds 280 character limit
                  </Typography>
                )}
              </Box>

              {/* Image */}
              {task.designedImage && (
                <Box
                  sx={{
                    mt: 1.5,
                    borderRadius: 2,
                    overflow: 'hidden',
                    border: '1px solid #e1e8ed',
                    maxHeight: 400,
                  }}
                >
                  <img
                    src={task.designedImage}
                    alt={task.name}
                    style={{
                      width: '100%',
                      maxHeight: '400px',
                      objectFit: 'cover',
                    }}
                  />
                </Box>
              )}

              {/* Engagement Stats */}
              <Box sx={{ display: 'flex', gap: 4, mt: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}>
                  <CommentIcon sx={{ fontSize: 18, color: '#536471' }} />
                  <Typography variant="caption" color="text.secondary">
                    0
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}>
                  <RetweetIcon sx={{ fontSize: 18, color: '#536471' }} />
                  <Typography variant="caption" color="text.secondary">
                    0
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}>
                  <FavoriteIcon sx={{ fontSize: 18, color: '#536471' }} />
                  <Typography variant="caption" color="text.secondary">
                    0
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}>
                  <ShareIcon sx={{ fontSize: 18, color: '#536471' }} />
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </Paper>
    );
  };

  // LinkedIn Preview
  const LinkedInPreview = () => (
    <Paper
      elevation={3}
      sx={{
        maxWidth: 550,
        margin: '0 auto',
        backgroundColor: '#fff',
        borderRadius: 2,
        border: '1px solid #e0e0e0',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 2 }}>
        {/* LinkedIn Header */}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Avatar sx={{ width: 48, height: 48, backgroundColor: '#0A66C2' }}>U</Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight="bold">
              Your Name
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Your Professional Title
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              {task.taskDate ? new Date(task.taskDate).toLocaleDateString() : 'Just now'} · 🌎
            </Typography>
          </Box>
          <Box>
            <IconButton size="small">
              <MoreIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Post Text */}
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
            {formatCaption()}
          </Typography>
        </Box>
      </Box>

      {/* Image */}
      {task.designedImage && (
        <Box
          sx={{
            width: '100%',
            maxHeight: 500,
            backgroundColor: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <img
            src={task.designedImage}
            alt={task.name}
            style={{
              width: '100%',
              maxHeight: '500px',
              objectFit: 'contain',
            }}
          />
        </Box>
      )}

      {/* Engagement Stats */}
      <Box sx={{ px: 2, py: 1 }}>
        <Typography variant="caption" color="text.secondary">
          0 reactions · 0 comments
        </Typography>
      </Box>

      {/* Action buttons */}
      <Divider />
      <Box sx={{ display: 'flex', justifyContent: 'space-around', p: 0.5 }}>
        <Button startIcon={<ThumbUpIcon />} sx={{ flex: 1, color: '#5E5E5E', textTransform: 'none' }}>
          Like
        </Button>
        <Button startIcon={<CommentIcon />} sx={{ flex: 1, color: '#5E5E5E', textTransform: 'none' }}>
          Comment
        </Button>
        <Button startIcon={<RetweetIcon />} sx={{ flex: 1, color: '#5E5E5E', textTransform: 'none' }}>
          Repost
        </Button>
        <Button startIcon={<SendIcon />} sx={{ flex: 1, color: '#5E5E5E', textTransform: 'none' }}>
          Send
        </Button>
      </Box>
    </Paper>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography variant="h6" component="div">
          {editable ? 'Edit Description - Live Preview' : 'Social Media Preview'}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {editable && (
          <Box sx={{ p: 3, backgroundColor: '#fff', borderBottom: '1px solid #e0e0e0' }}>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              Edit Description
            </Typography>
            <TextField
              multiline
              rows={4}
              fullWidth
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              placeholder="Enter description for your social media post..."
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px'
                }
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Changes will reflect in the preview below in real-time
            </Typography>
          </Box>
        )}

        <Box sx={{ borderBottom: 1, borderColor: 'divider', backgroundColor: '#fafafa' }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ px: 2 }}
          >
            <Tab label="Instagram Feed" />
            <Tab label="Instagram Story" />
            <Tab label="Facebook" />
            <Tab label="Twitter/X" />
            <Tab label="LinkedIn" />
          </Tabs>
        </Box>

        <Box sx={{ p: 3, backgroundColor: '#f5f5f5', minHeight: 400 }}>
          <TabPanel value={activeTab} index={0}>
            <InstagramFeedPreview />
          </TabPanel>
          <TabPanel value={activeTab} index={1}>
            <InstagramStoryPreview />
          </TabPanel>
          <TabPanel value={activeTab} index={2}>
            <FacebookPreview />
          </TabPanel>
          <TabPanel value={activeTab} index={3}>
            <TwitterPreview />
          </TabPanel>
          <TabPanel value={activeTab} index={4}>
            <LinkedInPreview />
          </TabPanel>
        </Box>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {editable ? 'Preview updates in real-time as you type' : 'This is a preview only - no content will be posted'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {editable ? (
            <>
              <Button onClick={onClose} variant="outlined" size="small" disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                variant="contained"
                size="small"
                disabled={saving}
                sx={{
                  backgroundColor: '#1976D2',
                  '&:hover': {
                    backgroundColor: '#1565C0'
                  }
                }}
              >
                {saving ? 'Saving...' : 'Save Description'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleCopyCaption} variant="outlined" size="small">
                {copied ? 'Copied!' : 'Copy Caption'}
              </Button>
              <Button onClick={onClose} variant="contained" size="small">
                Close
              </Button>
            </>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default SocialPreviewModal;
