import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Button,
  Tooltip
} from '@mui/material';
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
  ArrowBack as ArrowBackIcon
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';

const drawerWidth = 240;

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleBack = () => {
    navigate(-1);
  };

  // Don't show back button on dashboard
  const showBackButton = location.pathname !== '/';

  const menuItems = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/', roles: ['all'] },
    { text: 'Campaigns', icon: <CampaignIcon />, path: '/campaigns', roles: ['all'] },
    { text: 'Details Sheet', icon: <ListAltIcon />, path: '/details-sheet', roles: ['all'] },
    { text: 'Calendar', icon: <CalendarIcon />, path: '/calendar', roles: ['all'] },
    { text: 'Tasks Sheet', icon: <TableChartIcon />, path: '/tasks-sheet', roles: ['all'] },
    { text: 'Settings', icon: <SettingsIcon />, path: '/settings', roles: ['all'] },
    { text: 'Users', icon: <PeopleIcon />, path: '/admin/users', roles: [UserRole.SYSTEM_ADMIN] }
  ];

  const filteredMenuItems = menuItems.filter(
    (item) => item.roles.includes('all') || (user && item.roles.includes(user.role))
  );

  const drawer = (
    <Box>
      <Toolbar>
        <Typography variant="h6" noWrap>
          Campaign Mgmt
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {filteredMenuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton onClick={() => navigate(item.path)}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          {showBackButton && (
            <Tooltip title="Go Back">
              <IconButton
                color="inherit"
                onClick={handleBack}
                sx={{ mr: 2, display: { xs: 'none', sm: 'inline-flex' } }}
              >
                <ArrowBackIcon />
              </IconButton>
            </Tooltip>
          )}
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            Campaign Management Platform
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" sx={{ display: { xs: 'none', md: 'block' } }}>
              {user?.firstName} {user?.lastName} ({user?.role})
            </Typography>
            <Button
              color="inherit"
              startIcon={<LogoutIcon />}
              onClick={handleLogout}
            >
              Logout
            </Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth }
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth }
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: 8
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
