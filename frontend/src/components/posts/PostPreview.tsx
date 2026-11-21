import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import { Box, Button, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import {
  FavoriteBorder as LikeIcon,
  ChatBubbleOutline as CommentIcon,
  SendOutlined as ShareIcon,
  BookmarkBorder as SaveIcon,
  MoreHoriz as MoreIcon,
  Repeat as RepostIcon,
  ThumbUpOutlined as ThumbIcon,
  BarChart as ViewsIcon,
  MusicNote as MusicIcon,
  ImageOutlined as NoImageIcon
} from '@mui/icons-material';

/**
 * How the post will look on each platform, with the caption editable right inside the mock-up.
 *
 * While editing, the text behind the caret shows what readers see before "more" (the rest is
 * shaded), hashtags/@mentions in the platform's colour, and anything past the platform's limit
 * in red. "As people see it" shows the folded caption exactly as a feed would.
 */

export type PreviewPlatform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'tiktok';

interface PlatformSpec {
  label: string;
  /** Hard limit (characters). Same numbers as Publishing (backend/src/publishing/rules.ts). */
  max: number;
  /** About how many characters show before the "more" link. */
  fold: number | null;
  foldLabel: string;
  foldNote: string;
  maxHashtags?: number;
  link: string;
}

export const PREVIEW_PLATFORMS: Record<PreviewPlatform, PlatformSpec> = {
  instagram: { label: 'Instagram', max: 2200, fold: 125, foldLabel: 'more', foldNote: 'About 125 characters show before “more”.', maxHashtags: 30, link: '#00376b' },
  facebook: { label: 'Facebook', max: 63206, fold: 480, foldLabel: 'See more', foldNote: 'About 480 characters show before “See more” (fewer on phones).', link: '#385898' },
  linkedin: { label: 'LinkedIn', max: 3000, fold: 210, foldLabel: '…see more', foldNote: 'About 210 characters show before “see more”.', link: '#0a66c2' },
  x: { label: 'X', max: 280, fold: null, foldLabel: '', foldNote: 'Links count as 23 characters, emoji as 2.', link: '#1d9bf0' },
  tiktok: { label: 'TikTok', max: 2200, fold: 100, foldLabel: 'more', foldNote: 'About 100 characters show before “more”.', link: '#fe2c55' }
};

export const PREVIEW_ORDER: PreviewPlatform[] = ['instagram', 'facebook', 'linkedin', 'x', 'tiktok'];

const URL_RE = /https?:\/\/[^\s]+/g;

/** Characters as the platform counts them (X: links = 23, characters outside the basic plane = 2). */
export function platformLength(text: string, platform: PreviewPlatform): number {
  if (platform !== 'x') return [...text].length;
  let n = 0;
  const withoutLinks = text.replace(URL_RE, () => {
    n += 23;
    return '';
  });
  for (const ch of withoutLinks) n += (ch.codePointAt(0) || 0) > 0xffff ? 2 : 1;
  return n;
}

export function hashtagCount(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
}

/** Code-point index where the visible part ends (the fold), or null. */
function foldIndex(text: string, spec: PlatformSpec): number | null {
  if (!spec.fold) return null;
  const chars = [...text];
  if (chars.length <= spec.fold) return null;
  return chars.slice(0, spec.fold).join('').length;
}

/** Splits text into styled pieces: hashtags/mentions/links, folded part, over-limit part. */
function Highlighted({ text, platform, spec }: { text: string; platform: PreviewPlatform; spec: PlatformSpec }) {
  const fold = foldIndex(text, spec);
  // Index (in UTF-16 units) after which the text is over the limit.
  let limitAt: number | null = null;
  if (platformLength(text, platform) > spec.max) {
    if (platform === 'x') {
      let n = 0;
      let i = 0;
      for (const ch of text) {
        n += (ch.codePointAt(0) || 0) > 0xffff ? 2 : 1;
        if (n > spec.max) {
          limitAt = i;
          break;
        }
        i += ch.length;
      }
    } else {
      limitAt = [...text].slice(0, spec.max).join('').length;
    }
  }
  const tokenRe = /(#[\p{L}\p{N}_]+|@[\p{L}\p{N}_.]+|https?:\/\/[^\s]+)/gu;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const pushPlain = (from: number, to: number) => {
    // Split plain runs at the fold / limit so each part gets its own style.
    const cuts = [from, ...[fold, limitAt].filter((c): c is number => c !== null && c > from && c < to), to].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      if (b <= a) continue;
      out.push(<span key={key++} style={styleFor(a)}>{text.slice(a, b)}</span>);
    }
  };
  const styleFor = (at: number): CSSProperties => {
    if (limitAt !== null && at >= limitAt) return { background: 'rgba(250, 82, 82, .28)', borderRadius: 2 };
    if (fold !== null && at >= fold) return { background: 'rgba(134, 142, 150, .18)' };
    return {};
  };
  for (const m of text.matchAll(tokenRe)) {
    const at = m.index ?? 0;
    if (at > last) pushPlain(last, at);
    out.push(
      <span key={key++} style={{ ...styleFor(at), color: spec.link }}>
        {m[0]}
      </span>
    );
    last = at + m[0].length;
  }
  if (last < text.length) pushPlain(last, text.length);
  return <>{out}</>;
}

/** A caption you can type into, with highlights drawn behind the transparent text. */
function InlineCaption({ value, onChange, platform }: { value: string; onChange: (v: string) => void; platform: PreviewPlatform }) {
  const spec = PREVIEW_PLATFORMS[platform];
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
  }, [value, platform]);
  // The textarea and the highlight layer must lay text out identically.
  const shared = {
    m: 0, p: '6px 8px', border: 0, fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', letterSpacing: 'inherit',
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', boxSizing: 'border-box', width: '100%'
  } as const;
  return (
    <Box sx={{ position: 'relative', borderRadius: '6px', outline: '1px dashed rgba(0,0,0,.2)', '&:focus-within': { outline: '2px solid #4c6ef5' } }}>
      {/* Draws the visible text (with highlights); the textarea on top only shows the caret and selection. */}
      <Box aria-hidden sx={{ ...shared, position: 'absolute', inset: 0, color: '#111', pointerEvents: 'none', overflow: 'hidden' }}>
        <Highlighted text={value} platform={platform} spec={spec} />
        {'\n'}
      </Box>
      <Box
        component="textarea"
        ref={ref}
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        placeholder="Write the caption…"
        aria-label={`Caption as it appears on ${spec.label}`}
        spellCheck
        sx={{
          ...shared, display: 'block', position: 'relative', resize: 'none', overflow: 'hidden', background: 'transparent',
          color: 'transparent', caretColor: '#111', outline: 'none', '&::placeholder': { color: '#8e8e8e' },
          // The selection is tinted; the text itself stays drawn by the layer behind (no double text).
          '&::selection': { color: 'transparent', background: 'rgba(76,110,245,.25)' }
        }}
      />
    </Box>
  );
}

/** The caption as a feed shows it: folded with a "more" link you can open. */
function FoldedCaption({ text, platform, prefix, empty }: { text: string; platform: PreviewPlatform; prefix?: string; empty: string }) {
  const spec = PREVIEW_PLATFORMS[platform];
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [text, platform]);
  if (!text.trim()) return <Typography sx={{ fontSize: 'inherit', color: '#8e8e8e', fontStyle: 'italic' }}>{empty}</Typography>;
  const fold = foldIndex(text, spec);
  const shown = fold !== null && !open ? text.slice(0, fold).replace(/\s+$/, '') : text;
  return (
    <Box sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {prefix && <span style={{ fontWeight: 700 }}>{prefix} </span>}
      <Highlighted text={shown} platform={platform} spec={{ ...spec, fold: null }} />
      {fold !== null && !open && (
        <>
          {spec.foldLabel.startsWith('…') ? '' : '… '}
          <Box component="button" type="button" onClick={() => setOpen(true)} sx={{ all: 'unset', cursor: 'pointer', color: '#8e8e8e', fontWeight: 600 }}>
            {spec.foldLabel}
          </Box>
        </>
      )}
    </Box>
  );
}

function Avatar({ name, logo, size = 32 }: { name: string; logo?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'B';
  return (
    <Box sx={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, bgcolor: '#e9ecef', display: 'grid', placeItems: 'center', fontSize: size * 0.38, fontWeight: 700, color: '#495057' }}>
      {logo && !broken ? <img src={logo} alt="" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </Box>
  );
}

function Picture({ src, ratio = '1 / 1', alt }: { src?: string | null; ratio?: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <Box sx={{ width: '100%', aspectRatio: ratio, bgcolor: '#f1f3f5', display: 'grid', placeItems: 'center', overflow: 'hidden', color: '#adb5bd' }}>
      {src && !broken ? (
        <img src={src} alt={alt} onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <Box sx={{ textAlign: 'center', fontSize: 13 }}>
          <NoImageIcon sx={{ fontSize: 36, display: 'block', mx: 'auto' }} />
          No image yet
        </Box>
      )}
    </Box>
  );
}

const handleFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9_.]+/g, '').slice(0, 30) || 'yourbrand';

export interface PostPreviewProps {
  caption: string;
  /** When given, the caption can be edited inside the preview. */
  onCaptionChange?: (value: string) => void;
  image?: string | null;
  brandName: string;
  brandLogo?: string | null;
  /** "Fri, 20 Nov" or similar. */
  dateLabel?: string;
  platform?: PreviewPlatform;
  onPlatformChange?: (p: PreviewPlatform) => void;
}

export default function PostPreview({
  caption,
  onCaptionChange,
  image,
  brandName,
  brandLogo,
  dateLabel,
  platform: controlled,
  onPlatformChange
}: PostPreviewProps) {
  const [own, setOwn] = useState<PreviewPlatform>('instagram');
  const platform = controlled || own;
  const setPlatform = (p: PreviewPlatform) => (onPlatformChange ? onPlatformChange(p) : setOwn(p));
  const editable = Boolean(onCaptionChange);
  const [mode, setMode] = useState<'edit' | 'view'>(editable ? 'edit' : 'view');
  const editing = editable && mode === 'edit';
  const spec = PREVIEW_PLATFORMS[platform];
  const name = brandName || 'Your brand';
  const handle = handleFrom(name);
  const length = platformLength(caption, platform);
  const over = length > spec.max;
  const tags = hashtagCount(caption);
  const tooManyTags = spec.maxHashtags !== undefined && tags > spec.maxHashtags;

  const captionNode = (prefix?: string) =>
    editing ? (
      <>
        {prefix && <Typography sx={{ fontWeight: 700, fontSize: 'inherit', mb: 0.25 }}>{prefix}</Typography>}
        <InlineCaption value={caption} onChange={onCaptionChange!} platform={platform} />
      </>
    ) : (
      <FoldedCaption text={caption} platform={platform} prefix={prefix} empty="No caption yet." />
    );

  const card = (children: ReactNode, maxWidth = 470) => (
    <Box sx={{ maxWidth, mx: 'auto', bgcolor: '#fff', color: '#111', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e9ecef', fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.45 }}>
      {children}
    </Box>
  );

  let mock: ReactNode;
  if (platform === 'instagram') {
    mock = card(
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25 }}>
          <Avatar name={name} logo={brandLogo} />
          <Typography sx={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{handle}</Typography>
          <MoreIcon fontSize="small" />
        </Box>
        <Picture src={image} alt={name} />
        <Box sx={{ display: 'flex', gap: 1.5, p: 1.25, pb: 0.5 }}>
          <LikeIcon /> <CommentIcon /> <ShareIcon />
          <Box sx={{ flex: 1 }} />
          <SaveIcon />
        </Box>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          {captionNode(handle)}
          {dateLabel && <Typography sx={{ fontSize: 11, color: '#8e8e8e', mt: 0.75, textTransform: 'uppercase' }}>{dateLabel}</Typography>}
        </Box>
      </>
    );
  } else if (platform === 'facebook') {
    mock = card(
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5 }}>
          <Avatar name={name} logo={brandLogo} size={40} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{name}</Typography>
            <Typography sx={{ fontSize: 12, color: '#65676b' }}>{dateLabel || 'Just now'} · Public</Typography>
          </Box>
          <MoreIcon fontSize="small" />
        </Box>
        <Box sx={{ px: 1.5, pb: 1.25 }}>{captionNode()}</Box>
        <Picture src={image} alt={name} ratio="1.91 / 1" />
        <Box sx={{ display: 'flex', justifyContent: 'space-around', py: 1, borderTop: '1px solid #e4e6eb', color: '#65676b', fontSize: 14, fontWeight: 600 }}>
          <span>👍 Like</span>
          <span>💬 Comment</span>
          <span>↗ Share</span>
        </Box>
      </>
    );
  } else if (platform === 'linkedin') {
    mock = card(
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5 }}>
          <Avatar name={name} logo={brandLogo} size={44} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{name}</Typography>
            <Typography sx={{ fontSize: 12, color: '#666' }}>{dateLabel || 'Now'} · 🌐</Typography>
          </Box>
          <MoreIcon fontSize="small" />
        </Box>
        <Box sx={{ px: 1.5, pb: 1.25 }}>{captionNode()}</Box>
        <Picture src={image} alt={name} ratio="1.91 / 1" />
        <Box sx={{ display: 'flex', justifyContent: 'space-around', py: 1, borderTop: '1px solid #e0e0e0', color: '#666', fontSize: 13, fontWeight: 600 }}>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}><ThumbIcon sx={{ fontSize: 18 }} /> Like</Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}><CommentIcon sx={{ fontSize: 18 }} /> Comment</Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}><RepostIcon sx={{ fontSize: 18 }} /> Repost</Box>
        </Box>
      </>
    );
  } else if (platform === 'x') {
    mock = card(
      <Box sx={{ display: 'flex', gap: 1.25, p: 1.5 }}>
        <Avatar name={name} logo={brandLogo} size={40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline', flexWrap: 'wrap', mb: 0.25 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{name}</Typography>
            <Typography sx={{ fontSize: 14, color: '#536471' }}>@{handle} · {dateLabel || 'now'}</Typography>
          </Box>
          {captionNode()}
          {image && (
            <Box sx={{ mt: 1, borderRadius: '14px', overflow: 'hidden', border: '1px solid #cfd9de' }}>
              <Picture src={image} alt={name} ratio="16 / 9" />
            </Box>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', color: '#536471', mt: 1, maxWidth: 380 }}>
            <CommentIcon sx={{ fontSize: 18 }} /> <RepostIcon sx={{ fontSize: 18 }} /> <LikeIcon sx={{ fontSize: 18 }} /> <ViewsIcon sx={{ fontSize: 18 }} />
          </Box>
        </Box>
      </Box>
    );
  } else {
    mock = (
      <Box sx={{ maxWidth: 300, mx: 'auto', aspectRatio: '9 / 16', borderRadius: '14px', overflow: 'hidden', position: 'relative', bgcolor: '#000', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.4 }}>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', '& img': { objectFit: 'cover' } }}>
          <Picture src={image} alt={name} ratio="9 / 16" />
        </Box>
        <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, p: 1.25, pt: 4, background: 'linear-gradient(transparent, rgba(0,0,0,.75))' }}>
          <Typography sx={{ fontWeight: 700, fontSize: 14, mb: 0.5 }}>@{handle}</Typography>
          <Box sx={{ bgcolor: editing ? 'rgba(255,255,255,.92)' : 'transparent', borderRadius: '6px', color: editing ? '#111' : '#fff' }}>{captionNode()}</Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', fontSize: 12, mt: 0.75, opacity: 0.9 }}>
            <MusicIcon sx={{ fontSize: 14 }} /> Original sound · {name}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={platform}
          onChange={(_, v) => v && setPlatform(v)}
          aria-label="Platform"
          sx={{ flexWrap: 'wrap', '& .MuiToggleButton-root': { textTransform: 'none', px: 1.25, py: 0.25, fontSize: 13 } }}
        >
          {PREVIEW_ORDER.map((p) => (
            <ToggleButton key={p} value={p}>
              {PREVIEW_PLATFORMS[p].label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {editable && (
          <Button size="small" onClick={() => setMode(editing ? 'view' : 'edit')} sx={{ ml: 'auto' }}>
            {editing ? 'As people see it' : 'Edit caption here'}
          </Button>
        )}
      </Box>

      {mock}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1, fontSize: 12.5, color: 'var(--text-muted)', justifyContent: 'center' }}>
        <Tooltip title={spec.foldNote}>
          <span style={{ color: over ? 'var(--danger-text)' : undefined, fontWeight: over ? 700 : undefined }}>
            {length.toLocaleString()} / {spec.max.toLocaleString()} characters{over ? ` — ${(length - spec.max).toLocaleString()} too many for ${spec.label}` : ''}
          </span>
        </Tooltip>
        {spec.fold && length > spec.fold && <span>Shaded text is behind “{spec.foldLabel.replace('…', '')}”</span>}
        {spec.maxHashtags !== undefined && tags > 0 && (
          <span style={{ color: tooManyTags ? 'var(--danger-text)' : undefined }}>
            {tags} / {spec.maxHashtags} hashtags
          </span>
        )}
      </Box>
    </Box>
  );
}
