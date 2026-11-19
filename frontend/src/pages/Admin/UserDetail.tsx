import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Autocomplete, Box, Button, CircularProgress, MenuItem, Switch, TextField, Typography } from '@mui/material';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { MetaChip } from '../../components/ui/StatusChip';
import { useConfirm } from '../../components/ui/useConfirm';
import { userAPI, type AIUsage } from '../../services/api';
import { AccessMode, ACCESS_MODE_LABELS, ROLE_LABELS, UserRole, type User } from '../../types';
import { formatDay } from '../../lib/dates';
import { paths } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * Admin › Users › one account: what they can use (AI, Blue, Library, Publishing, Claude), their
 * monthly AI allowance, tags for Outreach, and their brand at a glance.
 */

type Feature = 'assistantEnabled' | 'libraryEnabled' | 'publishingEnabled' | 'mcpEnabled';

const FEATURES: { key: Feature; label: string; text: string; on: string; off: string }[] = [
  { key: 'assistantEnabled', label: 'Blue', text: 'The assistant inside the app, acting with this account’s permissions.', on: 'Blue is on.', off: 'Blue is off. It disappears the next time the app loads.' },
  { key: 'libraryEnabled', label: 'Library', text: 'Past and present work with versions, searchable by them, Blue and Claude.', on: 'Library is on.', off: 'Library is off. Their files are kept and come back if you turn it on.' },
  { key: 'publishingEnabled', label: 'Publishing', text: 'Connect social accounts, schedule posts and post-by-hand reminders.', on: 'Publishing is on.', off: 'Publishing is off. Scheduled posts won’t go out while it’s off.' },
  { key: 'mcpEnabled', label: 'Claude connector', text: 'Lets them connect Claude, which then works with their campaigns and posts.', on: 'Claude connector is on.', off: 'Claude connector is off. A connected Claude was disconnected.' }
];

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [allowance, setAllowance] = useState<{ images: string; designs: string; blueMessages: string }>({ images: '', designs: '', blueMessages: '' });
  const [savedAllowance, setSavedAllowance] = useState<{ images: string; designs: string; blueMessages: string }>({ images: '', designs: '', blueMessages: '' });
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      const res = await userAPI.getById(id!);
      setUser(res.data.user);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'This account couldn’t be loaded.'));
    }
    try {
      const u = await userAPI.aiUsage(id!);
      setUsage(u.usage);
      const asText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
      const a = { images: asText(u.aiAllowance.images), designs: asText(u.aiAllowance.designs), blueMessages: asText(u.aiAllowance.blueMessages) };
      setAllowance(a);
      setSavedAllowance(a);
    } catch {
      setUsage(null);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    try {
      const res = await userAPI.update(id!, body);
      setUser((u) => (u ? { ...u, ...body, ...(res.data?.user?.tags ? { tags: res.data.user.tags } : {}) } : u));
      notify(done);
      return true;
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save.'), { tone: 'error' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <Box>
        <PageHeader title="User" crumbs={[{ label: 'Users', to: paths.adminUsers() }]} />
        <EmptyState title="This account couldn’t be loaded" text={error} action={<Button component={RouterLink} to={paths.adminUsers()}>Back to Users</Button>} />
      </Box>
    );
  }
  if (!user) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  const admin = user.role === UserRole.SYSTEM_ADMIN;
  const mode = user.accessMode === AccessMode.PART_TWO ? AccessMode.PART_TWO : AccessMode.PART_ONE;
  const validAllowance = (v: string) => v.trim() === '' || /^\d{1,6}$/.test(v.trim());
  const allowanceDirty = allowance.images !== savedAllowance.images || allowance.designs !== savedAllowance.designs || allowance.blueMessages !== savedAllowance.blueMessages;
  const allowanceValid = validAllowance(allowance.images) && validAllowance(allowance.designs) && validAllowance(allowance.blueMessages);
  const brand = user.companyInfo;

  const toggleActive = async () => {
    if (user.isActive) {
      const ok = await confirm({
        title: `Deactivate ${user.firstName} ${user.lastName}?`,
        body: 'They’re signed out and can’t sign in. Their scheduled posts are cancelled. Their work is kept, and you can reactivate the account later.',
        action: 'Deactivate',
        danger: true
      });
      if (!ok) return;
    }
    update('active', { isActive: !user.isActive }, user.isActive ? 'Account deactivated' : 'Account reactivated');
  };

  const saveAllowance = async () => {
    const body = {
      aiAllowance: {
        images: allowance.images.trim() === '' ? null : Number(allowance.images),
        designs: allowance.designs.trim() === '' ? null : Number(allowance.designs),
        blueMessages: allowance.blueMessages.trim() === '' ? null : Number(allowance.blueMessages)
      }
    };
    if (await update('allowance', body, 'Allowance saved')) {
      setSavedAllowance(allowance);
      userAPI.aiUsage(id!).then((u) => setUsage(u.usage)).catch(() => undefined);
    }
  };

  return (
    <Box>
      <PageHeader
        crumbs={[{ label: 'Users', to: paths.adminUsers() }]}
        title={`${user.firstName} ${user.lastName}`}
        subtitle={
          <Box component="span" sx={{ display: 'inline-flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{user.email}</span>
            <span>· {ROLE_LABELS[user.role] || user.role}</span>
            <span>· signs in with {user.authProvider === 'google' ? 'Google' : 'email'}</span>
            {user.createdAt && <span>· joined {formatDay(user.createdAt)}</span>}
            <MetaChip
              size="xs"
              meta={
                user.isActive
                  ? { label: 'Active', hint: '', bg: 'var(--st-published-bg)', fg: 'var(--st-published-fg)', dot: 'var(--st-published-dot)' }
                  : { label: 'Deactivated', hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' }
              }
            />
          </Box>
        }
        actions={
          <Button color={user.isActive ? 'error' : 'primary'} variant="outlined" onClick={toggleActive} disabled={busy !== null}>
            {user.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
        <Panel title="AI" text={admin ? 'Admins always have AI.' : 'With AI off, everything else works the same.'}>
          {!admin && (
            <TextField select size="small" value={mode} onChange={(e) => update('ai', { accessMode: e.target.value }, e.target.value === AccessMode.PART_TWO ? 'AI turned off' : 'AI turned on')} disabled={busy !== null || !user.isActive} sx={{ minWidth: 260 }}>
              {Object.values(AccessMode).map((m) => (
                <MenuItem key={m} value={m}>
                  {ACCESS_MODE_LABELS[m]}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Panel>

        <Panel
          title="AI allowance this month"
          text={admin ? 'Admins have no limit.' : `Leave empty to use the workspace allowance; 0 means no limit.${usage ? ` Renews ${formatDay(usage.resetsAt)}.` : ''}`}
        >
          {usage && (
            <Typography sx={{ fontSize: 13.5, mb: admin ? 0 : 1.5 }}>
              {usage.images.used} AI image{usage.images.used === 1 ? '' : 's'}
              {usage.images.limit ? ` of ${usage.images.limit}` : ''}
              {usage.designs ? ` · ${usage.designs.used} poster${usage.designs.used === 1 ? '' : 's'}${usage.designs.limit ? ` of ${usage.designs.limit}` : ''}` : ''} · {usage.blueMessages.used} Blue message{usage.blueMessages.used === 1 ? '' : 's'}
              {usage.blueMessages.limit ? ` of ${usage.blueMessages.limit}` : ''}
            </Typography>
          )}
          {!admin && (
            <Box
              component="form"
              onSubmit={(e) => {
                e.preventDefault();
                if (allowanceDirty && allowanceValid) saveAllowance();
              }}
              sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}
            >
              <TextField size="small" label="AI images" placeholder="Workspace" value={allowance.images} onChange={(e) => setAllowance({ ...allowance, images: e.target.value })} error={!validAllowance(allowance.images)} sx={{ width: 130 }} inputProps={{ inputMode: 'numeric' }} />
              <TextField size="small" label="Posters" placeholder="Workspace" value={allowance.designs} onChange={(e) => setAllowance({ ...allowance, designs: e.target.value })} error={!validAllowance(allowance.designs)} sx={{ width: 120 }} inputProps={{ inputMode: 'numeric' }} />
              <TextField size="small" label="Blue messages" placeholder="Workspace" value={allowance.blueMessages} onChange={(e) => setAllowance({ ...allowance, blueMessages: e.target.value })} error={!validAllowance(allowance.blueMessages)} sx={{ width: 140 }} inputProps={{ inputMode: 'numeric' }} />
              <Button type="submit" size="small" variant="contained" disabled={!allowanceDirty || !allowanceValid || busy !== null} sx={{ mt: 0.5 }}>
                Save
              </Button>
            </Box>
          )}
        </Panel>

        {FEATURES.map((f) => {
          const on = (user as any)[f.key] !== false;
          return (
            <Panel
              key={f.key}
              title={f.label}
              text={f.text}
              right={
                <Switch
                  checked={on}
                  onChange={(e) => update(f.key, { [f.key]: e.target.checked }, e.target.checked ? f.on : f.off)}
                  disabled={busy !== null || !user.isActive}
                  inputProps={{ 'aria-label': f.label }}
                />
              }
            />
          );
        })}

        <Panel title="Tags" text="Labels for sending Outreach messages to groups (e.g. “pharmacy”, “vip”). Only admins see them.">
          <Autocomplete
            multiple
            freeSolo
            size="small"
            options={[] as string[]}
            value={tags ?? user.tags ?? []}
            onChange={(_e, value) => setTags(value.map((v) => v.trim().toLowerCase()).filter(Boolean))}
            renderInput={(params) => <TextField {...params} placeholder="Type a tag and press Enter" />}
          />
          {tags && (
            <Button
              size="small"
              variant="contained"
              sx={{ mt: 1 }}
              disabled={busy !== null}
              onClick={async () => {
                if (await update('tags', { tags }, 'Tags saved')) setTags(null);
              }}
            >
              Save tags
            </Button>
          )}
        </Panel>

        <Panel title="Activity" text={`${user.campaignCount || 0} campaign${user.campaignCount === 1 ? '' : 's'} · Canva ${user.hasCanvaIntegration ? 'connected' : 'not connected'}`} />
      </Box>

      {brand && Object.values(brand).some(Boolean) && (
        <Box component="section" sx={{ mt: 2, p: 2, border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-panel)' }}>
          <Typography component="h2" sx={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', mb: 1.5 }}>
            Brand
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
            {(
              [
                ['Brand name', brand.companyName],
                ['Industry', brand.sector],
                ['Tone of voice', brand.brandTone],
                ['What they do', brand.about],
                ['Products and services', brand.productsServices],
                ['What makes them different', brand.usp],
                ['Audience', brand.audienceProfile],
                ['Always and never', brand.globalRules]
              ] as [string, string | undefined][]
            )
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <Box key={label}>
                  <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</Typography>
                  <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{v}</Typography>
                </Box>
              ))}
          </Box>
        </Box>
      )}
      {confirmDialog}
    </Box>
  );
}

function Panel({ title, text, right, children }: { title: string; text?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <Box component="section" sx={{ p: 2, border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography component="h2" sx={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
            {title}
          </Typography>
          {text && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>{text}</Typography>}
        </Box>
        {right}
      </Box>
      {children}
    </Box>
  );
}
