import { useState, type ReactNode } from 'react';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

/** A picture at full size over the page. Escape or the × closes it. */
export default function ImageViewer({ src, title, caption, onClose }: { src: string | null; title?: string; caption?: ReactNode; onClose: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <Dialog open={Boolean(src)} onClose={onClose} maxWidth="lg" PaperProps={{ sx: { bgcolor: 'var(--bg-panel)', backgroundImage: 'none' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderBottom: '1px solid var(--border)' }}>
        <Typography noWrap sx={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{title || 'Image'}</Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        {src && !broken ? (
          <Box component="img" src={src} alt={title || ''} onError={() => setBroken(true)} sx={{ display: 'block', maxWidth: 'min(90vw, 1100px)', maxHeight: '78vh', objectFit: 'contain', borderRadius: 'var(--r-ctl)' }} />
        ) : (
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', py: 6, px: 4 }}>This image couldn’t be loaded.</Typography>
        )}
        {caption && <Box sx={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 720, textAlign: 'center', whiteSpace: 'pre-wrap' }}>{caption}</Box>}
      </Box>
    </Dialog>
  );
}
