import { useCallback, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

/**
 * "Save your changes?" before leaving a post editor that has unsaved edits. Used wherever a
 * PostEditor sits inside something that can close (the post panel, Blue's side panel).
 *
 *   const unsaved = useUnsavedGuard();
 *   <PostEditor onDirtyChange={unsaved.setDirty} registerSave={unsaved.registerSave} … />
 *   onClose={() => unsaved.guard(close)}
 *   {unsaved.dialog}
 */
export function useUnsavedGuard() {
  const dirtyRef = useRef(false);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [asking, setAsking] = useState<null | (() => void)>(null);
  const [saving, setSaving] = useState(false);

  /** Runs `then` now, or after asking when there are unsaved changes. */
  const guard = useCallback((then: () => void) => {
    if (dirtyRef.current) setAsking(() => then);
    else then();
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const registerSave = useCallback((save: (() => Promise<boolean>) | null) => {
    saveRef.current = save;
  }, []);

  /** Forget unsaved state (e.g. the post was deleted). */
  const reset = useCallback(() => {
    dirtyRef.current = false;
  }, []);

  const proceed = () => {
    const then = asking;
    dirtyRef.current = false;
    setAsking(null);
    then?.();
  };

  const dialog = (
    <Dialog open={Boolean(asking)} onClose={() => !saving && setAsking(null)} maxWidth="xs" fullWidth>
      <DialogTitle>Save your changes?</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 14 }}>This post has changes you haven’t saved.</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setAsking(null)} disabled={saving}>
          Keep editing
        </Button>
        <Button color="error" onClick={proceed} disabled={saving}>
          Discard
        </Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              const ok = saveRef.current ? await saveRef.current() : true;
              if (ok) proceed();
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { guard, setDirty, registerSave, reset, dialog };
}
