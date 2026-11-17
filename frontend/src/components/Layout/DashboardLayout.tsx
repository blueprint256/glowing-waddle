import { useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Box, Drawer, IconButton, Tooltip, Typography } from '@mui/material';
import {
  Menu as MenuIcon,
  Today as TodayIcon,
  Campaign as CampaignIcon,
  People as PeopleIcon,
  CalendarMonth as PlannerIcon,
  PhotoLibrary as PhotoLibraryIcon,
  Send as SendIcon,
  Inbox as InboxIcon,
  Forum as OutreachIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  OpenInFull as FullScreenIcon
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { UserRole } from '../../types';
import { useBlueStore } from '../../store/blueStore';
import { useInboxStore } from '../../store/inboxStore';
import BluePanel, { BlueMark } from '../Blue/BluePanel';
import PostPanelHost from '../posts/PostPanelHost';
import ToastHost from '../ui/ToastHost';
import { paths } from '../../lib/paths';

/** Accent names map to --accent-<name>-bg / -fg in styles/tokens.css. */
type Accent = 'green' | 'blue' | 'purple' | 'wine' | 'violet' | 'amber';

interface NavItem {
  text: string;
  icon: ReactNode;
  path: string;
  accent?: Accent;
  roles: Array<'all' | UserRole>;
  /** Extra path prefixes that should keep this item highlighted (detail pages). */
  also?: string[];
  /** Hidden when the user's Library (Aggregator) access is switched off. */
  library?: boolean;
  /** Hidden when the user's publishing access is switched off. */
  publishing?: boolean;
  /** Shows a count: Inbox items needing attention, or unread support conversations (admins). */
  badge?: 'inbox' | 'outreach';
}

const NAV: NavItem[] = [
  { text: 'Today', icon: <TodayIcon />, path: paths.today(), accent: 'green', roles: ['all'] },
  { text: 'Inbox', icon: <InboxIcon />, path: paths.inbox(), accent: 'amber', roles: ['all'], badge: 'inbox' },
  { text: 'Planner', icon: <PlannerIcon />, path: '/planner', accent: 'purple', roles: ['all'], also: ['/posts/'] },
  { text: 'Campaigns', icon: <CampaignIcon />, path: paths.campaigns(), accent: 'violet', roles: ['all'] },
  { text: 'Library', icon: <PhotoLibraryIcon />, path: paths.library(), accent: 'blue', roles: ['all'], library: true },
  { text: 'Publishing', icon: <SendIcon />, path: paths.publishing(), accent: 'green', roles: ['all'], publishing: true },
  { text: 'Settings', icon: <SettingsIcon />, path: paths.settings(), roles: ['all'] },
  { text: 'Outreach', icon: <OutreachIcon />, path: paths.adminOutreach(), accent: 'purple', roles: [UserRole.SYSTEM_ADMIN], badge: 'outreach' },
  { text: 'Users', icon: <PeopleIcon />, path: paths.adminUsers(), accent: 'wine', roles: [UserRole.SYSTEM_ADMIN] }
];

function isActive(item: NavItem, pathname: string) {
  if (item.path === '/') return pathname === '/';
  return (
    pathname === item.path ||
    pathname.startsWith(item.path + '/') ||
    (item.also ?? []).some((p) => pathname.startsWith(p))
  );
}

/** Blue, shown above Dashboard in the sidebar: the button opens the side panel, the icon opens Blue full screen. */
function BlueToggle({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { open: panelOpen, toggle, setOpen } = useBlueStore();
  const onPage = pathname === '/blue';
  const open = panelOpen || onPage;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
    <Tooltip title={onPage ? 'Back to the side panel' : 'Ask Blue to do things for you (Ctrl+J)'} placement="right">
      <Box
        component="button"
        type="button"
        onClick={() => {
          if (onPage) {
            setOpen(true);
            navigate(-1);
          } else toggle();
          onNavigate?.();
        }}
        aria-pressed={open}
        aria-label={onPage ? 'Use Blue as a side panel' : open ? 'Close Blue' : 'Open Blue'}
        sx={{
          all: 'unset', boxSizing: 'border-box', cursor: 'pointer', flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: '10px',
          height: 36, px: '8px', borderRadius: 'var(--r-ctl)',
          fontSize: 'var(--fs-sm)', fontWeight: 600,
          border: '1px solid',
          borderColor: open ? 'var(--accent-blue-fg)' : 'var(--border)',
          bgcolor: open ? 'var(--accent-blue-bg)' : 'var(--bg-raised)',
          color: open ? 'var(--accent-blue-fg)' : 'var(--text-strong)',
          transition: 'background-color var(--t-fast), border-color var(--t-fast)',
          '&:hover': { borderColor: 'var(--accent-blue-fg)' },
          '&:focus-visible': { outline: '2px solid var(--border-strong)' }
        }}
      >
        <BlueMark size={20} />
        <Box component="span" sx={{ flex: 1 }}>Blue</Box>
        <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', display: { xs: 'none', lg: 'inline' } }}>
          Ctrl J
        </Box>
      </Box>
    </Tooltip>
    <Tooltip title="Blue full screen: chat in the middle, results on the side" placement="right">
      <IconButton
        size="small"
        aria-label="Open Blue full screen"
        aria-pressed={onPage}
        onClick={() => {
          if (!onPage) navigate('/blue');
          onNavigate?.();
        }}
        sx={{
          width: 36, height: 36, borderRadius: 'var(--r-ctl)', border: '1px solid',
          borderColor: onPage ? 'var(--accent-blue-fg)' : 'var(--border)',
          bgcolor: onPage ? 'var(--accent-blue-bg)' : 'var(--bg-raised)',
          color: onPage ? 'var(--accent-blue-fg)' : 'var(--text-muted)',
          '&:hover': { borderColor: 'var(--accent-blue-fg)' }
        }}
      >
        <FullScreenIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
    </Box>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuthStore();
  const { mode, toggle } = useThemeStore();
  const blueAllowed = user?.assistantEnabled !== false;
  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const inboxSummary = useInboxStore((s) => s.summary);
  const supportUnread = useInboxStore((s) => s.supportUnread);
  const refreshInbox = useInboxStore((s) => s.refresh);
  const inboxCount = inboxSummary.badge;

  // Badge counts: on load, every minute while the tab is visible, and when returning to the tab.
  useEffect(() => {
    if (!user) return;
    refreshInbox(isAdmin);
    const tick = () => {
      if (document.visibilityState === 'visible') refreshInbox(isAdmin);
    };
    const timer = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [user?._id, isAdmin, refreshInbox]);

  const items = NAV.filter(
    (i) => (i.roles.includes('all') || (user && i.roles.includes(user.role))) && (!i.library || user?.libraryEnabled !== false) && (!i.publishing || user?.publishingEnabled !== false)
  );
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || 'U';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: '12px 8px', gap: 0.5 }}>
      {/* Workspace header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, mb: 1.5 }}>
        <Box
          sx={{
            width: 24, height: 24, borderRadius: '6px', display: 'grid', placeItems: 'center',
            bgcolor: 'var(--primary-bg)', color: 'var(--primary-fg)', fontSize: 12, fontWeight: 700
          }}
        >
          B
        </Box>
        <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>
          Blueprint
        </Typography>
      </Box>

      {blueAllowed && <BlueToggle onNavigate={onNavigate} />}

      {/* Navigation */}
      <Box component="nav" aria-label="Main" sx={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, overflowY: 'auto' }}>
        {items.map((item) => {
          const active = isActive(item, pathname);
          return (
            <Box
              key={item.path}
              component={RouterLink}
              to={item.path}
              onClick={() => onNavigate?.()}
              aria-current={active ? 'page' : undefined}
              sx={{
                all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '10px',
                height: 'var(--h-nav)', px: '8px', borderRadius: 'var(--r-nav)',
                fontSize: 'var(--fs-sm)', fontWeight: 500,
                color: active ? 'var(--text-nav-active)' : 'var(--text-nav)',
                bgcolor: active ? 'var(--bg-hover)' : 'transparent',
                transition: 'background-color var(--t-fast), color var(--t-fast)',
                '&:hover': { bgcolor: 'var(--bg-hover)', color: 'var(--text-nav-active)' },
                '&:focus-visible': { outline: '2px solid var(--border-strong)' }
              }}
            >
              <Box
                sx={{
                  width: 20, height: 20, borderRadius: 'var(--r-nav)', display: 'grid', placeItems: 'center', flex: '0 0 auto',
                  bgcolor: item.accent ? `var(--accent-${item.accent}-bg)` : 'transparent',
                  color: item.accent ? `var(--accent-${item.accent}-fg)` : 'inherit',
                  '& svg': { fontSize: 14 }
                }}
              >
                {item.icon}
              </Box>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {item.text}
              </Box>
              {item.badge && (item.badge === 'inbox' ? inboxCount : supportUnread) > 0 && (
                <Box
                  component="span"
                  aria-label={`${item.badge === 'inbox' ? inboxCount : supportUnread} new`}
                  sx={{
                    minWidth: 18, height: 18, px: '5px', borderRadius: '9px', display: 'grid', placeItems: 'center',
                    fontSize: 11, fontWeight: 700, bgcolor: 'var(--primary-bg)', color: 'var(--primary-fg)'
                  }}
                >
                  {Math.min(99, item.badge === 'inbox' ? inboxCount : supportUnread)}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Footer: user + theme + logout */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, p: 1, mt: 1,
          border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-raised)'
        }}
      >
        <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: 'var(--bg-hover)', color: 'var(--text-strong)' }}>
          {initials}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.3 }}>
            {user?.firstName} {user?.lastName}
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.3 }}>
            {isAdmin ? 'Admin' : user?.email}
          </Typography>
        </Box>
        <Tooltip title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          <IconButton size="small" onClick={toggle} aria-label="Toggle theme" sx={{ color: 'var(--text-muted)' }}>
            {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Log out">
          <IconButton size="small" onClick={handleLogout} aria-label="Log out" sx={{ color: 'var(--text-muted)' }}>
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export default function DashboardLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user } = useAuthStore();
  const blueAllowed = user?.assistantEnabled !== false;
  const { toggle: toggleBlue, refreshKey } = useBlueStore();
  const { pathname } = useLocation();
  const flush = pathname === '/blue';

  // Ctrl/⌘ + J opens and closes Blue.
  useEffect(() => {
    if (!blueAllowed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j' && window.location.pathname !== '/blue') {
        e.preventDefault();
        toggleBlue();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blueAllowed, toggleBlue]);

  return (
    <div className="bp-shell">
      {/* ≥768px: persistent sidebar (CSS in styles/global.css) */}
      <aside className="bp-sidebar" aria-label="Sidebar">
        <SidebarContent />
      </aside>

      {/* <768px: a slim top bar with the menu and Blue (nothing floats over the page) */}
      <header className="bp-topbar">
        <IconButton onClick={() => setDrawerOpen(true)} aria-label="Open the menu" size="small" sx={{ color: 'var(--text-strong)' }}>
          <MenuIcon />
        </IconButton>
        <Typography component="span" sx={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
          Blueprint
        </Typography>
        {blueAllowed && !flush && (
          <IconButton onClick={toggleBlue} aria-label="Open Blue" size="small">
            <BlueMark size={26} />
          </IconButton>
        )}
      </header>

      {/* <768px: drawer, opened from the top bar */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: false }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: 'min(280px, 86vw)' } }}
      >
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </Drawer>

      <main className={`bp-panel${flush ? ' bp-panel--flush' : ''}`} id="main">
        <div className={`bp-page${flush ? ' bp-page--flush' : ''}`}>
          {/* Re-mounts the page after Blue changes data, so it shows the latest (not the Blue page itself). */}
          <Outlet key={flush ? 'blue' : refreshKey} />
        </div>
      </main>

      {blueAllowed && <BluePanel />}

      {/* A post opened from anywhere (?post=<id>), and short confirmations */}
      <PostPanelHost />
      <ToastHost />
    </div>
  );
}
