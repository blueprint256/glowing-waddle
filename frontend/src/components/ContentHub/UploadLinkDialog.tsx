import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';

interface Props {
  open: boolean;
  onClose: () => void;
  slotName: string;
  pageUrl: string;
  expiresAt: string;
}

/** Shows the one-time upload link for a slot, ready to copy or open on another device. */
export default function UploadLinkDialog({ open, onClose, slotName, pageUrl, expiresAt }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the field below is selectable */
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Upload link for “{slotName}”</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Open this link on any device — no login needed. It accepts one image, then stops working.
          Expires at {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField fullWidth size="small" value={pageUrl} InputProps={{ readOnly: true }} onFocus={(e) => e.target.select()} />
          <Button variant="outlined" startIcon={<CopyIcon />} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </Box>
        <Alert severity="info" sx={{ mt: 2 }}>
          Anyone with this link can upload into this slot until it expires. Generate a new link to revoke this one.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => window.open(pageUrl, '_blank', 'noopener')}>Open page</Button>
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
