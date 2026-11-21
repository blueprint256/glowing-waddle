import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Drawer, IconButton, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { Close as CloseIcon, OpenInFull as FullPageIcon } from '@mui/icons-material';
import PostEditor from './PostEditor';
import { useUnsavedGuard } from './UnsavedGuard';
import { paths } from '../../lib/paths';

/**
 * Opens any post beside the current page: add ?post=<id> to any address (useOpenPost does it).
 * ?post=new opens the same screen for a new post (useNewPost; ?newDay= and ?newCampaign= prefill it,
 * else the page's own ?campaign= filter);
 * once created, the address becomes ?post=<id> and the screen simply carries on.
 * Back closes it. On phones it slides up from the bottom. Asks before closing with unsaved changes.
 * Mounted once in the layout.
 */

const NEW_PARAMS = ['newDay', 'newCampaign'];

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

/** Open the post screen for a new post (nothing is saved until "Create post"). */
export function useNewPost() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (defaults: { day?: string; campaignId?: string } = {}) => {
      const params = new URLSearchParams(location.search);
      const replace = params.has('post');
      params.set('post', 'new');
      [...NEW_PARAMS, 'new'].forEach((k) => params.delete(k));
      if (defaults.day) params.set('newDay', defaults.day);
      if (defaults.campaignId) params.set('newCampaign', defaults.campaignId);
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
    // Several changes at once (e.g. a batch in Publishing) refresh once.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = '';
    const handler = (e: Event) => {
      last = String((e as CustomEvent).detail || '');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        ref.current(last);
      }, 150);
    };
    window.addEventListener('post:changed', handler);
    window.addEventListener('post:deleted', handler);
    return () => {
      if (timer) clearTimeout(timer);
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
  const isNew = taskId === 'new';
  const valid = isNew || Boolean(taskId && /^[a-f0-9]{24}$/i.test(taskId));
  // A new post keeps the same screen when it gets its id (no reload, nothing lost).
  const createdRef = useRef<string | null>(null);
  const [editorKey, setEditorKey] = useState(taskId || '');
  useEffect(() => {
    if (taskId && taskId === createdRef.current) return;
    createdRef.current = null;
    setEditorKey(taskId || '');
  }, [taskId]);
  // The page underneath may have set a day or campaign (e.g. the Planner's filter); new posts start there.
  const pageCampaign = params.get('newCampaign') || params.get('campaign');
  const newDefaults = useMemo(
    () => ({
      day: /^\d{4}-\d{2}-\d{2}$/.test(params.get('newDay') || '') ? params.get('newDay')! : undefined,
      campaignId: pageCampaign && /^[a-f0-9]{24}$/i.test(pageCampaign) ? pageCampaign : undefined
    }),
    // Only when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorKey]
  );
  const [title, setTitle] = useState('');
  const unsaved = useUnsavedGuard();
  const { guard, reset } = unsaved;

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
    reset();
    setTitle('');
  }, [editorKey, reset]);

  const reallyClose = useCallback(() => {
    if ((location.state as any)?.postPanel) navigate(-1);
    else {
      const next = new URLSearchParams(params);
      next.delete('post');
      if (isNew || createdRef.current) NEW_PARAMS.forEach((k) => next.delete(k));
      setParams(next, { replace: true });
    }
  }, [location.state, navigate, params, setParams, isNew]);

  /** The new post was created: the address becomes the post's (the screen stays as it is). */
  const onCreated = (id: string) => {
    createdRef.current = id;
    const next = new URLSearchParams(params);
    next.set('post', id);
    NEW_PARAMS.forEach((k) => next.delete(k));
    navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true, state: location.state });
  };

  const close = () => guard(reallyClose);
  const fullPage = () => guard(() => taskId && !isNew && navigate(paths.post(taskId)));

  if (!valid) return null;

  return (
    <>
      <Drawer
        anchor={phone ? 'bottom' : 'right'}
        open
        onClose={close}
        ModalProps={{ keepMounted: false }}
        PaperProps={{
          'aria-label': isNew ? 'New post' : title ? `Post: ${title}` : 'Post',
          sx: phone
            ? { height: '92dvh', borderRadius: '14px 14px 0 0', bgcolor: 'var(--bg-panel)', backgroundImage: 'none' }
            : { width: 'min(640px, 100vw)', bgcolor: 'var(--bg-panel)', backgroundImage: 'none', borderLeft: '1px solid var(--border)' }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, height: 48, borderBottom: '1px solid var(--border)', flex: '0 0 auto' }}>
          <Typography noWrap sx={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
            {isNew ? 'New post' : 'Post'}
          </Typography>
          {!isNew && (
            <Tooltip title="Open as a full page">
              <IconButton size="small" onClick={fullPage} aria-label="Open as a full page">
                <FullPageIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Close (Esc)">
            <IconButton size="small" onClick={close} aria-label="Close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 0 }}>
          <PostEditor
            key={editorKey}
            taskId={isNew ? null : taskId}
            defaults={isNew ? newDefaults : undefined}
            variant="panel"
            onCreated={onCreated}
            onCancel={close}
            onLoaded={(t) => setTitle(t?.name || '')}
            onDirtyChange={unsaved.setDirty}
            registerSave={unsaved.registerSave}
            onDeleted={() => {
              window.dispatchEvent(new CustomEvent('post:deleted', { detail: taskId }));
              reset();
              reallyClose();
            }}
          />
          <Box sx={{ height: 24 }} />
        </Box>
      </Drawer>

      {unsaved.dialog}
    </>
  );
}
