import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Paper, Snackbar, Typography } from '@mui/material';
import { Send as SendIcon } from '@mui/icons-material';
import PostList from './PostList';
import PublishDialog from './PublishDialog';
import { publishingAPI, type Post } from '../../services/publishing';

/** Task page section: this task's posts and the Publish button. Hidden when publishing is off. */
export default function TaskPublishing({ taskId }: { taskId: string }) {
  const [available, setAvailable] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await publishingAPI.list({ taskId, limit: 50 });
      setPosts(r.posts);
    } catch {
      setPosts([]);
    }
  }, [taskId]);

  useEffect(() => {
    publishingAPI
      .status()
      .then((s) => {
        setAvailable(s.available);
        if (s.available) load();
      })
      .catch(() => setAvailable(false));
  }, [load]);

  useEffect(() => {
    if (!posts.some((p) => ['publishing', 'processing'].includes(p.status))) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [posts, load]);

  if (!available) return null;
  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Publishing
        </Typography>
        <Button variant="contained" startIcon={<SendIcon />} onClick={() => setOpen(true)}>
          Publish
        </Button>
      </Box>
      <PostList
        posts={posts}
        showTask={false}
        onChanged={(m) => {
          if (m) setToast(m);
          load();
        }}
        emptyText="Not published yet. Press Publish to post it now, schedule it, or set a post-by-hand reminder."
      />
      <PublishDialog
        open={open}
        taskId={taskId}
        onClose={() => setOpen(false)}
        onDone={(m) => {
          setOpen(false);
          setToast(m);
          load();
        }}
      />
      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Paper>
  );
}
