import { Link as RouterLink, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, MenuItem, TextField, Typography, useMediaQuery } from '@mui/material';
import PageHeader from '../../components/ui/PageHeader';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import { paths } from '../../lib/paths';
import ProfileSection from './ProfileSection';
import BrandSection from './BrandSection';
import IntegrationsSection from './IntegrationsSection';
import AISection from './AISection';
import PromptsSection from './PromptsSection';
import type { SectionDef, SettingsSectionId } from './settingsShared';

/**
 * Settings, one section per address (/settings/profile, /settings/brand…), with the sections listed
 * on the left (a menu on phones). Older addresses still land in the right place: /settings?tab=…
 * and Canva's return to /settings?integration=canva.
 */

const SECTIONS: SectionDef[] = [
  { id: 'profile', label: 'Profile', description: 'Your name, password and how the app looks.' },
  { id: 'brand', label: 'Brand', description: 'What AI needs to write and design like you.' },
  { id: 'integrations', label: 'Integrations', description: 'Claude, Canva and other connected apps.' },
  { id: 'ai', label: 'AI', description: 'AI providers, models, Blue and Library reading.', admin: true },
  { id: 'prompts', label: 'Prompts', description: 'The prompts and commands behind the AI features.', admin: true }
];

/** Old ?tab= values (names and the old tab positions). */
const OLD_TABS: Record<string, SettingsSectionId> = {
  profile: 'profile',
  company: 'brand',
  'company-info': 'brand',
  brand: 'brand',
  integrations: 'integrations',
  llm: 'ai',
  ai: 'ai',
  prompts: 'prompts',
  account: 'profile'
};

export default function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const [params] = useSearchParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === UserRole.SYSTEM_ADMIN;
  const phone = !useMediaQuery('(min-width: 48em)');
  const sections = SECTIONS.filter((s) => !s.admin || isAdmin);
  const current = sections.find((s) => s.id === section);

  // /settings and old addresses → a section (keeping Canva's ?integration=… for Integrations).
  if (!section || !current) {
    const fromTab = OLD_TABS[(params.get('tab') || '').toLowerCase()];
    const target: SettingsSectionId = params.get('integration') ? 'integrations' : fromTab && sections.some((s) => s.id === fromTab) ? fromTab : 'profile';
    const keep = new URLSearchParams(search);
    keep.delete('tab');
    const q = keep.toString();
    return <Navigate to={`${paths.settings(target)}${q ? `?${q}` : ''}`} replace />;
  }

  return (
    <Box>
      <PageHeader title="Settings" subtitle={current.description} />
      <Box sx={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0, 1fr)' : '200px minmax(0, 1fr)', gap: phone ? 2 : 4, alignItems: 'start' }}>
        {phone ? (
          <TextField
            select
            size="small"
            label="Section"
            value={current.id}
            onChange={(e) => navigate(paths.settings(e.target.value as SettingsSectionId))}
          >
            {sections.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
                {s.admin ? ' (admin)' : ''}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Box component="nav" aria-label="Settings sections" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, position: 'sticky', top: 8 }}>
            {sections.map((s, i) => {
              const firstAdmin = s.admin && !sections[i - 1]?.admin;
              return (
                <Box key={s.id}>
                  {firstAdmin && <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-subtle)', px: 1.25, mt: 2, mb: 0.5 }}>Admin</Typography>}
                  <Box
                    component={RouterLink}
                    to={paths.settings(s.id)}
                    aria-current={s.id === current.id ? 'page' : undefined}
                    sx={{
                      display: 'block', px: 1.25, py: 0.9, borderRadius: 'var(--r-card)', textDecoration: 'none', fontSize: 14,
                      color: s.id === current.id ? 'var(--text-strong)' : 'var(--text-muted)', fontWeight: s.id === current.id ? 700 : 500,
                      bgcolor: s.id === current.id ? 'var(--bg-hover)' : 'transparent', '&:hover': { bgcolor: 'var(--bg-hover)', color: 'var(--text-strong)' }
                    }}
                  >
                    {s.label}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          {current.id === 'profile' && <ProfileSection />}
          {current.id === 'brand' && <BrandSection />}
          {current.id === 'integrations' && <IntegrationsSection />}
          {current.id === 'ai' && <AISection />}
          {current.id === 'prompts' && <PromptsSection />}
        </Box>
      </Box>
    </Box>
  );
}
