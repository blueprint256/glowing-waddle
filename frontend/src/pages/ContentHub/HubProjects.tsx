import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Grid, TextField, Typography
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { contentHubAPI } from '../../services/api';
import type { HubProjectSummary } from '../../components/ContentHub/types';

export default function HubProjects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<HubProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    contentHubAPI
      .listProjects()
      .then((res) => setProjects(res.data.projects || []))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load projects'))
      .finally(() => setLoading(false));
  }, []);

  const create = async () => {
    try {
      setSaving(true);
      const res = await contentHubAPI.createProject({ name, description: description || undefined });
      navigate(`/hub/projects/${res.data.project._id}`);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to create project');
      setSaving(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4">Content Hub</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Projects hold image slots and versioned posters.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New project
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" mt={6}>
          <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
        </Box>
      ) : projects.length === 0 ? (
        <Box sx={{ p: 6, textAlign: 'center', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-card)' }}>
          <Typography variant="h6" gutterBottom>No projects yet</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Create a project, add slots for your images, then build poster versions from them.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            Create your first project
          </Button>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {projects.map((p) => (
            <Grid item xs={12} sm={6} lg={4} key={p._id}>
              <Card>
                <CardActionArea onClick={() => navigate(`/hub/projects/${p._id}`)}>
                  <CardContent>
                    <Typography variant="h6" noWrap>{p.name}</Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: 'text.secondary', minHeight: 38, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                    >
                      {p.description || 'No description'}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.secondary' }}>
                      {p.slotCount} slot{p.slotCount === 1 ? '' : 's'} · {p.versionCount} version{p.versionCount === 1 ? '' : 's'} ·
                      updated {new Date(p.updatedAt).toLocaleDateString()}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => !saving && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth margin="dense" label="Name" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 120 }} />
          <TextField fullWidth margin="dense" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} inputProps={{ maxLength: 1000 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={create} disabled={!name.trim() || saving}>Create</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
