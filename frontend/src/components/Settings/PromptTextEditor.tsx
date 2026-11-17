import { useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, TextField, Typography } from '@mui/material';
import { DataObject as PlaceholderIcon, Visibility as PreviewIcon } from '@mui/icons-material';
import api, { taskAPI } from '../../services/api';
import { errorMessage } from '../../store/toastStore';

/**
 * The text of a prompt with what makes it easy to get right (decision 22):
 * - "Insert placeholder" lists every {name} by group, with what it holds, and inserts at the cursor
 * - names that don't exist are flagged as you type, with the likely intended one and a Fix button
 * - "Preview with a post" shows the prompt filled in with a real post's brand, campaign and text
 * Older names ({taskDescription}, {companyInfo}…) keep working; the picker offers the new ones.
 */

interface Placeholder {
  name: string;
  group: string;
  description: string;
  aliasOf?: string;
  legacy?: boolean;
}

interface Check {
  used: string[];
  unknown: { name: string; suggestion?: string }[];
}

let catalog: Promise<Placeholder[]> | null = null;
/** Loaded once per page visit (tried again if it failed). */
const loadCatalog = (): Promise<Placeholder[]> => {
  const current =
    catalog ??
    api
      .get('/prompts/placeholders')
      .then((r) => r.data.placeholders as Placeholder[])
      .catch(() => {
        catalog = null;
        return [] as Placeholder[];
      });
  catalog = current;
  return current;
};

export default function PromptTextEditor({
  label,
  value,
  onChange,
  rows = 10,
  helperText,
  placeholder,
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  helperText?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [items, setItems] = useState<Placeholder[]>([]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    loadCatalog().then(setItems);
  }, []);

  // Check the names a moment after typing stops.
  useEffect(() => {
    if (!value.includes('{')) {
      setCheck(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .post('/prompts/check', { template: value })
        .then((r) => setCheck({ used: r.data.used || [], unknown: r.data.unknown || [] }))
        .catch(() => setCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [value]);

  const groups = useMemo(() => {
    const out = new Map<string, Placeholder[]>();
    for (const p of items) {
      if (p.legacy) continue;
      out.set(p.group, [...(out.get(p.group) || []), p]);
    }
    return [...out.entries()];
  }, [items]);

  const insert = (name: string) => {
    const el = inputRef.current;
    const token = `{${name}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    setMenu(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const fix = (wrong: string, right: string) => onChange(value.split(`{${wrong}}`).join(`{${right}}`));

  return (
    <Box sx={{ mt: 2 }}>
      <TextField
        fullWidth
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        multiline
        rows={rows}
        placeholder={placeholder}
        helperText={helperText}
        required={required}
        inputRef={inputRef}
        InputProps={{ sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13.5 } }}
      />
      <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" startIcon={<PlaceholderIcon />} onClick={(e) => setMenu(e.currentTarget)} disabled={!groups.length}>
          Insert placeholder
        </Button>
        <Button size="small" startIcon={<PreviewIcon />} onClick={() => setPreviewOpen(true)} disabled={!value.trim()}>
          Preview with a post
        </Button>
        {check && check.used.length > 0 && check.unknown.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>All {check.used.length} placeholder{check.used.length === 1 ? '' : 's'} recognised.</Typography>
        )}
      </Box>
      {check && check.unknown.length > 0 && (
        <Box role="alert" sx={{ mt: 1, p: 1.25, borderRadius: 'var(--r-card)', bgcolor: 'var(--st-attention-bg)', color: 'var(--st-attention-fg)', fontSize: 13 }}>
          <strong>Not recognised, so left as typed:</strong>
          {check.unknown.map((u) => (
            <Box key={u.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
              <code>{`{${u.name}}`}</code>
              {u.suggestion ? (
                <>
                  <span>Did you mean {`{${u.suggestion}}`}?</span>
                  <Button size="small" onClick={() => fix(u.name, u.suggestion!)} sx={{ color: 'inherit', textDecoration: 'underline', minWidth: 0, p: 0 }}>
                    Fix
                  </Button>
                </>
              ) : (
                <span>Not a placeholder the app fills in.</span>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)} PaperProps={{ sx: { maxHeight: 420, width: 380 } }}>
        {groups.map(([group, list]) => [
          <Typography key={`h-${group}`} sx={{ px: 2, pt: 1, pb: 0.5, fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
            {group}
          </Typography>,
          ...list.map((p) => (
            <MenuItem key={p.name} onClick={() => insert(p.name)} sx={{ display: 'block', whiteSpace: 'normal', py: 0.75 }}>
              <Box component="code" sx={{ fontSize: 13, fontWeight: 600 }}>{`{${p.name}}`}</Box>
              <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{p.description}</Typography>
            </MenuItem>
          ))
        ])}
      </Menu>

      <PreviewDialog open={previewOpen} template={value} onClose={() => setPreviewOpen(false)} />
    </Box>
  );
}

function PreviewDialog({ open, template, onClose }: { open: boolean; template: string; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<{ _id: string; name: string; campaign?: string }[]>([]);
  const [post, setPost] = useState<{ _id: string; name: string } | null>(null);
  const [compiled, setCompiled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      taskAPI
        .getAll({ search: query || undefined, limit: 20, sort: 'recent' })
        .then((r) => setOptions((r.data.tasks || []).map((x: any) => ({ _id: x._id, name: x.name, campaign: x.campaignId?.name }))))
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [open, query]);

  useEffect(() => {
    if (!open || !post) return;
    setBusy(true);
    setError(null);
    api
      .post('/prompts/preview', { template, taskId: post._id })
      .then((r) => setCompiled(r.data.compiled))
      .catch((e) => setError(errorMessage(e, 'Couldn’t preview the prompt.')))
      .finally(() => setBusy(false));
  }, [open, post, template]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Preview with a post</DialogTitle>
      <DialogContent>
        <Autocomplete
          options={options}
          value={post}
          onChange={(_, v) => setPost(v)}
          onInputChange={(_, v, reason) => reason === 'input' && setQuery(v)}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a._id === b._id}
          filterOptions={(x) => x}
          renderOption={(props, o) => (
            <li {...props} key={o._id}>
              <Box>
                <Typography sx={{ fontSize: 14 }}>{o.name}</Typography>
                {o.campaign && <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.campaign}</Typography>}
              </Box>
            </li>
          )}
          renderInput={(params) => <TextField {...params} label="Post" placeholder="Search posts" sx={{ mt: 1 }} />}
        />
        <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 1 }}>Filled in with that post’s brand, campaign, title, brief and caption. Nothing is sent to the AI.</Typography>
        <Box sx={{ mt: 2, minHeight: 160 }}>
          {busy ? (
            <CircularProgress size={20} sx={{ color: 'var(--text-muted)' }} />
          ) : error ? (
            <Typography sx={{ color: 'var(--st-attention-fg)', fontSize: 13.5 }}>{error}</Typography>
          ) : compiled !== null && post ? (
            <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-subtle)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, maxHeight: 420, overflow: 'auto' }}>
              {compiled}
            </Box>
          ) : (
            <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Choose a post to see the filled-in prompt.</Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
