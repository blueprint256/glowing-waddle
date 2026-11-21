import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Send as SendIcon } from '@mui/icons-material';
import PostList from './PostList';
import PublishDialog from './PublishDialog';
import { publishingAPI, type Post } from '../../services/publishing';
import { notify } from '../../store/toastStore';
import { announcePostChanged } from '../../store/aiJobsStore';

/**
 * A post's publishing: where and when it goes out, and the Publish button. Hidden when Publishing
 * is off. Any change here also updates the post's status (Scheduled / Published / Needs attention).
 */
export default function TaskPublishing({ taskId }: { taskId: string }) {
  const [available, setAvailable] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await publishingAPI.list({ taskId, limit: 50 });
      setPosts(r.posts);
    } catch {
      setPosts([]);
    }
  }, [taskId]);

  useEffect(() => {
    let alive = true;
    publishingAPI
      .status()
      .then((s) => {
        if (!alive) return;
        setAvailable(s.available);
        if (s.available) load();
      })
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, [load]);

  // While something is going out, check back so the result shows without reloading.
  useEffect(() => {
    if (!posts.some((p) => ['publishing', 'processing'].includes(p.status))) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [posts, load]);

  if (!available) return null;

  const changed = (message?: string) => {
    if (message) notify(message);
    load();
    announcePostChanged(taskId);
  };

  return (
    <Box component="section" aria-label="Publishing">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography component="h3" sx={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
          Publishing
        </Typography>
        <Button size="small" variant="contained" startIcon={<SendIcon sx={{ fontSize: 16 }} />} onClick={() => setOpen(true)}>
          Publish or schedule
        </Button>
      </Box>
      <PostList
        posts={posts}
        showTask={false}
        onChanged={(m) => changed(m)}
        emptyText="Not scheduled yet. Publish it now, schedule it, or set a reminder to post it by hand."
      />
      <PublishDialog
        open={open}
        taskId={taskId}
        onClose={() => setOpen(false)}
        onDone={(m) => {
          setOpen(false);
          changed(m);
        }}
      />
    </Box>
  );
}
