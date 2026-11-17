import { Box, Tooltip } from '@mui/material';
import { postStatusMeta, type StatusMeta } from '../../lib/status';

/**
 * The one way statuses are shown: a small tinted chip, or a dot for tight spaces (calendar cards).
 * Colours and labels come from lib/status.ts.
 */

export function MetaChip({ meta, size = 'sm' }: { meta: StatusMeta; size?: 'xs' | 'sm' }) {
  const chip = (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0, whiteSpace: 'nowrap',
        height: size === 'xs' ? 18 : 22, px: size === 'xs' ? '6px' : '8px', borderRadius: 'var(--r-full)',
        fontSize: size === 'xs' ? 11 : 12, fontWeight: 600, lineHeight: 1,
        bgcolor: meta.bg, color: meta.fg
      }}
    >
      <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: meta.dot, flexShrink: 0 }} />
      {meta.label}
    </Box>
  );
  return meta.hint ? (
    <Tooltip title={meta.hint} enterDelay={400}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

/** A post's status (Idea, Draft, Ready, Scheduled, Published, Needs attention). */
export function PostStatusChip({ status, size }: { status: unknown; size?: 'xs' | 'sm' }) {
  return <MetaChip meta={postStatusMeta(status)} size={size} />;
}

/** Just the colour, with the label for screen readers and on hover. */
export function StatusDot({ status, size = 8 }: { status: unknown; size?: number }) {
  const meta = postStatusMeta(status);
  return (
    <Tooltip title={meta.label} enterDelay={300}>
      <Box
        component="span"
        role="img"
        aria-label={meta.label}
        sx={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', bgcolor: meta.dot, flexShrink: 0 }}
      />
    </Tooltip>
  );
}
