import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Chip,
  CircularProgress,
  FormControlLabel,
  Switch
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { userAPI } from '../../services/api';
import { AccessMode, ACCESS_MODE_LABELS, User, UserRole } from '../../types';
import Pagination from '../../components/Pagination';

export default function UserManagement() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 0, limit: 10 });
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: UserRole.HYBRID,
    accessMode: AccessMode.PART_ONE,
    mcpEnabled: true,
    assistantEnabled: true,
    libraryEnabled: true
  });

  useEffect(() => {
    loadUsers();
  }, [page]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await userAPI.getAll({ page, limit: 10 });
      // Only update state if we have valid data
      if (res.data && Array.isArray(res.data.users)) {
        setUsers(res.data.users);
        setPagination(res.data.pagination || { total: 0, pages: 0, limit: 10 });
      } else {
        console.warn('Received invalid user data:', res.data);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await userAPI.create(formData);
      setOpen(false);
      setFormData({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        role: UserRole.HYBRID,
        accessMode: AccessMode.PART_ONE,
        mcpEnabled: true,
        assistantEnabled: true,
        libraryEnabled: true
      });
      loadUsers();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to create user');
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">User Management</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Create User
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Part</TableCell>
              <TableCell>Blue</TableCell>
              <TableCell>Library</TableCell>
              <TableCell>Claude</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow
                key={user.id || user._id}
                hover
                onClick={() => navigate(`/admin/users/${user.id || user._id}`)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  {user.firstName} {user.lastName}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Chip label={user.role} size="small" />
                </TableCell>
                <TableCell>
                  {user.role === UserRole.SYSTEM_ADMIN
                    ? 'AI generation (admin)'
                    : ACCESS_MODE_LABELS[user.accessMode ?? AccessMode.PART_ONE]}
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.assistantEnabled === false ? 'Off' : 'On'}
                    color={user.assistantEnabled === false ? 'default' : 'primary'}
                    variant={user.assistantEnabled === false ? 'outlined' : 'filled'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.libraryEnabled === false ? 'Off' : 'On'}
                    color={user.libraryEnabled === false ? 'default' : 'primary'}
                    variant={user.libraryEnabled === false ? 'outlined' : 'filled'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.mcpEnabled === false ? 'Off' : 'On'}
                    color={user.mcpEnabled === false ? 'default' : 'primary'}
                    variant={user.mcpEnabled === false ? 'outlined' : 'filled'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={user.isActive ? 'Active' : 'Inactive'}
                    color={user.isActive ? 'success' : 'default'}
                    size="small"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Pagination
        currentPage={page}
        totalPages={pagination.pages}
        totalItems={pagination.total}
        itemsPerPage={pagination.limit}
        onPageChange={(newPage) => setPage(newPage)}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New User</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Password"
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="First Name"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Last Name"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            select
            label="Role"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
            margin="normal"
            required
          >
            {Object.values(UserRole).map((role) => (
              <MenuItem key={role} value={role}>
                {role}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            select
            label="Part"
            value={formData.accessMode}
            onChange={(e) => setFormData({ ...formData, accessMode: e.target.value as AccessMode })}
            helperText="Same app and data for both. Part two has AI generation switched off. System Admins always keep AI."
            margin="normal"
          >
            {Object.values(AccessMode).map((mode) => (
              <MenuItem key={mode} value={mode}>
                {ACCESS_MODE_LABELS[mode]}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Switch
                checked={formData.mcpEnabled}
                onChange={(e) => setFormData({ ...formData, mcpEnabled: e.target.checked })}
              />
            }
            label="Allow Claude connector"
          />
          <FormControlLabel
            control={
              <Switch
                checked={formData.assistantEnabled}
                onChange={(e) => setFormData({ ...formData, assistantEnabled: e.target.checked })}
              />
            }
            label="Allow Blue assistant"
          />
          <FormControlLabel
            control={
              <Switch
                checked={formData.libraryEnabled}
                onChange={(e) => setFormData({ ...formData, libraryEnabled: e.target.checked })}
              />
            }
            label="Allow Library"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
