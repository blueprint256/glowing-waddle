import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Breadcrumbs, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogContent, DialogTitle,
  Grid, IconButton, Link, TextField, Tooltip, Typography
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Link as LinkIcon, Palette as PaletteIcon
} from '@mui/icons-material';
import { contentHubAPI, hubAssetUrl, StructuredPoster } from '../../services/api';
import type { HubSlot, HubVersion } from '../../components/ContentHub/types';
import PosterComposer from '../../components/ContentHub/PosterComposer';
import UploadLinkDialog from '../../components/ContentHub/UploadLinkDialog';

const POLL_MS = 5000;

export default function HubProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState('');
  const [slots, setSlots] = useState<HubSlot[]>([]);
  const [versions, setVersions] = useState<HubVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newSlot, setNewSlot] = useState('');
  const [link, setLink] = useState<{ slotName: string; pageUrl: string; expiresAt: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitial, setComposerInitial] = useState<StructuredPoster | null>(null);
  const [viewing, setViewing] = useState<HubVersion | null>(null);

  const loadSlots = useCallback(async () => {
    if (!projectId) return;
    const res = await contentHubAPI.listSlots(projectId);
    setSlots(res.data.slots || []);
  }, [projectId]);

  const loadVersions = useCallback(async () => {
    if (!projectId) return;
    const res = await contentHubAPI.listVersions(projectId);
    setVersions(res.data.versions || []);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([contentHubAPI.getProject(projectId), loadSlots(), loadVersions()])
      .then(([project]) => setProjectName(project.data.project.name))
      .catch((e) => setError(e.response?.data?.message || 'Failed to load project'))
      .finally(() => setLoading(false));
  }, [projectId, loadSlots, loadVersions]);

  // While an upload link is live, watch for the file arriving.
  const hasPending = slots.some((s) => s.pendingUntil && new Date(s.pendingUntil) > new Date());
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => { loadSlots().catch(() => undefined); }, POLL_MS);
    return () => clearInterval(id);
  }, [hasPending, loadSlots]);

  const addSlot = async () => {
    if (!projectId || !newSlot.trim()) return;
    try {
      await contentHubAPI.createSlot(projectId, { name: newSlot.trim() });
      setNewSlot('');
      await loadSlots();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to add slot');
    }
  };

  const removeSlot = async (slot: HubSlot) => {
    if (!projectId || !window.confirm(`Delete slot “${slot.name}”?`)) return;
    try {
      await contentHubAPI.deleteSlot(projectId, slot._id);
      await loadSlots();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to delete slot');
    }
  };

  const requestLink = async (slot: HubSlot) => {
    if (!projectId) return;
    try {
      const res = await contentHubAPI.requestUpload(projectId, slot._id);
      setLink({ slotName: slot.name, pageUrl: res.data.pageUrl, expiresAt: res.data.expiresAt });
      await loadSlots();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to create upload link');
    }
  };

  const renderVersion = async (poster: StructuredPoster) => {
    if (!projectId) return;
    await contentHubAPI.createVersion(projectId, { structuredData: poster });
    await loadVersions();
  };

  const openComposer = (initial: StructuredPoster | null) => {
    setComposerInitial(initial);
    setComposerOpen(true);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link underline="hover" color="inherit" onClick={() => navigate('/hub')} sx={{ cursor: 'pointer' }}>Content Hub</Link>
        <Typography color="text.primary">{projectName || 'Project'}</Typography>
      </Breadcrumbs>

      <Typography variant="h4" sx={{ mb: 3 }}>{projectName}</Typography>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {/* ---------------- Slots ---------------- */}
      <Typography variant="h6" sx={{ mb: 1.5 }}>Slots</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, maxWidth: 480 }}>
        <TextField
          fullWidth size="small" placeholder="New slot name (e.g. Logo, Background)" value={newSlot}
          onChange={(e) => setNewSlot(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSlot(); }}
          inputProps={{ maxLength: 80 }}
        />
        <Button variant="contained" startIcon={<AddIcon />} onClick={addSlot} disabled={!newSlot.trim()}>Add</Button>
      </Box>

      {slots.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
          No slots yet. A slot is a named place for one image; fill it by sending yourself (or a guest) a one-time upload link.
        </Typography>
      ) : (
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {slots.map((slot) => {
            const waiting = !!slot.pendingUntil && new Date(slot.pendingUntil) > new Date();
            return (
              <Grid item xs={12} sm={6} lg={4} key={slot._id}>
                <Card>
                  <Box
                    sx={{
                      height: 160, display: 'grid', placeItems: 'center', bgcolor: 'var(--bg-subtle)',
                      borderBottom: '1px solid var(--border)', overflow: 'hidden'
                    }}
                  >
                    {slot.assetId ? (
                      <Box component="img" src={hubAssetUrl(slot.assetId._id)} alt={slot.name} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Empty</Typography>
                    )}
                  </Box>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle1" noWrap sx={{ flex: 1 }}>{slot.name}</Typography>
                      {waiting && <Chip size="small" label="Waiting for upload" color="warning" />}
                    </Box>
                    {slot.assetId && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap component="div">
                        {slot.assetId.originalFileName}{slot.assetId.width ? ` · ${slot.assetId.width}×${slot.assetId.height}` : ''}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 1.5 }}>
                      <Button size="small" startIcon={<LinkIcon />} onClick={() => requestLink(slot)}>
                        {slot.assetId ? 'Replace' : 'Upload link'}
                      </Button>
                      <Box sx={{ flex: 1 }} />
                      <Tooltip title="Delete slot">
                        <IconButton size="small" aria-label="Delete slot" onClick={() => removeSlot(slot)}><DeleteIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* ---------------- Versions ---------------- */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>Poster versions</Typography>
        <Button variant="contained" startIcon={<PaletteIcon />} onClick={() => openComposer(null)}>New version</Button>
      </Box>

      {versions.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No versions yet. Compose a poster from your slot images and text; every save is kept as a new version.
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {versions.map((v) => (
            <Grid item xs={12} sm={6} lg={4} key={v._id}>
              <Card>
                <Box
                  onClick={() => setViewing(v)}
                  sx={{ cursor: 'pointer', height: 200, display: 'grid', placeItems: 'center', bgcolor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', overflow: 'hidden' }}
                >
                  <Box component="img" src={hubAssetUrl(v.renderedAssetId._id)} alt={`Version ${v.number}`} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </Box>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1">Version {v.number}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {new Date(v.createdAt).toLocaleString()} · {v.structuredData.width}×{v.structuredData.height}
                    </Typography>
                  </Box>
                  <Tooltip title="Edit as a new version">
                    <IconButton size="small" aria-label="Edit as new version" onClick={() => openComposer(v.structuredData)}><EditIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <PosterComposer open={composerOpen} onClose={() => setComposerOpen(false)} slots={slots} initial={composerInitial} onSubmit={renderVersion} />

      {link && (
        <UploadLinkDialog open onClose={() => setLink(null)} slotName={link.slotName} pageUrl={link.pageUrl} expiresAt={link.expiresAt} />
      )}

      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="md" fullWidth>
        <DialogTitle>Version {viewing?.number}</DialogTitle>
        <DialogContent>
          {viewing && (
            <Box component="img" src={hubAssetUrl(viewing.renderedAssetId._id)} alt={`Version ${viewing.number}`} sx={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
