import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { projectAPI } from '../services/api';
import { paths, refId } from '../lib/paths';

/**
 * Old addresses keep working (links in Inbox messages, Blue and Claude chats, emails, bookmarks):
 * each one sends you to where that page lives now.
 */

/** /tasks/:id → /posts/:id (keeps ?canvaEdit= and other parameters). */
export function OldTaskRedirect() {
  const { id } = useParams<{ id: string }>();
  const { search } = useLocation();
  return <Navigate to={`${paths.post(id)}${search}`} replace />;
}

/** /projects/:id → the theme inside its campaign. */
export function OldProjectRedirect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    projectAPI
      .getById(id!)
      .then((r) => {
        if (!alive) return;
        const campaign = refId(r.data.project?.campaignId);
        navigate(campaign ? paths.campaign(campaign, { theme: id }) : paths.campaigns(), { replace: true });
      })
      .catch(() => alive && navigate(paths.campaigns(), { replace: true }));
    return () => {
      alive = false;
    };
  }, [id, navigate]);
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
      <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
    </Box>
  );
}
