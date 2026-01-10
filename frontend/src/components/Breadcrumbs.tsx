import { useNavigate, useLocation } from 'react-router-dom';
import { Breadcrumbs as MuiBreadcrumbs, Link, Typography, Box } from '@mui/material';
import { NavigateNext as NavigateNextIcon, Home as HomeIcon } from '@mui/icons-material';

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Auto-generate breadcrumbs from pathname if items not provided
  const generateBreadcrumbs = (): BreadcrumbItem[] => {
    if (items) return items;

    const pathSegments = location.pathname.split('/').filter(Boolean);
    const breadcrumbs: BreadcrumbItem[] = [{ label: 'Home', path: '/' }];

    const pathMap: Record<string, string> = {
      'campaigns': 'Campaigns',
      'projects': 'Projects',
      'tasks': 'Tasks',
      'tasks-sheet': 'Tasks Sheet',
      'details-sheet': 'Details Sheet',
      'calendar': 'Calendar',
      'settings': 'Settings',
      'admin': 'Admin',
      'users': 'Users'
    };

    let currentPath = '';
    pathSegments.forEach((segment, index) => {
      currentPath += `/${segment}`;
      const label = pathMap[segment] || segment;

      // Don't make the last segment clickable
      if (index === pathSegments.length - 1) {
        breadcrumbs.push({ label });
      } else {
        breadcrumbs.push({ label, path: currentPath });
      }
    });

    return breadcrumbs;
  };

  const breadcrumbItems = generateBreadcrumbs();

  return (
    <Box sx={{ mb: 2 }}>
      <MuiBreadcrumbs
        separator={<NavigateNextIcon fontSize="small" />}
        aria-label="breadcrumb"
        sx={{
          '& .MuiBreadcrumbs-separator': {
            color: 'text.secondary'
          }
        }}
      >
        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;
          const isHome = index === 0;

          if (isLast) {
            return (
              <Typography
                key={item.label}
                color="text.primary"
                fontWeight={600}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
              >
                {isHome && <HomeIcon fontSize="small" />}
                {item.label}
              </Typography>
            );
          }

          return (
            <Link
              key={item.label}
              component="button"
              variant="body2"
              onClick={() => item.path && navigate(item.path)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: 'pointer',
                color: 'primary.main',
                textDecoration: 'none',
                '&:hover': {
                  textDecoration: 'underline'
                }
              }}
            >
              {isHome && <HomeIcon fontSize="small" />}
              {item.label}
            </Link>
          );
        })}
      </MuiBreadcrumbs>
    </Box>
  );
}
