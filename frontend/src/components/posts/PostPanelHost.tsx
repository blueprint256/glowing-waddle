import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { Close as CloseIcon, OpenInFull as FullPageIcon } from '@mui/icons-material';
import PostEditor from './PostEditor';
import { paths } from '../../lib/paths';

/**
 * Opens any post beside the current page: add ?post=<id> to any address (useOpenPost does it).
 * Back closes it. On phones it slides up from the bottom. Asks before closing with unsaved changes.
 * Mounted once in the layout.
 */

/** Open a post in the side panel, staying on the current page. */
export function useOpenPost() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(location.search);
      if (params.get('post') === taskId) return;
      const replace = params.has('post'); // switching posts doesn't pile up history
      params.set('post', taskId);
      navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace, state: { postPanel: true } });
    },
    [navigate, location.pathname, location.search]
  );
}

/** Pages that list posts call this to refresh when one is changed or deleted anywhere. */
export function usePostEvents(onChange: (taskId: string) => void) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    const handler = (e: Event) => ref.current(String((e as CustomEvent).detail || ''));
    window.addEventListener('post:changed', handler);
    window.addEventListener('post:deleted', handler);
    return () => {
      window.removeEventListener('post:changed', handler);
      window.removeEventListener('post:deleted', handler);
    };
  }, []);
}

export default function PostPanelHost() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const openPost = useOpenPost();
  const phone = !useMediaQuery('(min-width: 48em)');
  const taskId = params.get('post');
  const valid = Boolean(taskId && /^[a-f0-9]{24}$/i.test(taskId));
  const [title, setTitle] = useState('');
  const dirtyRef = useRef(false);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [asking, setAsking] = useState<null | (() => void)>(null);

  // Other parts of the app (messages, Blue, the AI image job) ask to open a post.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = String((e as CustomEvent).detail || '');
      if (/^[a-f0-9]{24}$/i.test(id)) openPost(id);
    };
    window.addEventListener('post:open', onOpen);
    return () => window.removeEventListener('post:open', onOpen);
  }, [openPost]);

  useEffect(() => {
    dirtyRef.current = false;
    setTitle('');
  }, [taskId]);

  const reallyClose = useCallback(() => {
    if ((location.state as any)?.postPanel) navigate(-1);
    else {
      const next = new URLSearchParams(params);
      next.delete('post');
      setParams(next, { replace: true });
    }
  }, [location.state, navigate, params, setParams]);

  /** Runs `then` now, or after asking when there are unsaved changes. */
  const guard = useCallback((then: () => void) => {
    if (dirtyRef.current) setAsking(() => then);
    else then();
  }, []);

  const close = () => guard(reallyClose);
  const fullPage = () => guard(() => taskId && navigate(paths.post(taskId)));

  if (!valid) return null;

  return (
    <>
      <Drawer
        anchor={phone ? 'bottom' : 'right'}
        open
        onClose={close}
        ModalProps={{ keepMounted: false }}
        PaperProps={{
          'aria-label': title ? `Post: ${title}` : 'Post',
          sx: phone
            ? { height: '92dvh', borderRadius: '14px 14px 0 0', bgcolor: 'var(--bg-panel)', backgroundImage: 'none' }
            : { width: 'min(640px, 100vw)', bgcolor: 'var(--bg-panel)', backgroundImage: 'none', borderLeft: '1px solid var(--border)' }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, height: 48, borderBottom: '1px solid var(--border)', flex: '0 0 auto' }}>
          <Typography noWrap sx={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
            Post
          </Typography>
          <Tooltip title="Open as a full page">
            <IconButton size="small" onClick={fullPage} aria-label="Open as a full page">
              <FullPageIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Close (Esc)">
            <IconButton size="small" onClick={close} aria-label="Close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 0 }}>
          <PostEditor
            key={taskId!}
            taskId={taskId!}
            variant="panel"
            onLoaded={(t) => setTitle(t?.name || '')}
            onDirtyChange={(d) => {
              dirtyRef.current = d;
            }}
            registerSave={(save) => {
              saveRef.current = save;
            }}
            onDeleted={() => {
              window.dispatchEvent(new CustomEvent('post:deleted', { detail: taskId }));
              dirtyRef.current = false;
              reallyClose();
            }}
          />
          <Box sx={{ height: 24 }} />
        </Box>
      </Drawer>

      <Dialog open={Boolean(asking)} onClose={() => setAsking(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Save your changes?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>You changed this post’s title, caption or brief.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(null)}>Keep editing</Button>
          <Button
            color="error"
            onClick={() => {
              const then = asking;
              dirtyRef.current = false;
              setAsking(null);
              then?.();
            }}
          >
            Discard
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              const then = asking;
              const ok = saveRef.current ? await saveRef.current() : true;
              if (!ok) return;
              dirtyRef.current = false;
              setAsking(null);
              then?.();
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
