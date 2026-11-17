import { useEffect, useState } from 'react';
import { Box, Button, IconButton } from '@mui/material';
import { Close as CloseIcon, CheckCircleOutline as OkIcon, InfoOutlined as InfoIcon, ErrorOutline as ErrorIcon } from '@mui/icons-material';
import { useToastStore, type Toast } from '../../store/toastStore';

/** Shows notify() messages, newest at the bottom, each closing by itself (hover keeps it open). */
export default function ToastHost() {
  const queue = useToastStore((s) => s.queue);
  return (
    <Box
      aria-live="polite"
      sx={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: 1500,
        bottom: { xs: 76, md: 24 }, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center',
        width: 'min(560px, calc(100vw - 24px))', pointerEvents: 'none'
      }}
    >
      {queue.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </Box>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hover || busy) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [hover, busy, toast.id, toast.duration, dismiss]);

  const Icon = toast.tone === 'error' ? ErrorIcon : toast.tone === 'info' ? InfoIcon : OkIcon;
  const color = toast.tone === 'error' ? 'var(--danger-text)' : toast.tone === 'info' ? 'var(--text-muted)' : 'var(--success)';

  return (
    <Box
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{
        pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 1, maxWidth: '100%',
        bgcolor: 'var(--bg-float)', color: 'var(--text-strong)', border: '1px solid var(--border-strong)',
        borderRadius: 'var(--r-panel)', boxShadow: 'var(--shadow-pop)', pl: 1.5, pr: 0.5, py: 0.5, minHeight: 44,
        fontSize: 14, animation: 'bp-toast-in .18s var(--ease)',
        '@keyframes bp-toast-in': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } }
      }}
    >
      <Icon aria-hidden sx={{ fontSize: 18, color, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', py: 0.5 }}>{toast.message}</Box>
      {toast.action && (
        <Button
          size="small"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
          sx={{ flexShrink: 0 }}
        >
          {toast.action.label}
        </Button>
      )}
      {toast.undo && (
        <Button
          size="small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await toast.undo!();
            } finally {
              dismiss(toast.id);
            }
          }}
          sx={{ flexShrink: 0, fontWeight: 700 }}
        >
          Undo
        </Button>
      )}
      <IconButton size="small" aria-label="Close" onClick={() => dismiss(toast.id)} sx={{ flexShrink: 0, color: 'var(--text-muted)' }}>
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}
