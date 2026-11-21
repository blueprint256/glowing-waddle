import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DarkMode as DarkIcon, LightMode as LightIcon } from '@mui/icons-material';
import { userAPI, type AIUsage } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { UserRole } from '../../types';
import { errorMessage, notify } from '../../store/toastStore';

/** Settings → Profile: your name, sign-in, password and how the app looks. */
export default function ProfileSection() {
  const { user } = useAuthStore();
  const { mode, setMode } = useThemeStore();
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [savingName, setSavingName] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AIUsage | null>(null);

  useEffect(() => {
    userAPI
      .myAIUsage()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
  }, [user?.firstName, user?.lastName]);

  const nameChanged = firstName.trim() !== (user?.firstName || '') || lastName.trim() !== (user?.lastName || '');
  const nameValid = Boolean(firstName.trim() && lastName.trim());

  const saveName = async () => {
    if (!nameChanged || !nameValid || savingName) return;
    setSavingName(true);
    try {
      const r = await userAPI.updateMe({ firstName: firstName.trim(), lastName: lastName.trim() });
      useAuthStore.setState((s) => (s.user ? { user: { ...s.user, firstName: r.data.user.firstName, lastName: r.data.user.lastName } } : {}));
      notify('Name saved');
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t save your name.'), { tone: 'error' });
    } finally {
      setSavingName(false);
    }
  };

  const hasPassword = user?.hasPassword !== false;
  const mismatch = Boolean(repeat && next !== repeat);
  const tooShort = Boolean(next && next.length < 8);
  const canChange = Boolean(next && repeat && !mismatch && !tooShort && (!hasPassword || current));

  const changePassword = async () => {
    if (!canChange || savingPassword) return;
    setSavingPassword(true);
    setPasswordError(null);
    try {
      await userAPI.changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      useAuthStore.setState((s) => (s.user ? { user: { ...s.user, hasPassword: true } } : {}));
      notify(hasPassword ? 'Password changed' : 'Password set. You can now also sign in with your email.');
    } catch (e) {
      setPasswordError(errorMessage(e, 'Couldn’t change your password.'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 560 }}>
      <Group title="Your name">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            saveName();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" inputProps={{ maxLength: 80 }} />
            <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" inputProps={{ maxLength: 80 }} />
          </Box>
          <TextField label="Email" value={user?.email || ''} disabled helperText="Ask the Blueprint team (Inbox → Message support) to change your email." />
          <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Account: {user?.role === UserRole.SYSTEM_ADMIN ? 'Admin' : 'Client'} · signs in with {user?.authProvider === 'google' ? 'Google' : 'email and password'}
          </Typography>
          <Box>
            <Button type="submit" variant="contained" disabled={!nameChanged || !nameValid || savingName}>
              {savingName ? 'Saving…' : 'Save name'}
            </Button>
          </Box>
        </Box>
      </Group>

      <Group title={hasPassword ? 'Change password' : 'Set a password'} hint={hasPassword ? undefined : 'You sign in with Google. Set a password to also sign in with your email.'}>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            changePassword();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {/* Lets password managers match the form to the account. */}
          <input type="text" name="username" autoComplete="username" value={user?.email || ''} readOnly hidden />
          {hasPassword && <TextField type="password" label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />}
          <TextField
            type="password"
            label="New password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            error={tooShort}
            helperText={tooShort ? 'Use at least 8 characters.' : 'At least 8 characters.'}
          />
          <TextField type="password" label="New password again" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" error={mismatch} helperText={mismatch ? 'The two don’t match.' : undefined} />
          {passwordError && (
            <Typography role="alert" sx={{ fontSize: 13, color: 'var(--st-attention-fg)' }}>
              {passwordError}
            </Typography>
          )}
          <Box>
            <Button type="submit" variant="contained" disabled={!canChange || savingPassword}>
              {savingPassword ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
            </Button>
          </Box>
        </Box>
      </Group>

      {usage && !usage.unlimited && (
        <Group title="AI this month" hint={`Renews on ${new Date(usage.resetsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <UsageBar label="AI pictures (posters and photos)" line={usage.images} />
            <UsageBar label="Blue messages" line={usage.blueMessages} />
          </Box>
        </Group>
      )}

      <Group title="Appearance">
        <ToggleButtonGroup exclusive value={mode} onChange={(_, v) => v && setMode(v)} aria-label="Appearance" sx={{ '& .MuiToggleButton-root': { textTransform: 'none', gap: 0.75, px: 2 } }}>
          <ToggleButton value="light">
            <LightIcon fontSize="small" /> Light
          </ToggleButton>
          <ToggleButton value="dark">
            <DarkIcon fontSize="small" /> Dark
          </ToggleButton>
        </ToggleButtonGroup>
      </Group>
    </Box>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography component="h3" sx={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', mb: hint ? 0.25 : 1.5 }}>
        {title}
      </Typography>
      {hint && <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', mb: 1.5 }}>{hint}</Typography>}
      {children}
    </Box>
  );
}

function UsageBar({ label, line }: { label: string; line: AIUsage['images'] }) {
  const unlimited = line.limit === 0;
  const share = unlimited ? 0 : Math.min(1, line.used / line.limit);
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, mb: 0.5 }}>
        <span>{label}</span>
        <Box component="span" sx={{ color: 'var(--text-muted)' }}>
          {unlimited ? `${line.used} used · no limit` : `${line.used} of ${line.limit} used`}
        </Box>
      </Box>
      {!unlimited && (
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'var(--bg-subtle)', overflow: 'hidden' }} role="progressbar" aria-label={label} aria-valuenow={line.used} aria-valuemin={0} aria-valuemax={line.limit}>
          <Box sx={{ height: '100%', width: `${share * 100}%`, bgcolor: share >= 1 ? 'var(--st-attention-dot)' : 'var(--st-ready-dot)' }} />
        </Box>
      )}
    </Box>
  );
}
