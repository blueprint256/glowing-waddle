import { useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Box, Drawer, IconButton, Tooltip, Typography } from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Campaign as CampaignIcon,
  People as PeopleIcon,
  ListAlt as ListAltIcon,
  CalendarMonth as CalendarIcon,
  TableChart as TableChartIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  PhotoLibrary as HubIcon
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { AccessMode, UserRole, hasPartAccess } from '../../types';

/** Accent names map to --accent-<name>-bg / -fg in styles/tokens.css. */
type Accent = 'green' | 'blue' | 'purple' | 'wine' | 'violet' | 'amber';

interface NavItem {
  text: string;
  icon: ReactNode;
  path: string;
  accent?: Accent;
  roles: Array<'all' | UserRole>;
  /** Which part of the platform this item belongs to (hidden when the user's access excludes it). */
  part?: AccessMode.PART_ONE | AccessMode.PART_TWO;
  /** Extra path prefixes that should keep this item highlighted (detail pages). */
  also?: string[];
}

const P1 = AccessMode.PART_ONE;
const P2 = AccessMode.PART_TWO;

const NAV: NavItem[] = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/', accent: 'green', roles: ['all'], part: P1 },
  { text: 'Campaigns', icon: <CampaignIcon />, path: '/campaigns', accent: 'violet', roles: ['all'], also: ['/projects/', '/tasks/'], part: P1 },
  { text: 'Details Sheet', icon: <ListAltIcon />, path: '/details-sheet', accent: 'blue', roles: ['all'], part: P1 },
  { text: 'Calendar', icon: <CalendarIcon />, path: '/calendar', accent: 'purple', roles: ['all'], part: P1 },
  { text: 'Tasks Sheet', icon: <TableChartIcon />, path: '/tasks-sheet', accent: 'amber', roles: ['all'], part: P1 },
  { text: 'Content Hub', icon: <HubIcon />, path: '/hub', accent: 'wine', roles: ['all'], part: P2 },
  { text: 'Settings', icon: <SettingsIcon />, path: '/settings', roles: ['all'], part: P1 },
  { text: 'Users', icon: <PeopleIcon />, path: '/admin/users', accent: 'wine', roles: [UserRole.SYSTEM_ADMIN] }
];

function isActive(item: NavItem, pathname: string) {
  if (item.path === '/') return pathname === '/';
  return (
    pathname === item.path ||
    pathname.startsWith(item.path + '/') ||
    (item.also ?? []).some((p) => pathname.startsWith(p))
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuthStore();
  const { mode, toggle } = useThemeStore();

  const items = NAV.filter(
    (i) =>
      (i.roles.includes('all') || (user && i.roles.includes(user.role))) &&
      (!i.part || hasPartAccess(user, i.part))
  );
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || 'U';

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

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
          Campaign Mgmt
        </Typography>
      </Box>

      {/* Navigation */}
      <Box component="nav" aria-label="Main" sx={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, overflowY: 'auto' }}>
        {items.map((item) => {
          const active = isActive(item, pathname);
          return (
            <Box
              key={item.path}
              component="button"
              type="button"
              onClick={() => go(item.path)}
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
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.text}
              </Box>
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
          <Typography noWrap sx={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.3, textTransform: 'capitalize' }}>
            {user?.role?.replace('_', ' ')}
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

  return (
    <div className="bp-shell">
      {/* ≥768px: persistent sidebar (CSS in styles/global.css) */}
      <aside className="bp-sidebar" aria-label="Sidebar">
        <SidebarContent />
      </aside>

      {/* <768px: drawer, opened from the floating button */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: false }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: 'min(280px, 86vw)' } }}
      >
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </Drawer>

      <main className="bp-panel" id="main">
        <div className="bp-page">
          <Outlet />
        </div>
      </main>

      <div className="bp-fab-bar">
        <IconButton
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          sx={{ width: 40, height: 40, borderRadius: 9999, bgcolor: 'var(--bg-fab)', color: '#fff', '&:hover': { bgcolor: 'var(--bg-fab)' } }}
        >
          <MenuIcon fontSize="small" />
        </IconButton>
      </div>
    </div>
  );
}
