import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { Box, Button, IconButton, Popover, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import PostCard, { type PlannerPost } from '../posts/PostCard';
import { addDays, dayKey, formatDay, keyToDate, todayKey } from '../../lib/dates';
import { campaignColor } from '../../lib/colors';

/**
 * The Planner's views. Month: a grid of days with small post cards. Week: a column per day with
 * bigger cards. List: every post grouped by day or campaign. Days accept dropped cards
 * (to move a post) and have a "+" to add one there.
 */

export const DRAG_TYPE = 'application/x-blueprint-post';

export interface ViewProps {
  posts: PlannerPost[];
  anchor: string;
  onOpen: (id: string) => void;
  onMove: (id: string, day: string | null) => void;
  onAdd: (day: string) => void;
}

/** Monday on or before the day. */
export function weekStart(key: string): string {
  const d = keyToDate(key);
  const wd = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(key, -wd);
}

export function monthGridStart(key: string): string {
  return weekStart(`${key.slice(0, 7)}-01`);
}

export function postsByDay(posts: PlannerPost[]): Map<string, PlannerPost[]> {
  const map = new Map<string, PlannerPost[]>();
  for (const p of posts) {
    const k = dayKey(p.taskDate);
    if (!k) continue;
    map.set(k, [...(map.get(k) || []), p]);
  }
  // Within a day: by time when scheduled, then by title.
  for (const [k, list] of map) {
    map.set(
      k,
      list.sort((a, b) => {
        const ta = a.publishing?.nextAt ? +new Date(a.publishing.nextAt) : Infinity;
        const tb = b.publishing?.nextAt ? +new Date(b.publishing.nextAt) : Infinity;
        return ta - tb || a.name.localeCompare(b.name);
      })
    );
  }
  return map;
}

/** A day (or the tray) that accepts dropped cards. */
export function useDropTarget(onDropPost: (id: string, from: string | null) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    bind: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        try {
          const { id, from } = JSON.parse(raw);
          if (typeof id === 'string') onDropPost(id, dayKey(from));
        } catch {
          /* not ours */
        }
      }
    }
  };
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => keyToDate(addDays('2024-01-01', i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }));

function DayCell({
  day,
  posts,
  inMonth,
  onOpen,
  onMove,
  onAdd,
  max
}: {
  day: string;
  posts: PlannerPost[];
  inMonth: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, day: string | null) => void;
  onAdd: (day: string) => void;
  max: number;
}) {
  const today = day === todayKey();
  const drop = useDropTarget((id, from) => from !== day && onMove(id, day));
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const shown = posts.slice(0, max);
  const hidden = posts.length - shown.length;
  const date = keyToDate(day);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  return (
    <Box
      {...drop.bind}
      aria-label={`${formatDay(day)}${posts.length ? `, ${posts.length} post${posts.length === 1 ? '' : 's'}` : ''}`}
      sx={{
        minWidth: 0, minHeight: 116, p: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5, position: 'relative',
        borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        bgcolor: drop.over ? 'var(--bg-hover)' : weekend ? 'var(--bg-subtle)' : 'transparent',
        outline: drop.over ? '2px dashed var(--border-strong)' : 'none', outlineOffset: -3,
        '&:hover .bp-add': { opacity: 1 }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 22 }}>
        <Box
          component="span"
          sx={{
            fontSize: 12, fontWeight: today ? 800 : 600, minWidth: 22, height: 22, px: '5px', borderRadius: 'var(--r-full)', display: 'inline-grid', placeItems: 'center',
            color: today ? 'var(--primary-fg)' : inMonth ? 'var(--text-strong)' : 'var(--text-faint)', bgcolor: today ? 'var(--primary-bg)' : 'transparent'
          }}
        >
          {date.getUTCDate() === 1 ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : date.getUTCDate()}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={`Add a post on ${formatDay(day)}`}>
          <IconButton className="bp-add" size="small" aria-label={`Add a post on ${formatDay(day)}`} onClick={() => onAdd(day)} sx={{ opacity: { xs: 1, md: 0 }, p: '2px', transition: 'opacity var(--t-fast)', '&:focus-visible': { opacity: 1 } }}>
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
      {shown.map((p) => (
        <PostCard key={p._id} post={p} onOpen={onOpen} variant="compact" />
      ))}
      {hidden > 0 && (
        <Button size="small" onClick={(e) => setMoreAnchor(e.currentTarget)} sx={{ justifyContent: 'flex-start', fontSize: 12, py: 0, minHeight: 0, color: 'var(--text-muted)' }}>
          {hidden} more
        </Button>
      )}
      <Popover open={Boolean(moreAnchor)} anchorEl={moreAnchor} onClose={() => setMoreAnchor(null)} PaperProps={{ sx: { p: 1, width: 280, bgcolor: 'var(--bg-float)', backgroundImage: 'none' } }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1, color: 'var(--text-strong)' }}>{formatDay(day)}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {posts.map((p) => (
            <PostCard
              key={p._id}
              post={p}
              variant="compact"
              onOpen={(id) => {
                setMoreAnchor(null);
                onOpen(id);
              }}
            />
          ))}
        </Box>
      </Popover>
    </Box>
  );
}

export function MonthView({ posts, anchor, onOpen, onMove, onAdd }: ViewProps) {
  const phone = !useMediaQuery('(min-width: 48em)');
  const start = monthGridStart(anchor);
  const month = anchor.slice(0, 7);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(start, i)), [start]);
  // Drop the last row when it's entirely next month.
  const visible = days.slice(35).every((d) => d.slice(0, 7) !== month) ? days.slice(0, 35) : days;
  const byDay = useMemo(() => postsByDay(posts), [posts]);
  const [picked, setPicked] = useState<string | null>(null);

  if (phone) {
    // Phones: a small month with dots; tap a day to see its posts below.
    const day = picked || (anchor.slice(0, 7) === todayKey().slice(0, 7) ? todayKey() : `${month}-01`);
    const list = byDay.get(day) || [];
    return (
      <Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', mb: 0.5 }}>
          {WEEKDAYS.map((w) => (
            <Typography key={w} sx={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
              {w}
            </Typography>
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
          {visible.map((d) => {
            const n = byDay.get(d)?.length || 0;
            const selected = d === day;
            return (
              <Box
                key={d}
                component="button"
                type="button"
                onClick={() => setPicked(d)}
                aria-pressed={selected}
                aria-label={`${formatDay(d)}${n ? `, ${n} posts` : ''}`}
                sx={{
                  all: 'unset', cursor: 'pointer', textAlign: 'center', py: 0.75, borderRadius: 'var(--r-ctl)',
                  bgcolor: selected ? 'var(--primary-bg)' : 'transparent', color: selected ? 'var(--primary-fg)' : d.slice(0, 7) === month ? 'var(--text-strong)' : 'var(--text-faint)',
                  fontWeight: d === todayKey() ? 800 : 500, fontSize: 14
                }}
              >
                {keyToDate(d).getUTCDate()}
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: '2px', height: 6, mt: '2px' }}>
                  {(byDay.get(d) || []).slice(0, 3).map((p) => (
                    <Box key={p._id} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: campaignColor((p.campaignId as any)?._id) }} />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>{formatDay(day, { relative: true })}</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => onAdd(day)}>
              Add post
            </Button>
          </Box>
          {list.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {list.map((p) => (
                <PostCard key={p._id} post={p} onOpen={onOpen} variant="row" draggable={false} />
              ))}
            </Box>
          ) : (
            <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing planned this day.</Typography>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--border)', bgcolor: 'var(--bg-subtle)' }}>
        {WEEKDAYS.map((w) => (
          <Typography key={w} sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', px: 1, py: 0.75 }}>
            {w}
          </Typography>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', '& > :nth-of-type(7n)': { borderRight: 0 } }}>
        {visible.map((d) => (
          <DayCell key={d} day={d} posts={byDay.get(d) || []} inMonth={d.slice(0, 7) === month} onOpen={onOpen} onMove={onMove} onAdd={onAdd} max={3} />
        ))}
      </Box>
    </Box>
  );
}

function WeekColumn({ day, posts, onOpen, onMove, onAdd }: { day: string; posts: PlannerPost[]; onOpen: (id: string) => void; onMove: (id: string, day: string | null) => void; onAdd: (day: string) => void }) {
  const today = day === todayKey();
  const drop = useDropTarget((id, from) => from !== day && onMove(id, day));
  const date = keyToDate(day);
  return (
    <Box
      {...drop.bind}
      sx={{
        minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75, p: 0.75, minHeight: 420, borderRadius: 'var(--r-card)',
        border: '1px solid', borderColor: today ? 'var(--text-muted)' : 'var(--border)',
        bgcolor: drop.over ? 'var(--bg-hover)' : 'transparent', outline: drop.over ? '2px dashed var(--border-strong)' : 'none', outlineOffset: -3
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, px: 0.25 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</Typography>
        <Typography sx={{ fontSize: 18, fontWeight: today ? 800 : 600, color: 'var(--text-strong)' }}>{date.getUTCDate()}</Typography>
        {today && <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Today</Typography>}
      </Box>
      {posts.map((p) => (
        <PostCard key={p._id} post={p} onOpen={onOpen} variant="tall" />
      ))}
      <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={() => onAdd(day)} sx={{ mt: 'auto', color: 'var(--text-muted)', justifyContent: 'flex-start' }}>
        Add
      </Button>
    </Box>
  );
}

export function WeekView({ posts, anchor, onOpen, onMove, onAdd }: ViewProps) {
  const start = weekStart(anchor);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const byDay = useMemo(() => postsByDay(posts), [posts]);
  return (
    <Box sx={{ overflowX: 'auto', pb: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(150px, 1fr))', gap: 1, minWidth: 7 * 150 + 6 * 8 }}>
        {days.map((d) => (
          <WeekColumn key={d} day={d} posts={byDay.get(d) || []} onOpen={onOpen} onMove={onMove} onAdd={onAdd} />
        ))}
      </Box>
    </Box>
  );
}

function Group({ title, color, count, children }: { title: ReactNode; color?: string; count: number; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, position: 'sticky', top: 0, bgcolor: 'var(--bg-panel)', py: 0.5, zIndex: 1 }}>
        {color && <Box component="span" aria-hidden sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: color }} />}
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>{count}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>{children}</Box>
    </Box>
  );
}

export type ListGroup = 'day' | 'campaign';

export function ListView({ posts, onOpen, group }: { posts: PlannerPost[]; onOpen: (id: string) => void; group: ListGroup }) {
  const sorted = useMemo(
    () =>
      [...posts].sort((a, b) => {
        const da = a.taskDate ? +new Date(a.taskDate) : Infinity;
        const db = b.taskDate ? +new Date(b.taskDate) : Infinity;
        return da - db || a.name.localeCompare(b.name);
      }),
    [posts]
  );

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; color?: string; posts: PlannerPost[]; order: number }>();
    for (const p of sorted) {
      let key: string;
      let title: string;
      let color: string | undefined;
      let order: number;
      const c = p.campaignId && typeof p.campaignId === 'object' ? p.campaignId : null;
      if (group === 'campaign') {
        key = c?._id || 'none';
        title = c?.name || 'No campaign';
        color = c ? campaignColor(c._id) : undefined;
        // Posts without a campaign come last.
        order = c ? 0 : 1;
      } else {
        const k = dayKey(p.taskDate);
        key = k || 'none';
        title = k ? formatDay(p.taskDate, { relative: true }) : 'No day yet';
        order = k ? +keyToDate(k) : Infinity;
      }
      const g = map.get(key) || { key, title, color, posts: [], order };
      g.posts.push(p);
      map.set(key, g);
    }
    const list = [...map.values()];
    return group === 'day' ? list.sort((a, b) => a.order - b.order) : list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }, [sorted, group]);

  // By day, the list starts at today; earlier days stay folded until asked for.
  const [showEarlier, setShowEarlier] = useState(false);
  const today = +keyToDate(todayKey());
  const earlier = group === 'day' ? groups.filter((g) => g.order < today) : [];
  const shown = group === 'day' && !showEarlier ? groups.filter((g) => !(g.order < today)) : groups;
  const earlierCount = earlier.reduce((n, g) => n + g.posts.length, 0);

  return (
    <Box>
      {earlierCount > 0 && (
        <Button size="small" onClick={() => setShowEarlier((v) => !v)} sx={{ mb: 1 }}>
          {showEarlier ? 'Hide earlier posts' : `Show ${earlierCount} earlier post${earlierCount === 1 ? '' : 's'}`}
        </Button>
      )}
      {group === 'day' && !showEarlier && shown.length === 0 && (
        <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', py: 2 }}>Nothing planned from today on.</Typography>
      )}
      {shown.map((g) => (
        <Group key={g.key} title={g.title} color={g.color} count={g.posts.length}>
          {g.posts.map((p) => (
            <PostCard key={p._id} post={p} onOpen={onOpen} variant="row" showDate={group !== 'day'} draggable={false} />
          ))}
        </Group>
      ))}
    </Box>
  );
}
