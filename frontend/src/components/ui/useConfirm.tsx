import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

/**
 * An in-app "Are you sure?" instead of the browser's pop-up (which looks out of place, can't be
 * styled and blocks the page).
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title: 'Delete this prompt?', body: 'This can’t be undone.', action: 'Delete', danger: true }))) return;
 *   …
 *   return <>{…}{confirmDialog}</>;
 */
export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The button that goes ahead ("Delete", "Send"). */
  action?: string;
  /** The button that backs out (default "Cancel"). */
  cancel?: string;
  /** Red button for things that remove or can't be undone. */
  danger?: boolean;
}

export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false); // a previous question left open counts as "no"
        resolver.current = resolve;
        setOptions(next);
      }),
    []
  );

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  const dialog = (
    <Dialog open={Boolean(options)} onClose={() => finish(false)} maxWidth="xs" fullWidth>
      <DialogTitle>{options?.title}</DialogTitle>
      {options?.body && (
        <DialogContent>
          {typeof options.body === 'string' ? <Typography sx={{ fontSize: 14 }}>{options.body}</Typography> : options.body}
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={() => finish(false)}>{options?.cancel || 'Cancel'}</Button>
        <Button variant="contained" color={options?.danger ? 'error' : 'primary'} onClick={() => finish(true)} autoFocus>
          {options?.action || 'OK'}
        </Button>
      </DialogActions>
    </Dialog>
  );

  return [confirm, dialog];
}
