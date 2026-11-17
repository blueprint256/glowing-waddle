import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Dialog, InputBase, Typography } from '@mui/material';
import {
  Search as SearchIcon,
  Article as PostIcon,
  Campaign as CampaignIcon,
  Layers as ThemeIcon,
  PhotoLibrary as LibraryIcon,
  ArrowForward as GoIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { campaignAPI, projectAPI, taskAPI } from '../../services/api';
import { libraryAPI, librarySrc } from '../../services/library';
import { useAuthStore } from '../../store/authStore';
import { useBlueStore } from '../../store/blueStore';
import { UserRole } from '../../types';
import { paths, refId } from '../../lib/paths';
import { formatDay } from '../../lib/dates';
import { postStatusMeta } from '../../lib/status';
import { useOpenPost } from '../posts/PostPanelHost';
import { BlueMark } from '../Blue/BlueChat';

/**
 * Ctrl/⌘ + K: find anything (posts, campaigns, themes, Library items) or go to a page, from
 * anywhere. Arrow keys move, Enter opens, Esc closes. Also opened by the search button in the menu
 * ("search:open" event).
 */

interface Result {
  key: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  image?: string;
  run: () => void;
}

export function openSearch() {
  window.dispatchEvent(new CustomEvent('search:open'));
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const openPost = useOpenPost();
  const { user } = useAuthStore();
  const toggleBlue = useBlueStore((s) => s.toggle);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const libraryOn = user?.libraryEnabled !== false;
  const blueOn = user?.assistantEnabled !== false;

  // Ctrl/⌘ + K anywhere (also while typing), and the menu's search button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('search:open', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('search:open', onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQ('');
      setFound([]);
      setActive(0);
    }
  }, [open]);

  const close = () => setOpen(false);
  const go = useCallback(
    (fn: () => void) => () => {
      setOpen(false);
      fn();
    },
    []
  );

  // Pages and actions, always available and filtered by what's typed.
  const shortcuts: Result[] = useMemo(() => {
    const list: Result[] = [
      { key: 'new-post', group: 'Actions', title: 'New post', icon: <AddIcon />, run: go(() => navigate(`${paths.planner({ view: 'list' })}&new=1`)) },
      ...(blueOn ? [{ key: 'blue', group: 'Actions', title: 'Ask Blue', subtitle: 'Ctrl + J', icon: <BlueMark size={18} />, run: go(toggleBlue) }] : []),
      { key: 'p-today', group: 'Go to', title: 'Today', icon: <GoIcon />, run: go(() => navigate(paths.today())) },
      { key: 'p-planner', group: 'Go to', title: 'Planner', icon: <GoIcon />, run: go(() => navigate(paths.planner())) },
      { key: 'p-campaigns', group: 'Go to', title: 'Campaigns', icon: <GoIcon />, run: go(() => navigate(paths.campaigns())) },
      { key: 'p-inbox', group: 'Go to', title: 'Inbox', icon: <GoIcon />, run: go(() => navigate(paths.inbox())) },
      ...(libraryOn ? [{ key: 'p-library', group: 'Go to', title: 'Library', icon: <GoIcon />, run: go(() => navigate(paths.library())) }] : []),
      ...(user?.publishingEnabled !== false ? [{ key: 'p-publishing', group: 'Go to', title: 'Publishing', icon: <GoIcon />, run: go(() => navigate(paths.publishing())) }] : []),
      { key: 'p-brand', group: 'Go to', title: 'Settings › Brand', icon: <GoIcon />, run: go(() => navigate(paths.settings('brand'))) },
      { key: 'p-profile', group: 'Go to', title: 'Settings › Profile', icon: <GoIcon />, run: go(() => navigate(paths.settings('profile'))) },
      ...(isAdmin
        ? [
            { key: 'p-users', group: 'Go to', title: 'Users', icon: <GoIcon />, run: go(() => navigate(paths.adminUsers())) },
            { key: 'p-ai', group: 'Go to', title: 'Settings › AI', icon: <GoIcon />, run: go(() => navigate(paths.settings('ai'))) }
          ]
        : [])
    ];
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((r) => r.title.toLowerCase().includes(needle)) : list;
  }, [q, go, navigate, toggleBlue, blueOn, libraryOn, isAdmin, user?.publishingEnabled]);

  // Things in the app, a moment after typing stops.
  useEffect(() => {
    const needle = q.trim();
    if (!open || needle.length < 2) {
      setFound([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const [posts, campaigns, themes, items] = await Promise.all([
        taskAPI.getAll({ search: needle, limit: 6, sort: 'recent' }).then((r) => r.data.tasks || []).catch(() => []),
        campaignAPI.getAll({ search: needle, limit: 4 }).then((r) => r.data.campaigns || []).catch(() => []),
        projectAPI.getAll({ search: needle, limit: 4 }).then((r) => r.data.projects || []).catch(() => []),
        libraryOn ? libraryAPI.search({ q: needle, limit: 4 }).then((r) => r.items).catch(() => []) : Promise.resolve([])
      ]);
      if (mine !== seq.current) return;
      const out: Result[] = [
        ...posts.map((p: any) => ({
          key: `post-${p._id}`,
          group: 'Posts',
          title: p.name,
          subtitle: [postStatusMeta(p.status).label, p.taskDate ? formatDay(p.taskDate) : 'No day yet', p.campaignId?.name].filter(Boolean).join(' · '),
          icon: <PostIcon />,
          image: p.designedImage,
          run: go(() => openPost(p._id))
        })),
        ...campaigns.map((c: any) => ({ key: `c-${c._id}`, group: 'Campaigns', title: c.name, icon: <CampaignIcon />, run: go(() => navigate(paths.campaign(c._id))) })),
        ...themes.map((t: any) => ({
          key: `t-${t._id}`,
          group: 'Themes',
          title: t.name,
          subtitle: t.campaignId?.name,
          icon: <ThemeIcon />,
          run: go(() => navigate(refId(t.campaignId) ? paths.campaign(refId(t.campaignId), { theme: t._id }) : paths.campaigns()))
        })),
        ...items.map((i: any) => ({
          key: `l-${i.id}`,
          group: 'Library',
          title: i.title,
          subtitle: i.event || undefined,
          icon: <LibraryIcon />,
          image: librarySrc(i.thumbnailUrl),
          run: go(() => navigate(paths.libraryItem(i.id)))
        }))
      ];
      setFound(out);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, libraryOn, go, navigate, openPost]);

  const results = useMemo(() => [...found, ...shortcuts], [found, shortcuts]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth PaperProps={{ sx: { alignSelf: 'flex-start', mt: { xs: 2, sm: '12vh' }, overflow: 'hidden' } }} aria-label="Search">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderBottom: '1px solid var(--border)' }}>
        <SearchIcon sx={{ color: 'var(--text-muted)' }} />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Search posts, campaigns, themes, Library… or go to a page"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          inputProps={{ 'aria-label': 'Search', role: 'combobox', 'aria-expanded': true, 'aria-controls': 'search-results', 'aria-activedescendant': results[active] ? `search-${results[active].key}` : undefined }}
          sx={{ fontSize: 16 }}
        />
        {loading && <CircularProgress size={16} sx={{ color: 'var(--text-muted)' }} />}
      </Box>
      <Box ref={listRef} id="search-results" role="listbox" sx={{ maxHeight: '60vh', overflowY: 'auto', py: 0.5 }}>
        {q.trim().length >= 2 && !loading && found.length === 0 && (
          <Typography sx={{ px: 2, py: 1.5, fontSize: 13.5, color: 'var(--text-muted)' }}>Nothing in your posts, campaigns, themes or Library matches “{q.trim()}”.</Typography>
        )}
        {results.map((r, i) => {
          const header = r.group !== lastGroup;
          lastGroup = r.group;
          return (
            <Box key={r.key}>
              {header && <Typography sx={{ px: 2, pt: 1, pb: 0.25, fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>{r.group}</Typography>}
              <Box
                id={`search-${r.key}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={r.run}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 0.9, cursor: 'pointer', bgcolor: i === active ? 'var(--bg-hover)' : 'transparent' }}
              >
                {r.image ? (
                  <Box component="img" src={r.image} alt="" sx={{ width: 32, height: 32, borderRadius: '6px', objectFit: 'cover', flexShrink: 0, bgcolor: 'var(--bg-subtle)' }} />
                ) : (
                  <Box sx={{ width: 32, height: 32, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', flexShrink: 0, '& svg': { fontSize: 18 } }}>{r.icon}</Box>
                )}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: 14, color: 'var(--text-strong)' }}>
                    {r.title}
                  </Typography>
                  {r.subtitle && (
                    <Typography noWrap sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {r.subtitle}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 2, px: 2, py: 1, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
        <span>↑ ↓ to move</span>
        <span>Enter to open</span>
        <span>Esc to close</span>
      </Box>
    </Dialog>
  );
}
