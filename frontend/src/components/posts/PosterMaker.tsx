import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, CircularProgress, LinearProgress, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Add as AddIcon, CheckCircle as CheckedIcon, DashboardCustomizeOutlined as PosterIcon, WarningAmberRounded as WarnIcon } from '@mui/icons-material';
import { designAPI, POSTER_FORMATS, STAGE_TEXT, type BrandKit } from '../../services/design';
import { posterRunning, usePosterJobsStore } from '../../store/posterJobsStore';
import { paths } from '../../lib/paths';
import type { AIUsage } from '../../services/api';
import type { PosterFormat, Task } from '../../types';

/**
 * Design a poster: the post's brief becomes four finished poster options, laid out in code with
 * real type and the real logo files, checked for overflow, contrast and logo rules, then ranked.
 * Choose the photos, the shape, partners and campaign logos; the rest comes from the brand kit.
 */

const MAX_PHOTOS = 2;

export interface PosterMakerProps {
  task: Task | null;
  title: string;
  brief: string;
  usage: AIUsage | null;
  ensureSaved: () => Promise<string | null>;
  focusBrief: () => void;
  /** Opens "add a picture" (to include) next to this element. */
  onAddPhoto: (anchor: HTMLElement) => void;
}

export default function PosterMaker({ task, title, brief, usage, ensureSaved, focusBrief, onAddPhoto }: PosterMakerProps) {
  const taskId = task?._id || null;
  const job = usePosterJobsStore((s) => (taskId ? s.jobs[taskId] : undefined));
  const start = usePosterJobsStore((s) => s.start);
  const running = posterRunning(job);

  const [kit, setKit] = useState<BrandKit | null>(null);
  const [kitError, setKitError] = useState(false);
  const [format, setFormat] = useState<PosterFormat>('portrait');
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [partners, setPartners] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<string[] | null>(null);
  const [now, setNow] = useState(Date.now());

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

  // The photos on offer: the post's pictures to include, then its style pictures, then the current
  // picture when it's a photo (not a poster already).
  const offered = useMemo(() => {
    const refs = task?.references || [];
    const list = [...refs.filter((r) => r.role === 'include'), ...refs.filter((r) => r.role === 'style')].map((r) => ({ url: r.url, name: r.name || 'Picture' }));
    if (task?.designedImage && !task.pictureDesign && !list.some((p) => p.url === task.designedImage)) list.push({ url: task.designedImage, name: 'The post’s picture' });
    return list;
  }, [task?.references, task?.designedImage, task?.pictureDesign]);

  // Until chosen: the pictures to include (as many as a design takes).
  const chosenPhotos = photos ?? (task?.references || []).filter((r) => r.role === 'include').map((r) => r.url).slice(0, MAX_PHOTOS);
  const campaignLogos = (kit?.logos || []).filter((l) => l.role === 'campaign');
  const chosenCampaign = campaign ?? campaignLogos.filter((l) => l.always).map((l) => l.id);
  const hasMainLogo = (kit?.logos || []).some((l) => l.role === 'primary' && l.variants.length);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const seconds = running && job ? Math.max(0, Math.round((now - job.startedAt) / 1000)) : 0;

  const left = usage?.designs && !usage.unlimited && usage.designs.limit > 0 ? usage.designs.remaining ?? 0 : null;
  const outOfDesigns = left !== null && left <= 0;

  const togglePhoto = (url: string) =>
    setPhotos((prev) => {
      const list = prev ?? chosenPhotos;
      if (list.includes(url)) return list.filter((u) => u !== url);
      return [...list, url].slice(-MAX_PHOTOS);
    });
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const go = async () => {
    if (!brief.trim()) {
      focusBrief();
      return;
    }
    const id = taskId || (await ensureSaved());
    if (!id) return;
    await start(id, title, { brief, format, photoUrls: chosenPhotos, partnerIds: partners, campaignLogoIds: chosenCampaign, count: 4 });
  };

  return (
    <Box id="design-a-poster" sx={{ mt: 1.5, p: 1.75, borderRadius: 'var(--r-card)', border: '1px solid var(--border)', bgcolor: 'var(--bg-raised)', display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <Box>
        <Typography sx={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>Design a poster</Typography>
        <Typography sx={{ fontSize: 13, color: brief.trim() ? 'var(--text-muted)' : 'var(--warning-text, var(--danger-text))', mt: 0.25 }}>
          {brief.trim() ? (
            <>Four finished options from “What’s this post about?”, laid out with your fonts, colours and real logo files. Every option is checked before you see it.</>
          ) : (
            <>
              First say what the post is about{' '}
              <Box component="button" type="button" onClick={focusBrief} sx={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
                at the top
              </Box>
              : the event, the date, the place.
            </>
          )}
        </Typography>
      </Box>

      {kit && !hasMainLogo && (
        <Notice>
          Add your logo to the{' '}
          <Box component={RouterLink} to={paths.settings('brand')} sx={{ color: 'inherit', fontWeight: 600 }}>
            brand kit
          </Box>{' '}
          so posters carry it.
        </Notice>
      )}
      {kitError && <Notice>Your brand kit couldn’t be loaded. Posters will use your account’s logo and colours.</Notice>}

      {/* Photos */}
      <Box>
        <Label hint={`up to ${MAX_PHOTOS}; without one, designs that don’t need a photo are used`}>Photos</Label>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {offered.map((p) => {
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
          })}
          <Box
            component="button"
            type="button"
            onClick={(e) => onAddPhoto(e.currentTarget)}
            sx={{
              all: 'unset', cursor: 'pointer', width: 84, height: 84, borderRadius: 'var(--r-ctl)', border: '1px dashed var(--border-strong)', display: 'grid', placeItems: 'center', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 12, '&:hover, &:focus-visible': { color: 'var(--text-strong)', borderColor: 'var(--text-muted)' }
            }}
          >
            <Box>
              <AddIcon sx={{ display: 'block', mx: 'auto' }} />
              Add a photo
            </Box>
          </Box>
        </Box>
        <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 0.5 }}>Sharp, well-lit photos of real people at your projects make the strongest posters. Only use photos you have permission to share.</Typography>
      </Box>

      {/* Shape */}
      <Box>
        <Label>Shape</Label>
        <ToggleButtonGroup size="small" exclusive value={format} onChange={(_, v) => v && setFormat(v)} aria-label="Shape" sx={{ flexWrap: 'wrap' }}>
          {POSTER_FORMATS.map((f) => (
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

      {/* Campaign logos */}
      {campaignLogos.length > 0 && (
        <Box>
          <Label hint="placed beside your main logo, never in place of it">Campaign logos</Label>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {campaignLogos.map((l) => (
              <LogoChip key={l.id} name={l.name} src={l.variants[0]?.url} on={chosenCampaign.includes(l.id)} onClick={() => setCampaign(toggle(chosenCampaign, l.id))} />
            ))}
          </Box>
        </Box>
      )}

      {/* Partners */}
      <Box>
        <Label
          hint="sized so each one looks equally important"
          right={
            <Box component={RouterLink} to={paths.settings('brand')} sx={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
              {kit?.partners.length ? 'Manage partners' : 'Add partners'}
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
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>None saved yet. Add partner logos once in the brand kit and pick them here for any poster.</Typography>
        )}
      </Box>

      {/* Go */}
      {running && job ? (
        <Box role="status" aria-live="polite">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <CircularProgress size={16} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>{STAGE_TEXT[job.stage] || 'Working'}…</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', ml: 'auto' }}>{formatSeconds(seconds)}</Typography>
          </Box>
          <LinearProgress variant="determinate" value={Math.max(4, Math.round(job.progress * 100))} />
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)', mt: 0.75 }}>Usually 1–3 minutes. You can keep working or close the post; you’ll get a message when the options are ready.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<PosterIcon />} disabled={outOfDesigns || !kit && !kitError} onClick={go}>
            {(task?.aiDrafts || []).some((d) => d.kind === 'design') ? 'Design new options' : 'Design 4 options'}
          </Button>
          <Typography sx={{ fontSize: 12.5, color: outOfDesigns ? 'var(--danger-text)' : 'var(--text-muted)' }}>
            {outOfDesigns
              ? `You’ve used this month’s posters. More on ${new Date(usage!.resetsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.`
              : left !== null
                ? `Uses 1 poster · ${left} left this month. Edits to a poster are free.`
                : 'Takes 1–3 minutes. Edits to a poster are free.'}
          </Typography>
        </Box>
      )}
      {job?.status === 'failed' && !running && <Notice>{job.error || 'The last poster couldn’t be made.'} Nothing was used from your allowance.</Notice>}
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
