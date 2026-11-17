import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { Add as AddIcon, Search as SearchIcon } from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { MetaChip } from '../../components/ui/StatusChip';
import { userAPI } from '../../services/api';
import { AccessMode, ACCESS_MODE_LABELS, ROLE_LABELS, UserRole, type User } from '../../types';
import { paths } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';

/** Admin › Users: every account, what it can use, and adding a new one. */

const ON = { label: 'On', hint: '', bg: 'var(--st-published-bg)', fg: 'var(--st-published-fg)', dot: 'var(--st-published-dot)' };
const OFF = { label: 'Off', hint: '', bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', dot: 'var(--text-faint)' };

const EMPTY_FORM = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  role: UserRole.HYBRID,
  accessMode: AccessMode.PART_ONE,
  mcpEnabled: true,
  assistantEnabled: true,
  libraryEnabled: true,
  publishingEnabled: true
};

export default function UserManagement() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await userAPI.getAll({ limit: 1000, includeInactive: 'true' });
      setUsers(res.data.users || []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Users couldn’t load.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users || []).filter((u) => !q || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(q));
  }, [users, search]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setFormError(null);
    try {
      await userAPI.create({ ...form, email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim() });
      notify(`Created ${form.firstName.trim()} ${form.lastName.trim()}`);
      setOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setFormError(errorMessage(e, 'Couldn’t create the user.'));
    } finally {
      setCreating(false);
    }
  };

  const valid = /\S+@\S+\.\S+/.test(form.email) && form.password.length >= 8 && form.firstName.trim() && form.lastName.trim();

  return (
    <Box>
      <PageHeader
        title="Users"
        subtitle="Each client has their own campaigns, posts, Library and accounts."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            New user
          </Button>
        }
      />

      <TextField
        size="small"
        placeholder="Search by name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2, width: { xs: '100%', sm: 320 } }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        inputProps={{ 'aria-label': 'Search users' }}
      />

      {error ? (
        <EmptyState title="Users couldn’t load" text={error} action={<Button onClick={load}>Try again</Button>} />
      ) : users === null ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
        </Box>
      ) : shown.length === 0 ? (
        <EmptyState compact title={search ? 'No users match' : 'No users yet'} />
      ) : (
        <TableContainer sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-panel)' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>AI</TableCell>
                <TableCell>Blue</TableCell>
                <TableCell>Library</TableCell>
                <TableCell>Publishing</TableCell>
                <TableCell>Claude</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((u) => {
                const id = u.id || u._id;
                const admin = u.role === UserRole.SYSTEM_ADMIN;
                return (
                  <TableRow
                    key={id}
                    hover
                    tabIndex={0}
                    onClick={() => navigate(paths.adminUser(id))}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(paths.adminUser(id))}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>
                        {u.firstName} {u.lastName}
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{u.email}</Typography>
                    </TableCell>
                    <TableCell>{ROLE_LABELS[u.role] || u.role}</TableCell>
                    <TableCell>
                      <MetaChip size="xs" meta={admin || u.accessMode !== AccessMode.PART_TWO ? ON : OFF} />
                    </TableCell>
                    <TableCell>
                      <MetaChip size="xs" meta={u.assistantEnabled === false ? OFF : ON} />
                    </TableCell>
                    <TableCell>
                      <MetaChip size="xs" meta={u.libraryEnabled === false ? OFF : ON} />
                    </TableCell>
                    <TableCell>
                      <MetaChip size="xs" meta={u.publishingEnabled === false ? OFF : ON} />
                    </TableCell>
                    <TableCell>
                      <MetaChip size="xs" meta={u.mcpEnabled === false ? OFF : ON} />
                    </TableCell>
                    <TableCell>{u.isActive ? 'Active' : 'Deactivated'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={() => !creating && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New user</DialogTitle>
        <DialogContent>
          <Box
            component="form"
            id="new-user"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) create();
            }}
            sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField label="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required autoFocus />
              <TextField label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </Box>
            <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="off" />
            <TextField
              label="Password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              autoComplete="new-password"
              helperText="At least 8 characters. They can change it in Settings › Profile."
              error={Boolean(form.password) && form.password.length < 8}
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField select label="Account" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
                {Object.values(UserRole).map((r) => (
                  <MenuItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="AI"
                value={form.role === UserRole.SYSTEM_ADMIN ? AccessMode.PART_ONE : form.accessMode}
                onChange={(e) => setForm({ ...form, accessMode: e.target.value as AccessMode })}
                disabled={form.role === UserRole.SYSTEM_ADMIN}
                helperText={form.role === UserRole.SYSTEM_ADMIN ? 'Admins always have AI.' : 'Everything else works the same.'}
              >
                {Object.values(AccessMode).map((m) => (
                  <MenuItem key={m} value={m}>
                    {ACCESS_MODE_LABELS[m]}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <FormControlLabel control={<Switch checked={form.assistantEnabled} onChange={(e) => setForm({ ...form, assistantEnabled: e.target.checked })} />} label="Blue" />
              <FormControlLabel control={<Switch checked={form.libraryEnabled} onChange={(e) => setForm({ ...form, libraryEnabled: e.target.checked })} />} label="Library" />
              <FormControlLabel control={<Switch checked={form.publishingEnabled} onChange={(e) => setForm({ ...form, publishingEnabled: e.target.checked })} />} label="Publishing" />
              <FormControlLabel control={<Switch checked={form.mcpEnabled} onChange={(e) => setForm({ ...form, mcpEnabled: e.target.checked })} />} label="Claude connector" />
            </Box>
            {formError && (
              <Typography role="alert" sx={{ fontSize: 13, color: 'var(--st-attention-fg)' }}>
                {formError}
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button type="submit" form="new-user" variant="contained" disabled={!valid || creating}>
            {creating ? 'Creating…' : 'Create user'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
