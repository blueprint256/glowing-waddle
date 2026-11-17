import { createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Dialog, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon, OpenInNew as OpenIcon } from '@mui/icons-material';
import { useBlueStore, type BlueDetailRef } from '../../store/blueStore';

/**
 * Where the chat is showing: the side panel next to another page, or the full-screen Blue page.
 * On the full-screen page, clicking a task, campaign, project or Library item opens it in the
 * right-hand panel instead of leaving the chat.
 */
export type BlueSurface = 'panel' | 'page';

export const BlueSurfaceContext = createContext<BlueSurface>('panel');

export const useBlueSurface = () => useContext(BlueSurfaceContext);

const DETAIL_PATH = /^\/(tasks|library|campaigns|projects)\/([a-f0-9]{24})\/?$/i;
const TYPES: Record<string, BlueDetailRef['type']> = { tasks: 'task', library: 'library', campaigns: 'campaign', projects: 'project' };

export function pathFrom(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/** Returns a click handler for a link from a chat card (or undefined when there's nothing to open). */
export function useBlueOpen() {
  const navigate = useNavigate();
  const surface = useBlueSurface();
  const showDetail = useBlueStore((s) => s.showDetail);
  return (url?: string | null, preview?: any) => {
    const path = pathFrom(url);
    if (!path) return undefined;
    const m = surface === 'page' ? path.split('?')[0].match(DETAIL_PATH) : null;
    if (m) return () => showDetail({ type: TYPES[m[1].toLowerCase()], id: m[2], preview });
    return () => navigate(path);
  };
}

/** A full-size image over the page, with a link to where it lives. Used by chat galleries in the side panel. */
export function ImageLightbox({
  src,
  title,
  caption,
  openUrl,
  onClose
}: {
  src: string | null;
  title?: string;
  caption?: ReactNode;
  openUrl?: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [broken, setBroken] = useState(false);
  const path = pathFrom(openUrl);
  return (
    <Dialog open={Boolean(src)} onClose={onClose} maxWidth="lg" PaperProps={{ sx: { bgcolor: 'var(--bg-panel)', backgroundImage: 'none' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderBottom: '1px solid var(--border)' }}>
        <Typography noWrap sx={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{title || 'Image'}</Typography>
        {path && (
          <Button
            size="small"
            startIcon={<OpenIcon sx={{ fontSize: 16 }} />}
            onClick={() => {
              onClose();
              navigate(path);
            }}
          >
            Open
          </Button>
        )}
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        {src && !broken ? (
          <Box
            component="img"
            src={src}
            alt={title || ''}
            onError={() => setBroken(true)}
            sx={{ display: 'block', maxWidth: 'min(90vw, 1000px)', maxHeight: '75vh', objectFit: 'contain', borderRadius: 'var(--r-ctl)' }}
          />
        ) : (
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', py: 6, px: 4 }}>This image couldn’t be loaded.</Typography>
        )}
        {caption && <Box sx={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 720, textAlign: 'center' }}>{caption}</Box>}
      </Box>
    </Dialog>
  );
}
