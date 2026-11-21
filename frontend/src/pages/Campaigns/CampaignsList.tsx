import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Menu, MenuItem, Switch, Typography } from '@mui/material';
import { Add as AddIcon, MoreVert as MoreIcon, Campaign as CampaignIcon } from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import FilterBar, { type Facet } from '../../components/ui/FilterBar';
import EmptyState from '../../components/ui/EmptyState';
import { MetaChip } from '../../components/ui/StatusChip';
import CampaignDialog, { type CampaignLike } from '../../components/campaigns/CampaignDialog';
import { campaignAPI } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import { campaignColor } from '../../lib/colors';
import { CAMPAIGN_STATUSES, campaignStatusMeta } from '../../lib/status';
import { formatDay, formatDayRange } from '../../lib/dates';
import { paths } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * Campaigns: every campaign as a card with its dates, status and how its posts are coming along.
 * Search, filters and "show archived" live in the address.
 */

interface Campaign extends CampaignLike {
  archived?: boolean;
  createdBy?: { _id: string; firstName?: string; lastName?: string; email?: string } | string;
}

interface Counts {
  posts: number;
  byStatus: Record<string, number>;
  nextDay: string | null;
}

const QUICK = [
  { key: 'running', label: 'Running', statuses: ['planning', 'active'] },
  { key: 'paused', label: 'Paused', statuses: ['paused'] },
  { key: 'finished', label: 'Finished', statuses: ['completed'] }
];

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const ownerOf = (c: Campaign) => (c.createdBy && typeof c.createdBy === 'object' ? c.createdBy : null);
const ownerName = (c: Campaign) => {
  const o = ownerOf(c);
  return o ? `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || '' : '';
};

export default function CampaignsList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const statuses = list(params.get('status'));
  const accounts = list(params.get('account'));
  const archived = params.get('archived') === '1';

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);
  const [dialog, setDialog] = useState<{ campaign?: Campaign } | null>(params.get('create') === 'true' ? {} : null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; campaign: Campaign } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<{ campaign: Campaign; scheduled: number } | null>(null);

  const update = useCallback(
    (changes: Record<string, string | string[] | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(changes)) {
        const value = Array.isArray(v) ? v.join(',') : v;
        if (value) next.set(k, value);
        else next.delete(k);
      }
      next.delete('create');
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => update({ q: search.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [search, q, update]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await campaignAPI.getAll({ limit: 1000, includeArchived: archived ? 'true' : undefined, include: 'counts' });
      setCampaigns(res.data.campaigns || []);
      setCounts(res.data.counts || {});
    } catch (e) {
      setError(errorMessage(e, 'Campaigns couldn’t load. Try again.'));
    }
  }, [archived]);

  useEffect(() => {
    load();
  }, [load]);

  // Filtering happens here (the whole list is loaded), so typing feels instant.
  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return (campaigns || []).filter((c) => {
      if (archived ? !c.archived : c.archived) return false;
      if (statuses.length && !statuses.includes(c.status || 'draft')) return false;
      if (accounts.length && !accounts.includes(ownerOf(c)?._id || '')) return false;
      if (needle && !`${c.name} ${c.description || ''} ${c.coreMessages || ''} ${(c.hashtags || []).join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [campaigns, q, statuses, accounts, archived]);

  const facets: Facet[] = useMemo(() => {
    const pool = (campaigns || []).filter((c) => (archived ? c.archived : !c.archived));
    const out: Facet[] = [
      {
        key: 'status',
        label: 'Status',
        options: CAMPAIGN_STATUSES.map((s) => ({ value: s, label: campaignStatusMeta(s).label, color: campaignStatusMeta(s).dot, count: pool.filter((c) => (c.status || 'draft') === s).length }))
      }
    ];
    if (isAdmin) {
      const owners = new Map<string, string>();
      for (const c of pool) {
        const o = ownerOf(c);
        if (o) owners.set(o._id, ownerName(c));
      }
      out.push({ key: 'account', label: 'Account', options: [...owners.entries()].map(([value, label]) => ({ value, label, count: pool.filter((c) => ownerOf(c)?._id === value).length })) });
    }
    return out;
  }, [campaigns, archived, isAdmin]);

  // Archiving cancels scheduled posts that haven't gone out, so that case asks first (and can't be undone).
  const archive = async (c: Campaign, confirmed = false) => {
    const scheduled = (counts[c._id]?.byStatus.Scheduled || 0) + (counts[c._id]?.byStatus['Needs attention'] || 0);
    if (scheduled && !confirmed) {
      setConfirmArchive({ campaign: c, scheduled });
      return;
    }
    try {
      const res = await campaignAPI.archive(c._id);
      if (res.data.cancelledPosts) {
        notify(res.data.message);
        load();
        return;
      }
      notify(`Archived “${c.name}”`, {
        undo: async () => {
          try {
            await campaignAPI.unarchive(c._id);
            load();
          } catch (e) {
            notify(errorMessage(e, 'Couldn’t restore it.'), { tone: 'error' });
          }
        }
      });
      load();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t archive the campaign.'), { tone: 'error' });
    }
  };

  const restore = async (c: Campaign) => {
    try {
      await campaignAPI.unarchive(c._id);
      notify(`Restored “${c.name}”`, { action: { label: 'Open', run: () => navigate(paths.campaign(c._id)) } });
      load();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t restore the campaign.'), { tone: 'error' });
    }
  };

  const filtered = Boolean(q || statuses.length || accounts.length);

  return (
    <Box>
      <PageHeader
        title="Campaigns"
        subtitle="A campaign groups posts for a launch, a season or an event. Everyday posts don’t need one."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>
            New campaign
          </Button>
        }
      />

      <Box sx={{ mb: 2 }}>
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search campaigns"
          quick={QUICK.map((c) => ({ key: c.key, label: c.label, active: sameSet(statuses, c.statuses), onToggle: () => update({ status: sameSet(statuses, c.statuses) ? null : c.statuses }) }))}
          facets={facets}
          values={{ status: statuses, account: accounts }}
          onChange={(key, v) => update({ [key]: v })}
          onClear={() => {
            setSearch('');
            update({ q: null, status: null, account: null });
          }}
          right={
            <FormControlLabel
              control={<Switch size="small" checked={archived} onChange={(e) => update({ archived: e.target.checked ? '1' : null })} />}
              label={<Typography sx={{ fontSize: 13 }}>Archived</Typography>}
              sx={{ mr: 0 }}
            />
          }
        />
      </Box>

      {error ? (
        <EmptyState title="Campaigns couldn’t load" text={error} action={<Button onClick={load}>Try again</Button>} />
      ) : campaigns === null ? (
        <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
          <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
        </Box>
      ) : shown.length === 0 ? (
        archived ? (
          <EmptyState icon={<CampaignIcon />} title={filtered ? 'No archived campaigns match' : 'No archived campaigns'} text="Archived campaigns are kept here and can be restored." />
        ) : filtered ? (
          <EmptyState icon={<CampaignIcon />} title="No campaigns match" text="Try fewer filters." action={<Button onClick={() => update({ q: null, status: null, account: null })}>Clear filters</Button>} />
        ) : (
          <EmptyState
            icon={<CampaignIcon />}
            title="Create your first campaign"
            text="A campaign is a season, launch or event. Add its key messages and dates, then plan posts yourself or with AI."
            action={
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>
                New campaign
              </Button>
            }
          />
        )
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 1.5 }}>
          {shown.map((c) => {
            const n = counts[c._id];
            const ready = n ? (n.byStatus.Ready || 0) + (n.byStatus.Scheduled || 0) + (n.byStatus.Published || 0) : 0;
            const attention = n?.byStatus['Needs attention'] || 0;
            return (
              <Box
                key={c._id}
                component="article"
                sx={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 1, p: 2, pl: 2.5, borderRadius: 'var(--r-panel)', border: '1px solid var(--border)', bgcolor: 'var(--bg-panel)', '&:hover': { borderColor: 'var(--border-strong)' } }}
              >
                <Box sx={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 4, borderRadius: '0 4px 4px 0', bgcolor: campaignColor(c._id) }} />
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      component={RouterLink}
                      to={paths.campaign(c._id)}
                      sx={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)', textDecoration: 'none', '&::after': { content: '""', position: 'absolute', inset: 0 }, '&:hover': { textDecoration: 'underline' } }}
                    >
                      {c.name}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {[formatDayRange(c.startDate, c.endDate) || 'No dates yet', isAdmin ? ownerName(c) : null].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  <MetaChip meta={campaignStatusMeta(c.archived ? 'archived' : c.status)} size="xs" />
                  <IconButton size="small" aria-label={`More for ${c.name}`} onClick={(e) => setMenu({ anchor: e.currentTarget, campaign: c })} sx={{ position: 'relative', zIndex: 1, mt: -0.5, mr: -1 }}>
                    <MoreIcon fontSize="small" />
                  </IconButton>
                </Box>
                {(c.description || c.coreMessages) && (
                  <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.description || c.coreMessages}</Typography>
                )}
                <Box sx={{ mt: 'auto', pt: 0.5 }}>
                  {n && n.posts > 0 ? (
                    <>
                      <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'var(--bg-subtle)', overflow: 'hidden', display: 'flex' }} aria-hidden>
                        <Box sx={{ width: `${(ready / n.posts) * 100}%`, bgcolor: 'var(--st-ready-dot)' }} />
                        <Box sx={{ width: `${(attention / n.posts) * 100}%`, bgcolor: 'var(--st-attention-dot)' }} />
                      </Box>
                      <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.75 }}>
                        {n.posts} post{n.posts === 1 ? '' : 's'} · {ready} ready or later
                        {attention ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : ''}
                        {n.nextDay ? ` · next ${formatDay(n.nextDay, { relative: true })}` : ''}
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ fontSize: 12, color: 'var(--text-faint)' }}>No posts yet</Typography>
                  )}
                </Box>
                {c.archived && (
                  <Button size="small" onClick={() => restore(c)} sx={{ alignSelf: 'flex-start', position: 'relative', zIndex: 1 }}>
                    Restore
                  </Button>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const c = menu!.campaign;
            setMenu(null);
            navigate(paths.campaign(c._id));
          }}
        >
          Open
        </MenuItem>
        <MenuItem
          onClick={() => {
            const c = menu!.campaign;
            setMenu(null);
            navigate(paths.planner({ view: 'month', campaign: c._id }));
          }}
        >
          See in the Planner
        </MenuItem>
        {!menu?.campaign.archived && (
          <MenuItem
            onClick={() => {
              const c = menu!.campaign;
              setMenu(null);
              setDialog({ campaign: c });
            }}
          >
            Edit details
          </MenuItem>
        )}
        {menu?.campaign.archived ? (
          <MenuItem
            onClick={() => {
              const c = menu!.campaign;
              setMenu(null);
              restore(c);
            }}
          >
            Restore
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              const c = menu!.campaign;
              setMenu(null);
              archive(c);
            }}
          >
            Archive
          </MenuItem>
        )}
      </Menu>

      <Dialog open={Boolean(confirmArchive)} onClose={() => setConfirmArchive(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Archive “{confirmArchive?.campaign.name}”?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            It has {confirmArchive?.scheduled} post{confirmArchive?.scheduled === 1 ? '' : 's'} waiting in Publishing. Archiving cancels {confirmArchive?.scheduled === 1 ? 'it' : 'them'}, and they won’t go out even if you restore the campaign later.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmArchive(null)}>Keep it</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const c = confirmArchive!.campaign;
              setConfirmArchive(null);
              archive(c, true);
            }}
          >
            Archive and cancel
          </Button>
        </DialogActions>
      </Dialog>

      <CampaignDialog
        open={Boolean(dialog)}
        campaign={dialog?.campaign}
        onClose={() => {
          setDialog(null);
          if (params.get('create')) update({});
        }}
        onSaved={(saved) => {
          if (dialog?.campaign) load();
          else navigate(paths.campaign(saved._id));
        }}
      />
    </Box>
  );
}
