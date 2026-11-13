import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { CloudUpload as CloudUploadIcon, CheckCircle as CheckIcon } from '@mui/icons-material';
import { hubUploadAPI } from '../../services/api';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 20 * 1024 * 1024;

type Phase = 'checking' | 'invalid' | 'ready' | 'uploading' | 'done';

interface LinkInfo {
  slotName: string;
  projectName: string;
  expiresAt: string;
}

/**
 * Public, login-free page opened from a one-time upload link.
 * Drop an image anywhere, paste it (Ctrl/Cmd+V), or pick one — on phones the picker offers the gallery/camera.
 */
export default function HubUpload() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Is the link still good, and what is it for?
  useEffect(() => {
    if (!token) {
      setPhase('invalid');
      setError('This link is missing its upload token.');
      return;
    }
    hubUploadAPI
      .info(token)
      .then((res) => {
        setInfo(res.data);
        setPhase('ready');
      })
      .catch((e) => {
        setError(e.response?.data?.message || 'This upload link is invalid, expired or already used.');
        setPhase('invalid');
      });
  }, [token]);

  const choose = useCallback((candidate: File | undefined | null) => {
    if (!candidate) return;
    if (!ALLOWED.includes(candidate.type)) {
      setError('Please choose a PNG, JPEG, WebP or GIF image.');
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError('That file is larger than 20 MB.');
      return;
    }
    setError('');
    setFile(candidate);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(candidate);
    });
  }, []);

  // Paste anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (phase !== 'ready') return;
      const image = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
      if (image) {
        e.preventDefault();
        choose(image);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [phase, choose]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const upload = async () => {
    if (!file) return;
    setPhase('uploading');
    setError('');
    try {
      await hubUploadAPI.upload(token, file);
      setPhase('done');
    } catch (e: any) {
      setError(e.response?.data?.message || 'Upload failed. Please try again.');
      // A rejected file keeps the link alive; a dead link cannot be retried.
      setPhase(e.response?.status === 410 || e.response?.status === 404 ? 'invalid' : 'ready');
    }
  };

  return (
    <Box
      onDragOver={(e) => { e.preventDefault(); if (phase === 'ready') setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (phase === 'ready') choose(e.dataTransfer.files?.[0]);
      }}
      sx={{
        minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2,
        bgcolor: 'var(--bg-shell)', outline: dragging ? '2px dashed var(--border-strong)' : 'none', outlineOffset: -12
      }}
    >
      <Box
        sx={{
          width: '100%', maxWidth: 480, p: { xs: 2.5, sm: 4 }, borderRadius: 'var(--r-panel)',
          bgcolor: 'var(--bg-panel)', border: '1px solid var(--border)', textAlign: 'center'
        }}
      >
        {phase === 'checking' && <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />}

        {phase === 'invalid' && (
          <>
            <Typography variant="h5" gutterBottom>Link unavailable</Typography>
            <Alert severity="warning" sx={{ textAlign: 'left' }}>{error}</Alert>
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
              Ask for a new upload link from the app that sent you here.
            </Typography>
          </>
        )}

        {phase === 'done' && (
          <>
            <CheckIcon sx={{ fontSize: 48, color: 'var(--success)' }} />
            <Typography variant="h5" gutterBottom>Uploaded</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Your image is now in “{info?.slotName}”. You can close this page — the link has been used.
            </Typography>
          </>
        )}

        {(phase === 'ready' || phase === 'uploading') && info && (
          <>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>{info.projectName}</Typography>
            <Typography variant="h5" gutterBottom>Upload to “{info.slotName}”</Typography>

            {preview ? (
              <Box
                component="img"
                src={preview}
                alt="Selected image preview"
                sx={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-raised)', mb: 2 }}
              />
            ) : (
              <Box
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
                sx={{
                  my: 2, p: 4, cursor: 'pointer', borderRadius: 'var(--r-card)',
                  border: '2px dashed var(--border-strong)', color: 'text.secondary',
                  '&:hover': { bgcolor: 'var(--bg-raised)' }
                }}
              >
                <CloudUploadIcon sx={{ fontSize: 40 }} />
                <Typography sx={{ mt: 1 }}>Drop an image here, paste it, or tap to choose</Typography>
                <Typography variant="caption">PNG, JPEG, WebP or GIF · up to 20 MB</Typography>
              </Box>
            )}

            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }}
            />

            {error && <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>{error}</Alert>}

            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              {file && (
                <Button onClick={() => inputRef.current?.click()} disabled={phase === 'uploading'}>
                  Choose another
                </Button>
              )}
              <Button variant="contained" onClick={upload} disabled={!file || phase === 'uploading'}>
                {phase === 'uploading' ? 'Uploading…' : 'Upload'}
              </Button>
            </Box>

            <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
              One-time link · expires {new Date(info.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Typography>
          </>
        )}
      </Box>
    </Box>
  );
}
