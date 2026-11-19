import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as PassIcon,
  Cancel as FailIcon,
  Code as CodeIcon,
  PlayArrow as TestIcon,
  AutoAwesome as ChangeIcon,
  Upload as UploadIcon
} from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import { useConfirm } from '../../components/ui/useConfirm';
import { adminDesignAPI, POSTER_FORMATS, type AdminDesign, type AdminDesignStatus, type DesignPreview } from '../../services/design';
import { errorMessage, notify } from '../../store/toastStore';
import { paths } from '../../lib/paths';

/**
 * Poster designs (System Admin): the design library. Built-in designs, and designs imported from a
 * reference poster by the AI importer: each goes through the stress test (every shape, ordinary
 * words with three and six partners, short words) and is approved by a person before the art
 * director can use it. Designs can be changed by describing the change, or by editing their code.
 */

const STATUS: Record<AdminDesignStatus, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  builtin: { label: 'Built in', color: 'info' },
  importing: { label: 'Working…', color: 'warning' },
  failed: { label: 'Failed', color: 'error' },
  draft: { label: 'Waiting for approval', color: 'warning' },
  live: { label: 'In use', color: 'success' },
  retired: { label: 'Retired', color: 'default' }
};

const CASE_LABEL: Record<string, string> = {
  'typical-3': 'Ordinary words, 3 partners',
  'typical-6': 'Ordinary words, 6 partners',
  'short-0': 'Short words, no partners',
  'long-6': 'Very long words (stress only)'
};

const BUILTIN_PREFIX = 'builtin:';

export default function PosterDesignsPage() {
  const { designId } = useParams<{ designId?: string }>();
  return designId ? <DesignDetail key={designId} id={decodeURIComponent(designId)} /> : <DesignList />;
}

// ---------------------------------------------------------------------------------------------------

function DesignList() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ builtin: AdminDesign[]; imported: AdminDesign[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    adminDesignAPI
      .list()
      .then(setData)
      .catch((e) => setError(errorMessage(e, 'The designs couldn’t load.')));
  }, []);
  useEffect(load, [load]);
  // While the AI is working on one, keep the list fresh.
  const working = data?.imported.some((d) => d.status === 'importing');
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [working, load]);

  const groups = useMemo(() => {
    if (!data) return null;
    return {
      inUse: [...data.builtin, ...data.imported.filter((d) => d.status === 'live')],
      drafts: data.imported.filter((d) => d.status === 'draft' || d.status === 'importing' || d.status === 'failed'),
      retired: data.imported.filter((d) => d.status === 'retired')
    };
  }, [data]);

  return (
    <Box>
      <PageHeader
        title="Poster designs"
        subtitle="The layouts the art director chooses from. Add one by importing a reference poster: the AI turns its structure into an original design, tests it in every shape, and you approve it."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setImporting(true)}>
            Import from a reference
          </Button>
        }
      />
      {error && <Alert severity="error">{error}</Alert>}
      {!groups && !error && <CircularProgress size={22} />}
      {groups && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Section title="Waiting for you" hint="Imported designs: check the test renders, then approve or ask for changes." items={groups.drafts} empty="Nothing waiting." />
          <Section title="In use" hint="Offered to the art director for every poster." items={groups.inUse} />
          {groups.retired.length > 0 && <Section title="Retired" hint="Kept so existing posters can still be edited; not offered for new ones." items={groups.retired} />}
        </Box>
      )}
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onStarted={(d) => {
          setImporting(false);
          navigate(paths.adminDesigns(d.id));
        }}
      />
    </Box>
  );
}

function Section({ title, hint, items, empty }: { title: string; hint: string; items: AdminDesign[]; empty?: string }) {
  return (
    <Box component="section">
      <Typography component="h2" sx={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>
        {title}
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', mb: 1.25 }}>{hint}</Typography>
      {items.length ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 1.5 }}>
          {items.map((d) => (
            <DesignCard key={d.source + d.id} d={d} />
          ))}
        </Box>
      ) : (
        <Typography sx={{ fontSize: 13.5, color: 'var(--text-faint)' }}>{empty}</Typography>
      )}
    </Box>
  );
}

function DesignCard({ d }: { d: AdminDesign }) {
  const thumb = d.previews?.find((p) => p.format === 'portrait' && p.case === 'typical-3') || d.previews?.[0];
  const to = paths.adminDesigns(d.source === 'builtin' ? BUILTIN_PREFIX + d.designId : d.id);
  return (
    <Box
      component={RouterLink}
      to={to}
      sx={{
        display: 'flex', flexDirection: 'column', gap: 1, p: 1.25, borderRadius: 'var(--r-card)', border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit',
        '&:hover, &:focus-visible': { borderColor: 'var(--border-strong)', bgcolor: 'var(--bg-subtle)' }
      }}
    >
      <Box sx={{ aspectRatio: '4 / 5', borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
        {thumb ? (
          <Box component="img" src={thumb.url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : d.status === 'importing' ? (
          <Box sx={{ textAlign: 'center', p: 2 }}>
            <CircularProgress size={20} />
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 1 }}>{d.message || 'Working…'}</Typography>
          </Box>
        ) : (
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-faint)', p: 2, textAlign: 'center' }}>{d.source === 'builtin' ? 'Open to see its test renders' : 'No renders yet'}</Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</Typography>
        <Chip size="small" label={STATUS[d.status].label} color={STATUS[d.status].color} variant={d.status === 'live' || d.status === 'builtin' ? 'outlined' : 'filled'} />
      </Box>
      {d.test && (
        <Typography sx={{ fontSize: 12, color: d.test.failed ? 'var(--st-attention-fg)' : 'var(--text-muted)' }}>
          {d.test.failed ? `${d.test.failed} test case${d.test.failed === 1 ? '' : 's'} failing` : `Passes all ${d.test.passed} test cases`}
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------------------------------

function ImportDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (d: AdminDesign) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!open) {
      setFile(null);
      setName('');
      setNote('');
      setRights(false);
    }
  }, [open]);

  const start = async () => {
    if (!file || !rights) return;
    setBusy(true);
    try {
      const d = await adminDesignAPI.import(file, { name: name.trim() || undefined, note: note.trim() || undefined });
      notify('Designing from the reference: this takes a few minutes');
      onStarted(d);
    } catch (e) {
      notify(errorMessage(e, 'The import couldn’t start.'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Import a design from a reference</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
          Choose a poster whose layout you’d like clubs to have. The AI takes its structure (grid, proportions, how photo and words meet) and writes an original design that uses each club’s own colours, fonts, logos and photos. It
          then tests it in every shape and fixes what fails. Takes a few minutes; nothing is offered to clubs until you approve it.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Box sx={{ width: 120, aspectRatio: '4 / 5', borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)', border: '1px dashed var(--border-strong)', overflow: 'hidden', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            {preview ? <Box component="img" src={preview} alt="The reference" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Typography sx={{ fontSize: 12, color: 'var(--text-faint)' }}>No picture</Typography>}
          </Box>
          <Box>
            <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => ref.current?.click()} disabled={busy}>
              {file ? 'Choose another' : 'Choose the reference'}
            </Button>
            <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.75 }}>PNG, JPG or WebP, up to 20 MB.</Typography>
          </Box>
          <input
            ref={ref}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) setFile(f);
            }}
          />
        </Box>
        <TextField label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 60 }} placeholder="e.g. Framed band" />
        <TextField
          label="What should it be good for? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          multiline
          minRows={3}
          inputProps={{ maxLength: 2000 }}
          placeholder="e.g. Fundraising dinners with a guest of honour and many sponsors. Keep the big date block; make the sponsor strip calmer."
        />
        <FormControlLabel
          control={<Checkbox checked={rights} onChange={(e) => setRights(e.target.checked)} />}
          label={<Typography sx={{ fontSize: 13.5 }}>This picture is only a layout reference: its artwork, logos, photos and words won’t be copied.</Typography>}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={start} disabled={!file || !rights || busy} startIcon={busy ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : undefined}>
          Start
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------

function DesignDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const builtin = id.startsWith(BUILTIN_PREFIX) ? id.slice(BUILTIN_PREFIX.length) : null;
  const [design, setDesign] = useState<AdminDesign | null>(null);
  const [template, setTemplate] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      if (builtin) {
        const list = await adminDesignAPI.list();
        const d = list.builtin.find((x) => x.designId === builtin);
        if (!d) throw new Error('Design not found');
        setDesign((prev) => (prev ? { ...d, test: prev.test, previews: prev.previews } : d));
      } else {
        const r = await adminDesignAPI.get(id);
        setDesign(r.design);
        setTemplate(r.template);
      }
    } catch (e) {
      setError(errorMessage(e, 'The design couldn’t load.'));
    }
  }, [id, builtin]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (design?.status !== 'importing') return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [design?.status, load]);

  const act = async (key: string, fn: () => Promise<AdminDesign | void>, done?: string) => {
    setBusy(key);
    try {
      const d = await fn();
      if (d) setDesign(d);
      if (done) notify(done);
    } catch (e) {
      notify(errorMessage(e, 'That didn’t work.'), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!design) return <CircularProgress size={22} />;

  const working = design.status === 'importing';
  const canApprove = !builtin && design.status === 'draft' && !!design.test && !design.test.failed && design.test.passed > 0;

  return (
    <Box>
      <PageHeader
        crumbs={[{ label: 'Poster designs', to: paths.adminDesigns() }, { label: design.name }]}
        title={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            {design.name}
            <Chip size="small" label={STATUS[design.status].label} color={STATUS[design.status].color} />
          </Box>
        }
        subtitle={design.description || undefined}
        actions={
          builtin ? (
            <Button variant="contained" startIcon={busy === 'test' ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <TestIcon />} disabled={busy !== null} onClick={() => act('test', async () => {
              const r = await adminDesignAPI.builtinTest(builtin);
              setDesign((d) => (d ? { ...d, test: r.test, previews: r.previews } : d));
            })}>
              {design.previews ? 'Test again' : 'Run the stress test'}
            </Button>
          ) : (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {design.status !== 'retired' && design.status !== 'failed' && (
                <Button startIcon={<CodeIcon />} disabled={working || busy !== null || !template} onClick={() => setEditing(true)}>
                  Edit code
                </Button>
              )}
              {(design.status === 'draft' || design.status === 'live') && (
                <Button startIcon={busy === 'test' ? <CircularProgress size={14} /> : <TestIcon />} disabled={working || busy !== null} onClick={() => act('test', () => adminDesignAPI.test(design.id), 'Tested')}>
                  Test again
                </Button>
              )}
              {design.status === 'live' && (
                <Button color="warning" disabled={busy !== null} onClick={async () => {
                  if (await confirm({ title: 'Retire this design?', body: 'New posters won’t use it. Posters already made with it can still be edited.', action: 'Retire' })) act('retire', () => adminDesignAPI.retire(design.id), 'Design retired');
                }}>
                  Retire
                </Button>
              )}
              {(design.status === 'draft' || design.status === 'failed' || design.status === 'retired') && (
                <Button color="error" disabled={busy !== null || working} onClick={async () => {
                  if (await confirm({ title: 'Delete this design?', body: 'Its code and test renders go. This can’t be undone.', action: 'Delete', danger: true })) {
                    await act('delete', () => adminDesignAPI.remove(design.id), 'Design deleted');
                    navigate(paths.adminDesigns());
                  }
                }}>
                  Delete
                </Button>
              )}
              {(design.status === 'draft' || design.status === 'retired') && (
                <Tooltip title={canApprove ? '' : 'It must pass every test case first'}>
                  <span>
                    <Button variant="contained" disabled={busy !== null || (design.status === 'draft' && !canApprove)} onClick={() => act('approve', () => adminDesignAPI.approve(design.id), 'Approved: posters can use it now')}>
                      {design.status === 'retired' ? 'Use again' : 'Approve'}
                    </Button>
                  </span>
                </Tooltip>
              )}
            </Box>
          )
        }
      />

      {working && (
        <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ mb: 2 }}>
          {design.message || 'Working on it'}… You can leave this page; it carries on.
        </Alert>
      )}
      {design.error && !working && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {design.error}
        </Alert>
      )}

      {!builtin && (design.notes || design.sourceNote) && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
          {design.sourceNote && <Note title="What it was asked for">{design.sourceNote}</Note>}
          {design.notes && <Note title="What the importer took and changed">{design.notes}</Note>}
        </Box>
      )}

      {!builtin && design.status !== 'retired' && (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!request.trim()) return;
            act('revise', () => adminDesignAPI.revise(design.id, request.trim()), 'Making the change').then(() => setRequest(''));
          }}
          sx={{ display: 'flex', gap: 1, mb: 2.5, alignItems: 'flex-start' }}
        >
          <TextField
            size="small"
            fullWidth
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            disabled={working || busy !== null}
            placeholder="Ask for a change… e.g. “give the partners a white band” or “make the story version less crowded”"
            inputProps={{ maxLength: 1500, 'aria-label': 'Describe a change to the design' }}
          />
          <Button type="submit" variant="outlined" startIcon={busy === 'revise' ? <CircularProgress size={14} /> : <ChangeIcon />} disabled={working || busy !== null || !request.trim()} sx={{ flexShrink: 0, height: 40 }}>
            Change
          </Button>
        </Box>
      )}

      {design.test && <TestSummary test={design.test} cost={design.cost} />}
      {design.previews?.length ? <PreviewGrid previews={design.previews} /> : !working && <Typography sx={{ color: 'var(--text-muted)', fontSize: 14 }}>{builtin ? 'Run the stress test to see this design in every shape.' : 'No test renders yet.'}</Typography>}

      {editing && template && (
        <CodeDialog
          template={template}
          onClose={() => setEditing(false)}
          onSave={async (t) => {
            const r = await adminDesignAPI.save(design.id, t);
            setDesign(r.design);
            setTemplate(r.template);
            setEditing(false);
            notify(r.message);
          }}
        />
      )}
      {confirmDialog}
    </Box>
  );
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 'var(--r-card)', bgcolor: 'var(--bg-subtle)' }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-muted)', mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: 13.5, color: 'var(--text-strong)', whiteSpace: 'pre-wrap' }}>{children}</Typography>
    </Box>
  );
}

function TestSummary({ test, cost }: { test: NonNullable<AdminDesign['test']>; cost?: number }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: 14, fontWeight: 600, color: test.failed ? 'var(--st-attention-fg)' : 'var(--text-strong)' }}>
        {test.failed ? `${test.failed} of ${test.passed + test.failed} test cases fail` : `Passes all ${test.passed} test cases`}
        <Box component="span" sx={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12.5 }}>
          {' '}
          · tested {new Date(test.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {cost ? ` · AI cost so far $${cost.toFixed(2)}` : ''}
        </Box>
      </Typography>
      {test.problems.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5, fontSize: 13, color: 'var(--text-strong)' }}>
          {test.problems.slice(0, 12).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </Box>
      )}
    </Box>
  );
}

function PreviewGrid({ previews }: { previews: DesignPreview[] }) {
  const [open, setOpen] = useState<DesignPreview | null>(null);
  const formats = POSTER_FORMATS.map((f) => f.value).concat(['a3']).filter((f, i, all) => all.indexOf(f) === i && previews.some((p) => p.format === f));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {formats.map((f) => (
        <Box key={f}>
          <Typography sx={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)', mb: 1 }}>{POSTER_FORMATS.find((x) => x.value === f)?.label || f.toUpperCase()}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1.25 }}>
            {previews
              .filter((p) => p.format === f)
              .map((p) => (
                <Box key={p.case} component="button" type="button" onClick={() => setOpen(p)} sx={{ all: 'unset', cursor: 'zoom-in', display: 'flex', flexDirection: 'column', gap: 0.5, '&:focus-visible': { outline: '2px solid var(--focus, #3b82f6)', outlineOffset: 2 } }}>
                  <Box component="img" src={p.url} alt={`${f}, ${CASE_LABEL[p.case] || p.case}`} sx={{ width: '100%', borderRadius: 'var(--r-ctl)', border: '1px solid var(--border)', opacity: p.counted ? 1 : 0.8 }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12, color: 'var(--text-muted)' }}>
                    {p.counted ? p.passed ? <PassIcon sx={{ fontSize: 15, color: 'var(--st-done-fg, #15803d)' }} /> : <FailIcon sx={{ fontSize: 15, color: 'var(--st-attention-fg)' }} /> : null}
                    {CASE_LABEL[p.case] || p.case}
                  </Box>
                </Box>
              ))}
          </Box>
        </Box>
      ))}
      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} maxWidth="md">
        {open && (
          <>
            <DialogTitle sx={{ fontSize: 16 }}>
              {POSTER_FORMATS.find((x) => x.value === open.format)?.label || open.format} · {CASE_LABEL[open.case] || open.case}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Box component="img" src={open.url} alt="" sx={{ maxWidth: 'min(540px, 100%)', borderRadius: 'var(--r-ctl)' }} />
              <Box sx={{ flex: 1, minWidth: 200 }}>
                {open.issues.length ? (
                  <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 13.5 }}>
                    {open.issues.map((i, k) => (
                      <li key={k}>{i}</li>
                    ))}
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>No problems found.</Typography>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpen(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}

function CodeDialog({ template, onClose, onSave }: { template: Record<string, unknown>; onClose: () => void; onSave: (t: Record<string, unknown>) => Promise<void> }) {
  const { html, css, ...meta } = template as Record<string, any>;
  const [metaText, setMetaText] = useState(JSON.stringify({ ...meta, source: undefined }, null, 2));
  const [htmlText, setHtmlText] = useState(String(html || ''));
  const [cssText, setCssText] = useState(String(css || ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(metaText);
    } catch {
      setError('The settings aren’t valid JSON.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...parsed, html: htmlText, css: cssText });
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t save.'));
    } finally {
      setSaving(false);
    }
  };
  const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 };
  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="lg">
      <DialogTitle>Edit the design’s code</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>Saving checks the design and runs the stress test (about half a minute). A design in use goes back to waiting for approval.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Description, limits and settings (JSON)" value={metaText} onChange={(e) => setMetaText(e.target.value)} multiline minRows={8} maxRows={18} inputProps={{ style: mono, spellCheck: false }} />
        <TextField label="HTML" value={htmlText} onChange={(e) => setHtmlText(e.target.value)} multiline minRows={8} maxRows={20} inputProps={{ style: mono, spellCheck: false }} />
        <TextField label="CSS" value={cssText} onChange={(e) => setCssText(e.target.value)} multiline minRows={10} maxRows={24} inputProps={{ style: mono, spellCheck: false }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : undefined}>
          {saving ? 'Testing…' : 'Save and test'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
