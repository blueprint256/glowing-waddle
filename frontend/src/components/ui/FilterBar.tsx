import { useMemo, useState, type ReactNode } from 'react';
import { Badge, Box, Button, Checkbox, Chip, IconButton, InputAdornment, ListItemButton, Popover, TextField, Typography } from '@mui/material';
import { Search as SearchIcon, FilterList as FilterIcon, Close as CloseIcon, ChevronRight as ChevronIcon, ArrowBack as BackIcon } from '@mui/icons-material';

/**
 * The one filter bar: search, quick chips, a Filter menu (each option shows how many match), and
 * the active filters as chips you remove with one click. The page keeps the values in the address
 * (so Back and shared links keep them).
 */

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
  /** A colour swatch (campaigns) or a dot (statuses). */
  color?: string;
}

export interface Facet {
  key: string;
  label: string;
  options: FacetOption[];
}

export interface QuickChip {
  key: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}

export default function FilterBar({
  search,
  onSearch,
  searchPlaceholder = 'Search',
  quick = [],
  facets = [],
  values,
  onChange,
  onClear,
  right
}: {
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  quick?: QuickChip[];
  facets?: Facet[];
  values: Record<string, string[]>;
  onChange: (key: string, values: string[]) => void;
  /** Clears search, quick chips and facets. */
  onClear?: () => void;
  /** Things on the far right (view switch, date navigation). */
  right?: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [facetKey, setFacetKey] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const activeCount = facets.reduce((n, f) => n + (values[f.key]?.length || 0), 0);
  const anything = activeCount > 0 || Boolean(search) || quick.some((q) => q.active);
  const facet = facets.find((f) => f.key === facetKey) || null;

  const closeMenu = () => {
    setAnchor(null);
    setFacetKey(null);
    setFind('');
  };

  const shownOptions = useMemo(() => {
    if (!facet) return [];
    const q = find.trim().toLowerCase();
    return q ? facet.options.filter((o) => o.label.toLowerCase().includes(q)) : facet.options;
  }, [facet, find]);

  const toggle = (key: string, value: string) => {
    const current = values[key] || [];
    onChange(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  };

  const Swatch = ({ color }: { color?: string }) =>
    color ? <Box component="span" aria-hidden sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: color, flexShrink: 0 }} /> : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {onSearch && (
          <TextField
            size="small"
            value={search || ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            inputProps={{ 'aria-label': searchPlaceholder }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18 }} />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Clear search" onClick={() => onSearch('')}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </InputAdornment>
              ) : undefined
            }}
            sx={{ width: { xs: '100%', sm: 240 } }}
          />
        )}
        {quick.map((q) => (
          <Chip
            key={q.key}
            label={q.label}
            size="small"
            clickable
            onClick={q.onToggle}
            variant={q.active ? 'filled' : 'outlined'}
            aria-pressed={q.active}
            sx={{ fontWeight: 600, ...(q.active ? { bgcolor: 'var(--primary-bg)', color: 'var(--primary-fg)', '&:hover': { bgcolor: 'var(--primary-bg-hover)' } } : {}) }}
          />
        ))}
        {facets.length > 0 && (
          <Badge badgeContent={activeCount} color="primary" invisible={!activeCount} overlap="rectangular">
            <Button size="small" variant="outlined" startIcon={<FilterIcon />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="dialog">
              Filter
            </Button>
          </Badge>
        )}
        {anything && onClear && (
          <Button size="small" onClick={onClear} sx={{ color: 'var(--text-muted)' }}>
            Clear all
          </Button>
        )}
        {right && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{right}</Box>}
      </Box>

      {activeCount > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {facets.flatMap((f) =>
            (values[f.key] || []).map((v) => {
              const o = f.options.find((x) => x.value === v);
              return (
                <Chip
                  key={`${f.key}:${v}`}
                  size="small"
                  label={
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                      <Swatch color={o?.color} />
                      <span style={{ color: 'var(--text-muted)' }}>{f.label}:</span> {o?.label || v}
                    </Box>
                  }
                  onDelete={() => toggle(f.key, v)}
                  sx={{ maxWidth: 320 }}
                />
              );
            })
          )}
        </Box>
      )}

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ sx: { width: 300, maxHeight: 440, display: 'flex', flexDirection: 'column', bgcolor: 'var(--bg-float)', backgroundImage: 'none' } }}
      >
        {!facet ? (
          <Box sx={{ py: 0.5 }} role="menu" aria-label="Filter by">
            {facets.map((f) => (
              <ListItemButton key={f.key} onClick={() => setFacetKey(f.key)} sx={{ gap: 1 }} role="menuitem">
                <Typography sx={{ flex: 1, fontSize: 14 }}>{f.label}</Typography>
                {(values[f.key]?.length || 0) > 0 && <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{values[f.key].length} chosen</Typography>}
                <ChevronIcon sx={{ fontSize: 18, color: 'var(--text-muted)' }} />
              </ListItemButton>
            ))}
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, pt: 0.5 }}>
              <IconButton size="small" aria-label="Back" onClick={() => setFacetKey(null)}>
                <BackIcon fontSize="small" />
              </IconButton>
              <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{facet.label}</Typography>
              {(values[facet.key]?.length || 0) > 0 && (
                <Button size="small" onClick={() => onChange(facet.key, [])}>
                  Clear
                </Button>
              )}
            </Box>
            {facet.options.length > 8 && (
              <Box sx={{ px: 1.5, py: 0.75 }}>
                <TextField autoFocus size="small" fullWidth placeholder={`Find a ${facet.label.toLowerCase()}`} value={find} onChange={(e) => setFind(e.target.value)} />
              </Box>
            )}
            <Box sx={{ overflowY: 'auto', py: 0.5 }} role="group" aria-label={facet.label}>
              {shownOptions.length === 0 && <Typography sx={{ px: 2, py: 1.5, fontSize: 13, color: 'var(--text-muted)' }}>Nothing to choose</Typography>}
              {shownOptions.map((o) => {
                const checked = (values[facet.key] || []).includes(o.value);
                return (
                  <ListItemButton key={o.value} onClick={() => toggle(facet.key, o.value)} sx={{ gap: 1, py: 0.25 }} role="menuitemcheckbox" aria-checked={checked}>
                    <Checkbox size="small" checked={checked} tabIndex={-1} disableRipple sx={{ p: 0.5 }} />
                    <Swatch color={o.color} />
                    <Typography sx={{ flex: 1, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</Typography>
                    {o.count !== undefined && <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.count}</Typography>}
                  </ListItemButton>
                );
              })}
            </Box>
          </>
        )}
      </Popover>
    </Box>
  );
}
