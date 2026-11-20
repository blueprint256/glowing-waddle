import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from '@mui/material';
import {
  Add as AddIcon,
  AutoAwesome as AIIcon,
  CheckCircle as CheckedIcon,
  Close as CloseIcon,
  DashboardCustomizeOutlined as PosterIcon,
  WarningAmberRounded as WarnIcon
} from '@mui/icons-material';
import { designAPI, POSTER_FORMATS, STAGE_TEXT, type BrandKit, type PosterJobStage } from '../../services/design';
import { posterRunning, usePosterJobsStore } from '../../store/posterJobsStore';
import { isRunning, useAIJobsStore } from '../../store/aiJobsStore';
import { paths } from '../../lib/paths';
import type { AIUsage } from '../../services/api';
import type { LogoCorner, PictureFormat, PosterFormat, PostReference, ReferenceRole, Task } from '../../types';

/**
 * Create with AI: one place to make a post's picture from what it's about, the brand and the
 * pictures given.
 *  - Poster (the default): words, the real logo files and partners laid out by the design engine,
 *    checked before you see them, every line editable afterwards.
 *  - Photo: a picture with no words on it, for posts where the caption says it all (or to use as a
 *    poster's photo later).
 * Both use one AI picture from the month's allowance; edits to a poster are free.
 */

export type CreateMode = 'poster' | 'photo';

const MAX_REFERENCES = 6;
const MAX_POSTER_PHOTOS = 2;

const PHOTO_FORMATS: { value: PictureFormat; label: string; hint: string; ratio: string }[] = [
  { value: 'square', label: 'Square', hint: '1:1 · every platform', ratio: '1 / 1' },
  { value: 'portrait', label: 'Portrait', hint: '4:5 · Instagram, Facebook', ratio: '4 / 5' },
  { value: 'landscape', label: 'Landscape', hint: '3:2 · LinkedIn, X', ratio: '3 / 2' }
];

const CORNERS: { value: LogoCorner; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' }
];

/** The steps a poster goes through, as shown while it's being made. */
const STEPS: { label: string; stages: PosterJobStage[] }[] = [
  { label: 'Reading your brief', stages: ['queued', 'reading'] },
  { label: 'Creating a photo', stages: ['photo'] },
  { label: 'Planning layouts', stages: ['directing', 'background'] },
  { label: 'Setting the type', stages: ['rendering'] },
  { label: 'Checking every detail', stages: ['checking'] },
  { label: 'Choosing the best', stages: ['reviewing', 'saving', 'done'] }
];

export interface CreateWithAIProps {
  task: Task | null;
  title: string;
  brief: string;
  brandLogo: string | null;
  usage: AIUsage | null;
  mode: CreateMode;
  onMode: (mode: CreateMode) => void;
  busy: string | null;
  ensureSaved: () => Promise<string | null>;
  focusBrief: () => void;
  /** Opens "add a picture" next to this element, to be used as given. */
  onAddPicture: (anchor: HTMLElement, role: ReferenceRole) => void;
  onRemovePicture: (ref: PostReference) => void;
  onSetRole: (ref: PostReference, role: ReferenceRole) => void;
  onView: (url: string) => void;
}

export default function CreateWithAI({ task, title, brief, brandLogo, usage, mode, onMode, busy, ensureSaved, focusBrief, onAddPicture, onRemovePicture, onSetRole, onView }: CreateWithAIProps) {
  const taskId = task?._id || null;
  const references = task?.references || [];

  // Poster
  const posterJob = usePosterJobsStore((s) => (taskId ? s.jobs[taskId] : undefined));
  const startPoster = usePosterJobsStore((s) => s.start);
  const posterBusy = posterRunning(posterJob);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [kitError, setKitError] = useState(false);
  const [posterFormat, setPosterFormat] = useState<PosterFormat>('portrait');
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [partners, setPartners] = useState<string[]>([]);
  const [otherLogos, setOtherLogos] = useState<string[] | null>(null);
  const [aiPhoto, setAiPhoto] = useState(false);

  // Photo
  const photoJob = useAIJobsStore((s) => (taskId ? s.images[taskId] : undefined));
  const createImage = useAIJobsStore((s) => s.createImage);
  const photoBusy = isRunning(photoJob) && photoJob?.kind === 'create';
  const [photoFormat, setPhotoFormat] = useState<PictureFormat>(task?.pictureOptions?.format || 'square');
  const [logoOn, setLogoOn] = useState<boolean>(Boolean(task?.pictureOptions?.logo));
  const [corner, setCorner] = useState<LogoCorner>(task?.pictureOptions?.logo || 'bottom-right');

  const [now, setNow] = useState(Date.now());
  const working = posterBusy || photoBusy;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);

  useEffect(() => {
    let live = true;
    designAPI
      .kit(task?.ownerId ? String(task.ownerId) : undefined)
      .then((k) => live && setKit(k))
      .catch(() => live && setKitError(true));
    return () => {
      live = false;
    };
  }, [task?.ownerId]);

  // Photos a poster can use: the pictures to include, then the style ones, then the post's own
  // picture when it's a photo (not a poster already).
  const offered = useMemo(() => {
    const list = [...references.filter((r) => r.role === 'include'), ...references.filter((r) => r.role === 'style')].map((r) => ({ url: r.url, name: r.name || 'Picture', ref: r as PostReference | null }));
    if (task?.designedImage && !task.pictureDesign && !list.some((p) => p.url === task.designedImage)) list.push({ url: task.designedImage, name: 'The post’s picture', ref: null });
    return list;
  }, [references, task?.designedImage, task?.pictureDesign]);
  const chosenPhotos = photos ?? references.filter((r) => r.role === 'include').map((r) => r.url).slice(0, MAX_POSTER_PHOTOS);
  const kitOthers = (kit?.logos || []).filter((l) => l.role === 'campaign');
  const chosenOthers = otherLogos ?? kitOthers.filter((l) => l.always).map((l) => l.id);
  const hasMainLogo = (kit?.logos || []).some((l) => l.role === 'primary' && l.variants.length) || Boolean(brandLogo);

  const left = usage && !usage.unlimited && usage.images.limit > 0 ? usage.images.remaining ?? 0 : null;
  const outOfPictures = left !== null && left <= 0;
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const togglePhoto = (url: string) =>
    setPhotos((prev) => {
      const list = prev ?? chosenPhotos;
      if (list.includes(url)) return list.filter((u) => u !== url);
      return [...list, url].slice(-MAX_POSTER_PHOTOS);
    });

  const go = async () => {
    if (!brief.trim()) {
      focusBrief();
      return;
    }
    const id = taskId || (await ensureSaved());
    if (!id) return;
    if (mode === 'poster') await startPoster(id, title, { brief, format: posterFormat, photoUrls: chosenPhotos, partnerIds: partners, campaignLogoIds: chosenOthers, count: 4, aiPhoto: aiPhoto && !chosenPhotos.length });
    else await createImage(id, title, { description: brief, format: photoFormat, logo: logoOn && brandLogo ? corner : null });
  };

  const seconds = (startedAt?: number) => (startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0);
  // The photo step only shows when this poster makes one.
  const steps = posterJob?.stage === 'photo' || (aiPhoto && !chosenPhotos.length) ? STEPS : STEPS.filter((s) => !s.stages.includes('photo'));
  const stepIndex = posterJob ? Math.max(0, steps.findIndex((s) => s.stages.includes(posterJob.stage))) : 0;

  return (
    <Box id="create-with-ai" sx={{ mt: 1.5, p: 1.75, borderRadius: 'var(--r-card)', border: '1px solid var(--border)', bgcolor: 'var(--bg-raised)', display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <Box>
        <Typography sx={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>Create with AI</Typography>
        <Typography sx={{ fontSize: 13, color: brief.trim() ? 'var(--text-muted)' : 'var(--warning-text, var(--danger-text))', mt: 0.25 }}>
          {brief.trim() ? (
            <>Made from “What’s this post about?” and your brand{mode === 'poster' ? '. Put the facts there: what, when, where.' : '.'}</>
          ) : (
            <>
              First say what the post is about{' '}
              <Box component="button" type="button" onClick={focusBrief} sx={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
                at the top
              </Box>
              {mode === 'poster' ? ': what’s happening, when and where.' : '.'}
            </>
          )}
        </Typography>
      </Box>

      {/* What to make */}
      <ToggleButtonGroup exclusive fullWidth value={mode} onChange={(_, v) => v && onMode(v)} aria-label="What to make" disabled={working} sx={{ '& .MuiToggleButton-root': { textTransform: 'none', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', gap: 1, py: 1 } }}>
        <ToggleButton value="poster">
          <PosterIcon fontSize="small" sx={{ mt: '1px' }} />
          <Box>
            <Box sx={{ fontSize: 13.5, fontWeight: 650 }}>Poster</Box>
            <Box sx={{ fontSize: 12, opacity: 0.8, lineHeight: 1.3 }}>Your words, logo and partners, laid out and checked. Every line editable.</Box>
          </Box>
        </ToggleButton>
        <ToggleButton value="photo">
          <AIIcon fontSize="small" sx={{ mt: '1px' }} />
          <Box>
            <Box sx={{ fontSize: 13.5, fontWeight: 650 }}>Photo</Box>
            <Box sx={{ fontSize: 12, opacity: 0.8, lineHeight: 1.3 }}>A picture with no words on it, when the caption says it all.</Box>
          </Box>
        </ToggleButton>
      </ToggleButtonGroup>

      {mode === 'poster' && kit && !hasMainLogo && (
        <Notice>
          Add your logo in{' '}
          <Box component={RouterLink} to={paths.settings('brand')} sx={{ color: 'inherit', fontWeight: 600 }}>
            Settings › Brand
          </Box>{' '}
          first: every poster carries it.
        </Notice>
      )}
      {mode === 'poster' && kitError && <Notice>Your brand couldn’t be loaded. Try again in a moment.</Notice>}

      {/* Pictures */}
      <Box>
        <Label hint={mode === 'poster' ? `tick up to ${MAX_POSTER_PHOTOS}; without one, designs that need no photo are used` : `optional, up to ${MAX_REFERENCES}`}>{mode === 'poster' ? 'Photos' : 'Pictures to use'}</Label>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {mode === 'poster'
            ? offered.map((p) => {
                const on = chosenPhotos.includes(p.url);
                return (
                  <Box
                    key={p.url}
                    component="button"
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={p.name}
                    onClick={() => togglePhoto(p.url)}
                    sx={{
                      all: 'unset', cursor: 'pointer', position: 'relative', width: 84, height: 84, borderRadius: 'var(--r-ctl)', overflow: 'hidden', bgcolor: 'var(--bg-subtle)',
                      outline: on ? '2px solid var(--text-strong)' : '1px solid var(--border)', outlineOffset: on ? 1 : 0, opacity: on ? 1 : 0.72,
                      '&:focus-visible': { outline: '2px solid var(--focus, #3b82f6)' }
                    }}
                  >
                    <img src={p.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {on && <CheckedIcon sx={{ position: 'absolute', top: 4, right: 4, fontSize: 20, color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }} />}
                  </Box>
                );
              })
            : references.map((r) => (
                <Box key={r.id} sx={{ width: 112, borderRadius: 'var(--r-ctl)', border: '1px solid var(--border)', overflow: 'hidden', bgcolor: 'var(--bg-panel)', position: 'relative', opacity: busy === `ref:${r.id}` ? 0.6 : 1 }}>
                  <Box component="button" type="button" onClick={() => onView(r.url)} aria-label={`See ${r.name || 'picture'}`} sx={{ all: 'unset', cursor: 'zoom-in', display: 'block', width: '100%', aspectRatio: '1 / 1' }}>
                    <img src={r.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={`Remove ${r.name || 'picture'}`}
                    onClick={() => onRemovePicture(r)}
                    disabled={Boolean(busy)}
                    sx={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, bgcolor: 'rgba(0,0,0,.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,.8)' } }}
                  >
                    <CloseIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                  <Box sx={{ p: 0.5 }}>
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      fullWidth
                      value={r.role}
                      onChange={(_, v) => v && v !== r.role && onSetRole(r, v)}
                      aria-label={`How to use ${r.name || 'this picture'}`}
                      sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 0.5, fontSize: 11, textTransform: 'none', lineHeight: 1.3 } }}
                    >
                      <ToggleButton value="include">
                        <Tooltip title="A product, place or person to show as it is">
                          <span>Include</span>
                        </Tooltip>
                      </ToggleButton>
                      <ToggleButton value="style">
                        <Tooltip title="Layout, colours and mood only">
                          <span>Style</span>
                        </Tooltip>
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                </Box>
              ))}
          {references.length < MAX_REFERENCES && (
            <Box
              component="button"
              type="button"
              onClick={(e) => onAddPicture(e.currentTarget, 'include')}
              disabled={busy === 'ref:add'}
              sx={{
                all: 'unset', cursor: 'pointer', width: 84, height: 84, borderRadius: 'var(--r-ctl)', border: '1px dashed var(--border-strong)', display: 'grid', placeItems: 'center', textAlign: 'center',
                color: 'var(--text-muted)', fontSize: 12, '&:hover, &:focus-visible': { color: 'var(--text-strong)', borderColor: 'var(--text-muted)' }
              }}
            >
              {busy === 'ref:add' ? (
                <CircularProgress size={18} />
              ) : (
                <Box>
                  <AddIcon sx={{ display: 'block', mx: 'auto' }} />
                  Add a picture
                </Box>
              )}
            </Box>
          )}
        </Box>
        {mode === 'poster' && !chosenPhotos.length && (
          <Box sx={{ mt: 1 }}>
            <FormControlLabel
              control={<Checkbox size="small" checked={aiPhoto} onChange={(e) => setAiPhoto(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 13.5 }}>No photo? Let AI create one for this poster</Typography>}
              sx={{ mr: 0 }}
            />
            <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', pl: 3.75 }}>
              A realistic photo made from your brief, with no words on it. It’s added to this post’s pictures so you can reuse it. It’s an illustration: for real events, your own photos are more trustworthy.
            </Typography>
          </Box>
        )}
        {mode === 'poster' && <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.5 }}>Sharp, well-lit photos of real people make the strongest posters. Only use photos you have permission to share.</Typography>}
      </Box>

      {/* Shape */}
      <Box>
        <Label>Shape</Label>
        <ToggleButtonGroup size="small" exclusive value={mode === 'poster' ? posterFormat : photoFormat} onChange={(_, v) => v && (mode === 'poster' ? setPosterFormat(v) : setPhotoFormat(v))} aria-label="Shape" sx={{ flexWrap: 'wrap' }}>
          {(mode === 'poster' ? POSTER_FORMATS : PHOTO_FORMATS).map((f) => (
            <ToggleButton key={f.value} value={f.value} aria-label={`${f.label}, ${f.hint}`} sx={{ textTransform: 'none', gap: 0.75, px: 1.25 }}>
              <Box aria-hidden sx={{ width: 13, aspectRatio: f.ratio, border: '1.5px solid currentColor', borderRadius: '2px' }} />
              <Box sx={{ textAlign: 'left', lineHeight: 1.2 }}>
                <Box sx={{ fontSize: 13 }}>{f.label}</Box>
                <Box sx={{ fontSize: 11, opacity: 0.75 }}>{f.hint}</Box>
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Poster: other logos and partners */}
      {mode === 'poster' && kitOthers.length > 0 && (
        <Box>
          <Label hint="beside your logo, never in place of it">Other logos</Label>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {kitOthers.map((l) => (
              <LogoChip key={l.id} name={l.name} src={l.variants[0]?.url} on={chosenOthers.includes(l.id)} onClick={() => setOtherLogos(toggle(chosenOthers, l.id))} />
            ))}
          </Box>
        </Box>
      )}
      {mode === 'poster' && (
        <Box>
          <Label
            hint="sized so each looks equally important"
            right={
              <Box component={RouterLink} to={paths.settings('brand')} sx={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                {kit?.partners.length ? 'Manage' : 'Add partners'}
              </Box>
            }
          >
            Partners and sponsors
          </Label>
          {kit?.partners.length ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {kit.partners.map((p) => (
                <LogoChip key={p.id} name={p.name} src={p.logo.url} on={partners.includes(p.id)} onClick={() => setPartners(toggle(partners, p.id))} />
              ))}
            </Box>
          ) : (
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>None yet. Add partner logos once in Settings › Brand, then tick them here for any poster.</Typography>
          )}
        </Box>
      )}

      {/* Photo: the logo in a corner */}
      {mode === 'photo' && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Checkbox size="small" checked={logoOn && Boolean(brandLogo)} onChange={(e) => setLogoOn(e.target.checked)} disabled={!brandLogo} />}
              label={<Typography sx={{ fontSize: 13.5 }}>Add my logo</Typography>}
              sx={{ mr: 0 }}
            />
            {logoOn && brandLogo && (
              <ToggleButtonGroup size="small" exclusive value={corner} onChange={(_, v) => v && setCorner(v)} aria-label="Logo corner">
                {CORNERS.map((c) => (
                  <ToggleButton key={c.value} value={c.value} aria-label={c.label} sx={{ p: 0.5 }}>
                    <Tooltip title={c.label}>
                      <Box sx={{ display: 'flex' }}>
                        <CornerGlyph corner={c.value} active={corner === c.value} />
                      </Box>
                    </Tooltip>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}
          </Box>
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 0.25 }}>
            {brandLogo ? (
              'Your real logo file is placed on top, exactly as it is.'
            ) : (
              <>
                Add your logo in{' '}
                <Box component={RouterLink} to={paths.settings('brand')} sx={{ color: 'inherit', fontWeight: 600 }}>
                  Settings › Brand
                </Box>{' '}
                to place it on pictures.
              </>
            )}
          </Typography>
        </Box>
      )}

      {/* Go, or progress */}
      {posterBusy && posterJob ? (
        <Box role="status" aria-live="polite">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <CircularProgress size={16} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>{STAGE_TEXT[posterJob.stage] || 'Working'}…</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', ml: 'auto' }}>{formatSeconds(seconds(posterJob.startedAt))}</Typography>
          </Box>
          <LinearProgress variant="determinate" value={Math.max(4, Math.round(posterJob.progress * 100))} />
          <Box component="ol" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, listStyle: 'none', p: 0, m: 0, mt: 0.75 }}>
            {steps.map((s, i) => (
              <Box component="li" key={s.label} sx={{ fontSize: 12, color: i < stepIndex ? 'var(--text-muted)' : i === stepIndex ? 'var(--text-strong)' : 'var(--text-faint)', fontWeight: i === stepIndex ? 650 : 400 }}>
                {i < stepIndex ? '✓ ' : ''}
                {s.label}
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 0.75 }}>Usually 1–3 minutes. You can keep working or close the post; you’ll get a message when the options are ready.</Typography>
        </Box>
      ) : photoBusy && photoJob ? (
        <Box role="status" aria-live="polite">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <CircularProgress size={16} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>Creating the photo…</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', ml: 'auto' }}>{formatSeconds(seconds(photoJob.startedAt))}</Typography>
          </Box>
          <LinearProgress variant={seconds(photoJob.startedAt) < 60 ? 'determinate' : 'indeterminate'} value={Math.min(95, (seconds(photoJob.startedAt) / 60) * 100)} />
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 0.75 }}>Usually 20–60 seconds. You can keep working meanwhile.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={mode === 'poster' ? <PosterIcon /> : <AIIcon />}
            disabled={outOfPictures || Boolean(busy) || (mode === 'poster' && !kit && !kitError)}
            onClick={go}
          >
            {mode === 'poster' ? ((task?.aiDrafts || []).some((d) => d.kind === 'design') ? 'Design new options' : 'Design 4 options') : 'Create photo'}
          </Button>
          <Typography sx={{ fontSize: 12.5, color: outOfPictures ? 'var(--danger-text)' : 'var(--text-muted)' }}>
            {outOfPictures
              ? `You’ve used this month’s AI pictures. More on ${new Date(usage!.resetsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.`
              : `${left !== null ? `Uses 1 AI picture · ${left} left this month.` : mode === 'poster' ? 'Takes 1–3 minutes.' : 'Takes 20–60 seconds.'}${mode === 'poster' ? ' Edits to a poster are free.' : ''}`}
          </Typography>
        </Box>
      )}
      {mode === 'poster' && posterJob?.status === 'failed' && !posterBusy && <Notice>{posterJob.error || 'The last poster couldn’t be made.'} Nothing was used from your allowance.</Notice>}
    </Box>
  );
}

function formatSeconds(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function Label({ children, hint, right }: { children: string; hint?: string; right?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>
        {children}
        {hint && <Box component="span" sx={{ fontWeight: 400, color: 'var(--text-muted)' }}> ({hint})</Box>}
      </Typography>
      {right}
    </Box>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 1, borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-subtle)', fontSize: 13, color: 'var(--text-strong)' }}>
      <WarnIcon sx={{ fontSize: 18, color: 'var(--warning-text, #b45309)', mt: '1px' }} />
      <Box>{children}</Box>
    </Box>
  );
}

/** A small square showing which corner the logo goes in. */
function CornerGlyph({ corner, active }: { corner: LogoCorner; active: boolean }) {
  const top = corner.startsWith('top');
  const left = corner.endsWith('left');
  return (
    <Box aria-hidden sx={{ width: 22, height: 22, border: '1.5px solid currentColor', borderRadius: '4px', position: 'relative', opacity: active ? 1 : 0.7 }}>
      <Box sx={{ position: 'absolute', width: 7, height: 5, borderRadius: '1.5px', bgcolor: 'currentColor', [top ? 'top' : 'bottom']: 2.5, [left ? 'left' : 'right']: 2.5 }} />
    </Box>
  );
}

function LogoChip({ name, src, on, onClick }: { name: string; src?: string; on: boolean; onClick: () => void }) {
  return (
    <Tooltip title={name}>
      <Box
        component="button"
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={name}
        onClick={onClick}
        sx={{
          all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.75, height: 40, px: 1, borderRadius: 'var(--r-ctl)', bgcolor: '#fff',
          outline: on ? '2px solid var(--text-strong)' : '1px solid var(--border)', outlineOffset: on ? 1 : 0, opacity: on ? 1 : 0.7,
          '&:focus-visible': { outline: '2px solid var(--focus, #3b82f6)' }
        }}
      >
        {src && <img src={src} alt="" style={{ height: 26, maxWidth: 88, objectFit: 'contain', display: 'block' }} />}
        <Box component="span" sx={{ fontSize: 12.5, color: '#222', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </Box>
        {on && <CheckedIcon sx={{ fontSize: 16, color: '#222' }} />}
      </Box>
    </Tooltip>
  );
}
