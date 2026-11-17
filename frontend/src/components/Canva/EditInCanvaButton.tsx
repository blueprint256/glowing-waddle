import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { Brush as BrushIcon, Download as BringBackIcon } from '@mui/icons-material';
import { canvaAPI } from '../../services/canva';

interface Props {
  target: { target: 'library'; assetId: string } | { target: 'task'; taskId: string };
  /** Called after a design was brought back, so the page can reload the image/versions. */
  onImported: (message: string) => void;
  disabled?: boolean;
}

/**
 * "Edit in Canva": sends the picture to the user's own Canva account and opens the editor in a new tab.
 * When they press Canva's "Return to Blueprint" button (or "Bring back from Canva" here), the edited
 * design is saved as a new version. Hidden when Canva isn't set up by the admin.
 */
export default function EditInCanvaButton({ target, onImported, disabled }: Props) {
  const [available, setAvailable] = useState(false);
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openEdit, setOpenEdit] = useState<{ id: string; status: string; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const autoImported = useRef(false);
  const key = target.target === 'library' ? target.assetId : target.taskId;

  const loadEdits = useCallback(async () => {
    try {
      const edits = await canvaAPI.edits(target.target === 'library' ? { assetId: target.assetId } : { taskId: target.taskId });
      setOpenEdit(edits[0] || null);
    } catch {
      setOpenEdit(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    canvaAPI
      .state()
      .then((s) => {
        setAvailable(s.available);
        if (s.available) loadEdits();
      })
      .catch(() => setAvailable(false));
  }, [loadEdits]);

  const bringBack = useCallback(
    async (id: string) => {
      setImporting(true);
      setError(null);
      try {
        const r = await canvaAPI.importEdit(id);
        onImported(r.message);
        setOpenEdit(null);
      } catch (e: any) {
        setError(e?.response?.data?.message || 'Could not bring the design back from Canva');
        loadEdits();
      } finally {
        setImporting(false);
      }
    },
    [onImported, loadEdits]
  );

  // Coming back from Canva's "Return to Blueprint" button: ?canvaEdit=<id>
  useEffect(() => {
    const id = params.get('canvaEdit');
    if (!id || autoImported.current) return;
    autoImported.current = true;
    const next = new URLSearchParams(params);
    next.delete('canvaEdit');
    setParams(next, { replace: true });
    bringBack(id);
  }, [params, setParams, bringBack]);

  if (!available) return null;

  const open = async () => {
    setOpening(true);
    setError(null);
    // Open the tab first (browsers block pop-ups opened after a delay), then point it at Canva.
    const tab = window.open('about:blank', '_blank');
    try {
      const url = await canvaAPI.startEdit(target);
      if (url) {
        if (tab) tab.location.href = url;
        else window.location.href = url;
        loadEdits();
      } else {
        tab?.close();
      }
    } catch (e: any) {
      tab?.close();
      setError(e?.response?.data?.message || 'Could not open Canva');
    } finally {
      setOpening(false);
    }
  };

  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" startIcon={opening ? <CircularProgress size={16} /> : <BrushIcon />} onClick={open} disabled={disabled || opening || importing}>
          Edit in Canva
        </Button>
        {openEdit && (
          <Button variant="contained" startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <BringBackIcon />} onClick={() => bringBack(openEdit.id)} disabled={importing}>
            {importing ? 'Bringing it back…' : 'Bring back from Canva'}
          </Button>
        )}
      </Box>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ maxWidth: 520 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
