import { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

/** What an empty page or list says: what goes here, and the one thing to do next. */
export default function EmptyState({
  icon,
  title,
  text,
  action,
  compact
}: {
  icon?: ReactNode;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Box
      sx={{
        textAlign: 'center', mx: 'auto', maxWidth: 440, py: compact ? 3 : 6, px: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1
      }}
    >
      {icon && (
        <Box aria-hidden sx={{ color: 'var(--text-faint)', '& svg': { fontSize: compact ? 32 : 44 }, mb: 0.5 }}>
          {icon}
        </Box>
      )}
      <Typography component="h2" sx={{ fontSize: compact ? 15 : 17, fontWeight: 600, color: 'var(--text-strong)' }}>
        {title}
      </Typography>
      {text && <Typography component="div" sx={{ fontSize: 14, color: 'var(--text-muted)' }}>{text}</Typography>}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Box>
  );
}
