import { type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { ChevronRight as ChevronIcon } from '@mui/icons-material';

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * The top of every page: optional breadcrumbs, the title, a short description, and the page's
 * actions on the right (the main one last). Wraps under the title on narrow screens.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
  below
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  /** Tabs or a filter bar that belong to the header. */
  below?: ReactNode;
}) {
  return (
    <Box component="header" sx={{ mb: 2.5 }}>
      {crumbs && crumbs.length > 0 && (
        <Box component="nav" aria-label="Breadcrumb" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25, mb: 0.75, fontSize: 13 }}>
          {crumbs.map((c, i) => (
            <Box key={`${c.label}-${i}`} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
              {i > 0 && <ChevronIcon aria-hidden sx={{ fontSize: 16, color: 'var(--text-faint)' }} />}
              {c.to ? (
                <Box
                  component={RouterLink}
                  to={c.to}
                  sx={{ color: 'var(--text-muted)', textDecoration: 'none', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { color: 'var(--text-strong)', textDecoration: 'underline' } }}
                >
                  {c.label}
                </Box>
              ) : (
                <Box component="span" aria-current="page" sx={{ color: 'var(--text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.label}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0, flex: '1 1 260px' }}>
          <Typography component="h1" sx={{ fontSize: { xs: 21, md: 24 }, fontWeight: 650, color: 'var(--text-strong)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          {subtitle && <Typography component="div" sx={{ fontSize: 14, color: 'var(--text-muted)', mt: 0.5 }}>{subtitle}</Typography>}
        </Box>
        {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flexShrink: 0 }}>{actions}</Box>}
      </Box>
      {below && <Box sx={{ mt: 2 }}>{below}</Box>}
    </Box>
  );
}
