import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Box, Fade, Paper, Popper, Typography } from '@mui/material';
import { ImageOutlined as NoImageIcon } from '@mui/icons-material';
import { campaignColor } from '../../lib/colors';
import { formatDateTime, formatDay, formatTime } from '../../lib/dates';
import { isPublishingStatus, postStatusMeta, toPostStatus } from '../../lib/status';
import { PostStatusChip, StatusDot } from '../ui/StatusChip';
import { PLATFORM_COLORS, PLATFORM_LABELS, type PlatformId } from '../../services/publishing';

/**
 * A post as a card (calendar, lists, Today): poster thumbnail, title, time and platforms, status
 * dot, and the campaign's colour down the side. Hovering shows a preview (no click needed);
 * clicking opens the post. Cards of posts that aren't scheduled yet can be dragged to another day.
 */

export interface PlannerPost {
  _id: string;
  name: string;
  description?: string;
  content?: string;
  status: string;
  taskDate?: string | null;
  designedImage?: string;
  pendingGeneratedImage?: string;
  projectId?: { _id: string; name: string } | string;
  campaignId?: { _id: string; name: string } | string;
  publishing?: { platforms: PlatformId[]; nextAt: string | null; publishedAt: string | null; failed: boolean } | null;
}

const SHORT: Record<string, string> = { instagram: 'IG', facebook: 'FB', linkedin: 'in', x: 'X', tiktok: 'TT', youtube: 'YT' };

export function PlatformBadges({ platforms, size = 16 }: { platforms?: PlatformId[]; size?: number }) {
  if (!platforms?.length) return null;
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: '3px', flexShrink: 0 }} aria-label={platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ')}>
      {platforms.map((p) => (
        <Box
          key={p}
          component="span"
          title={PLATFORM_LABELS[p] || p}
          sx={{
            width: size, height: size, borderRadius: '4px', display: 'inline-grid', placeItems: 'center',
            fontSize: size * 0.56, fontWeight: 800, lineHeight: 1, color: '#fff', bgcolor: PLATFORM_COLORS[p] || '#495057'
          }}
        >
          {SHORT[p] || p.slice(0, 2)}
        </Box>
      ))}
    </Box>
  );
}

/** Whether a card can be dragged to another day (posts waiting in Publishing move there). */
export const canMovePost = (post: PlannerPost) => !isPublishingStatus(post.status) && toPostStatus(post.status) !== 'Published';

const ref = (v: PlannerPost['campaignId']) => (v && typeof v === 'object' ? v : null);

function Thumb({ src, size }: { src?: string; size: number | string }) {
  const [broken, setBroken] = useState(false);
  return (
    <Box sx={{ width: size, height: typeof size === 'number' ? size : undefined, aspectRatio: '1 / 1', flexShrink: 0, borderRadius: '5px', overflow: 'hidden', bgcolor: 'var(--bg-subtle)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)' }}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <NoImageIcon sx={{ fontSize: 14 }} />}
    </Box>
  );
}

/** The preview that appears on hover. */
export function PostHoverPreview({ post }: { post: PlannerPost }) {
  const campaign = ref(post.campaignId);
  const theme = ref(post.projectId);
  const meta = postStatusMeta(post.status);
  const when = post.publishing?.nextAt ? formatDateTime(post.publishing.nextAt) : post.taskDate ? formatDay(post.taskDate) : 'No day yet';
  return (
    <Box sx={{ width: 300 }}>
      {post.designedImage ? (
        <Box component="img" src={post.designedImage} alt="" sx={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }} />
      ) : (
        <Box sx={{ aspectRatio: '2 / 1', bgcolor: 'var(--bg-subtle)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 13 }}>No image yet</Box>
      )}
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{post.name}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <PostStatusChip status={post.status} size="xs" />
          <Typography sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{when}</Typography>
          <PlatformBadges platforms={post.publishing?.platforms} />
        </Box>
        {post.content ? (
          <Typography sx={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {post.content}
          </Typography>
        ) : (
          <Typography sx={{ fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic' }}>No caption yet</Typography>
        )}
        {(campaign || theme) && (
          <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box component="span" sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: campaignColor(campaign?._id), flexShrink: 0 }} />
            {[campaign?.name, theme?.name].filter(Boolean).join(' › ')}
          </Typography>
        )}
        {post.pendingGeneratedImage && <Typography sx={{ fontSize: 12, color: 'var(--st-scheduled-fg)' }}>A new AI image is waiting</Typography>}
        {meta.label === 'Needs attention' && <Typography sx={{ fontSize: 12, color: 'var(--danger-text)' }}>Open it to see what needs fixing</Typography>}
      </Box>
    </Box>
  );
}

/** Shows the hover preview after a short pause, only for mouse users. */
function useHoverPreview(disabled?: boolean) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<number | undefined>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    anchor,
    bind: disabled
      ? {}
      : {
          onPointerEnter: (e: PointerEvent<HTMLElement>) => {
            if (e.pointerType !== 'mouse') return;
            const el = e.currentTarget;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setAnchor(el), 450);
          },
          onPointerLeave: () => {
            window.clearTimeout(timer.current);
            setAnchor(null);
          },
          onDragStart: () => {
            window.clearTimeout(timer.current);
            setAnchor(null);
          }
        }
  };
}

export default function PostCard({
  post,
  onOpen,
  variant = 'compact',
  showDate,
  draggable = true
}: {
  post: PlannerPost;
  onOpen: (id: string) => void;
  /** compact: month cells and trays. tall: week columns. row: lists. */
  variant?: 'compact' | 'tall' | 'row';
  showDate?: boolean;
  draggable?: boolean;
}) {
  const campaign = ref(post.campaignId);
  const theme = ref(post.projectId);
  const color = campaignColor(campaign?._id);
  const time = post.publishing?.nextAt ? formatTime(post.publishing.nextAt) : null;
  const movable = draggable && canMovePost(post);
  const hover = useHoverPreview();

  const onDragStart = (e: DragEvent<HTMLElement>) => {
    if (!movable) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/x-blueprint-post', JSON.stringify({ id: post._id, from: post.taskDate || null }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const common = {
    role: 'button',
    tabIndex: 0,
    draggable: movable,
    onDragStart,
    onClick: () => onOpen(post._id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(post._id);
      }
    },
    'aria-label': `${post.name}, ${postStatusMeta(post.status).label}${post.taskDate ? `, ${formatDay(post.taskDate)}` : ''}`,
    ...hover.bind
  };

  const base = {
    cursor: movable ? 'grab' : 'pointer', borderRadius: 'var(--r-ctl)', bgcolor: 'var(--bg-raised)', border: '1px solid var(--border)',
    borderLeft: `3px solid ${color}`, minWidth: 0, position: 'relative', outline: 'none',
    transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
    '&:hover': { borderColor: 'var(--border-strong)', borderLeftColor: color, boxShadow: 'var(--shadow-pop)' },
    '&:focus-visible': { outline: '2px solid var(--text-muted)', outlineOffset: 1 },
    '&:active': { cursor: movable ? 'grabbing' : 'pointer' }
  } as const;

  let body;
  if (variant === 'tall') {
    body = (
      <Box {...common} sx={{ ...base, overflow: 'hidden' }}>
        {post.designedImage ? (
          <Box component="img" src={post.designedImage} alt="" loading="lazy" draggable={false} sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
        ) : (
          <Box sx={{ aspectRatio: '4 / 3', bgcolor: 'var(--bg-subtle)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)' }}>
            <NoImageIcon sx={{ fontSize: 20 }} />
          </Box>
        )}
        <Box sx={{ p: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
            {post.name}
          </Typography>
          {post.content && (
            <Typography sx={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
              {post.content}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <StatusDot status={post.status} />
            {time && <Typography sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{time}</Typography>}
            <Box sx={{ flex: 1 }} />
            <PlatformBadges platforms={post.publishing?.platforms} size={14} />
          </Box>
        </Box>
      </Box>
    );
  } else if (variant === 'row') {
    body = (
      <Box {...common} sx={{ ...base, display: 'flex', alignItems: 'center', gap: 1.25, p: 1 }}>
        <Thumb src={post.designedImage} size={44} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{post.name}</Typography>
          <Typography noWrap sx={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {[showDate ? (post.taskDate ? formatDay(post.taskDate, { relative: true }) : 'No day yet') : null, time, campaign?.name, theme?.name].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <PlatformBadges platforms={post.publishing?.platforms} />
        <PostStatusChip status={post.status} size="xs" />
      </Box>
    );
  } else {
    body = (
      <Box {...common} sx={{ ...base, display: 'flex', alignItems: 'center', gap: 0.75, p: '4px 6px' }}>
        <Thumb src={post.designedImage} size={26} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.25 }}>{post.name}</Typography>
          {(time || post.publishing?.platforms?.length) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: '1px' }}>
              {time && <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.2 }}>{time}</Typography>}
              <PlatformBadges platforms={post.publishing?.platforms} size={12} />
            </Box>
          )}
        </Box>
        <StatusDot status={post.status} />
      </Box>
    );
  }

  return (
    <>
      {body}
      <Popper open={Boolean(hover.anchor)} anchorEl={hover.anchor} placement="right-start" transition sx={{ zIndex: 1200, pointerEvents: 'none' }} modifiers={[{ name: 'offset', options: { offset: [0, 8] } }, { name: 'flip', enabled: true }, { name: 'preventOverflow', options: { padding: 8 } }]}>
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={120}>
            <Paper elevation={0} sx={{ overflow: 'hidden', borderRadius: 'var(--r-panel)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-pop)', bgcolor: 'var(--bg-float)', backgroundImage: 'none' }}>
              <PostHoverPreview post={post} />
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  );
}
