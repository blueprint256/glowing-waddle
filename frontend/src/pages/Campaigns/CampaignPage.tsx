import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Typography, useMediaQuery } from '@mui/material';
import {
  Add as AddIcon,
  AutoAwesome as AiIcon,
  MoreVert as MoreIcon,
  Edit as EditIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  CalendarMonth as PlannerIcon,
  Layers as ThemeIcon
} from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { MetaChip, StatusDot } from '../../components/ui/StatusChip';
import PostCard, { type PlannerPost } from '../../components/posts/PostCard';
import NewPostDialog from '../../components/posts/NewPostDialog';
import { useOpenPost, usePostEvents } from '../../components/posts/PostPanelHost';
import CampaignDialog, { type CampaignLike } from '../../components/campaigns/CampaignDialog';
import ThemeDialog, { type ThemeLike } from '../../components/campaigns/ThemeDialog';
import PlanWithAIDialog from '../../components/campaigns/PlanWithAIDialog';
import { campaignAPI, projectAPI, taskAPI } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { canUseAI } from '../../types';
import { campaignColor } from '../../lib/colors';
import { POST_STATUSES, campaignStatusMeta, postStatusMeta, themeStatusMeta, toPostStatus } from '../../lib/status';
import { dayKey, formatDayRange } from '../../lib/dates';
import { paths, refId } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * One campaign: what it's about, its themes (the old "projects") and its posts. Choose a theme on
 * the left to see only its posts (?theme=<id>, so links to a theme land here). Plan with AI drafts
 * themes and posts for review.
 */

interface Campaign extends CampaignLike {
  archived?: boolean;
  createdBy?: { _id: string } | string;
}

interface Theme extends ThemeLike {
  campaignId?: unknown;
}

const ALL = 'all';

/** Posts with a day first (earliest first), then the ones without. */
function byDay(a: PlannerPost, b: PlannerPost) {
  const da = dayKey(a.taskDate) || '9999';
  const db = dayKey(b.taskDate) || '9999';
  return da.localeCompare(db) || a.name.localeCompare(b.name);
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuthStore();
  const aiOn = canUseAI(user);
  const wide = useMediaQuery('(min-width: 62em)');
  const openPost = useOpenPost();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [themes, setThemes] = useState<Theme[] | null>(null);
  const [posts, setPosts] = useState<PlannerPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editCampaign, setEditCampaign] = useState(false);
  const [themeDialog, setThemeDialog] = useState<{ theme?: Theme } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [newPost, setNewPost] = useState<{ projectId?: string } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const selected = params.get('theme') || ALL;
  const selectTheme = (themeId: string) => {
    const next = new URLSearchParams(params);
    if (themeId === ALL) next.delete('theme');
    else next.set('theme', themeId);
    setParams(next, { replace: true });
  };

  const loadCampaign = useCallback(async () => {
    try {
      const res = await campaignAPI.getById(id!);
      setCampaign(res.data.campaign);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'This campaign couldn’t be opened.'));
    }
  }, [id]);

  const loadThemes = useCallback(async () => {
    try {
      const res = await projectAPI.getAll({ campaignId: id, limit: 500 });
      setThemes(res.data.projects || []);
    } catch {
      setThemes([]);
    }
  }, [id]);

  const loadPosts = useCallback(async () => {
    try {
      const res = await taskAPI.getAll({ campaignId: id, include: 'publishing', limit: 3000 });
      setPosts(res.data.tasks || []);
    } catch (e) {
      notify(errorMessage(e, 'The posts couldn’t load.'), { tone: 'error' });
      setPosts([]);
    }
  }, [id]);

  const loadAll = useCallback(() => {
    loadCampaign();
    loadThemes();
    loadPosts();
  }, [loadCampaign, loadThemes, loadPosts]);

  useEffect(() => {
    setCampaign(null);
    setThemes(null);
    setPosts(null);
    loadAll();
  }, [loadAll]);

  usePostEvents(() => loadPosts());

  const countByTheme = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posts || []) {
      const t = refId(p.projectId) || '';
      m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }, [posts]);

  const readyByTheme = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posts || []) {
      if (!['Ready', 'Scheduled', 'Published'].includes(toPostStatus(p.status))) continue;
      const t = refId(p.projectId) || '';
      m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }, [posts]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of posts || []) {
      const s = toPostStatus(p.status);
      m[s] = (m[s] || 0) + 1;
    }
    return m;
  }, [posts]);

  const theme = selected === ALL ? null : (themes || []).find((t) => t._id === selected) || null;
  const shown = useMemo(() => (posts || []).filter((p) => selected === ALL || refId(p.projectId) === selected).sort(byDay), [posts, selected]);

  // A ?theme= that doesn't belong here (deleted, or another campaign's) falls back to all posts.
  useEffect(() => {
    if (themes && selected !== ALL && !themes.some((t) => t._id === selected)) selectTheme(ALL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes, selected]);

  if (error) {
    return (
      <Box>
        <PageHeader title="Campaign" crumbs={[{ label: 'Campaigns', to: paths.campaigns() }]} />
        <EmptyState title="This campaign couldn’t be opened" text={error} action={<Button component={RouterLink} to={paths.campaigns()}>Back to Campaigns</Button>} />
      </Box>
    );
  }
  if (!campaign) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
        <CircularProgress size={22} sx={{ color: 'var(--text-muted)' }} />
      </Box>
    );
  }

  const archived = Boolean(campaign.archived);
  const color = campaignColor(campaign._id);
  const totalPosts = (posts || []).length;
  const scheduledCount = (byStatus.Scheduled || 0) + (byStatus['Needs attention'] || 0);
  const hasAbout = Boolean(campaign.description || campaign.coreMessages || campaign.hashtags?.length);

  const archive = async () => {
    setConfirmArchive(false);
    try {
      const res = await campaignAPI.archive(campaign._id);
      notify(res.data.message || 'Campaign archived');
      loadAll();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t archive the campaign.'), { tone: 'error' });
    }
  };

  const restore = async () => {
    try {
      await campaignAPI.unarchive(campaign._id);
      notify('Campaign restored');
      loadAll();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t restore the campaign.'), { tone: 'error' });
    }
  };

  const themeList = (
    <Box component="nav" aria-label="Themes" sx={{ display: 'flex', flexDirection: wide ? 'column' : 'row', gap: 0.5, overflowX: wide ? 'visible' : 'auto', pb: wide ? 0 : 0.5 }}>
      <ThemeItem active={selected === ALL} onClick={() => selectTheme(ALL)} title="All posts" meta={`${totalPosts}`} wide={wide} />
      {(themes || []).map((t) => {
        const n = countByTheme.get(t._id) || 0;
        const ready = readyByTheme.get(t._id) || 0;
        return (
          <ThemeItem
            key={t._id}
            active={selected === t._id}
            onClick={() => selectTheme(t._id)}
            title={t.name}
            meta={`${n}`}
            sub={wide ? formatDayRange(t.startDate, t.dueDate) || undefined : undefined}
            progress={wide && n ? ready / n : undefined}
            wide={wide}
          />
        );
      })}
      {!archived && (
        <Button size="small" startIcon={<AddIcon />} onClick={() => setThemeDialog({})} sx={{ justifyContent: 'flex-start', flexShrink: 0, color: 'var(--text-muted)', mt: wide ? 0.5 : 0 }}>
          New theme
        </Button>
      )}
    </Box>
  );

  return (
    <Box>
      <PageHeader
        crumbs={[{ label: 'Campaigns', to: paths.campaigns() }]}
        title={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Box component="span" sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: color, flexShrink: 0 }} aria-hidden />
            {campaign.name}
          </Box>
        }
        subtitle={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <MetaChip meta={campaignStatusMeta(archived ? 'archived' : campaign.status)} size="xs" />
            <span>{formatDayRange(campaign.startDate, campaign.endDate) || 'No dates yet'}</span>
          </Box>
        }
        actions={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {aiOn && !archived && (
              <Button variant="outlined" startIcon={<AiIcon />} onClick={() => setPlanOpen(true)}>
                Plan with AI
              </Button>
            )}
            {!archived && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewPost({ projectId: theme?._id })}>
                New post
              </Button>
            )}
            <IconButton aria-label="More for this campaign" onClick={(e) => setMenu(e.currentTarget)}>
              <MoreIcon />
            </IconButton>
          </Box>
        }
      />

      {archived && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, mb: 2, borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-subtle)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13.5, flex: 1 }}>This campaign is archived. Its posts are kept but nothing new can be planned until you restore it.</Typography>
          <Button size="small" variant="outlined" onClick={restore}>
            Restore
          </Button>
        </Box>
      )}

      {/* About + how the posts are coming along */}
      <Box sx={{ border: '1px solid var(--border)', borderRadius: 'var(--r-panel)', bgcolor: 'var(--bg-panel)', p: 1.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {totalPosts === 0 ? (
            <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>No posts yet.</Typography>
          ) : (
            POST_STATUSES.filter((s) => byStatus[s]).map((s) => (
              <Chip
                key={s}
                size="small"
                component={RouterLink}
                to={paths.planner({ view: 'list', campaign: campaign._id, status: s })}
                clickable
                icon={<StatusDot status={s} />}
                label={`${byStatus[s]} ${postStatusMeta(s).label}`}
                sx={{ bgcolor: 'var(--bg-subtle)', '& .MuiChip-icon': { ml: 1 } }}
              />
            ))
          )}
          <Box sx={{ flex: 1 }} />
          {hasAbout ? (
            <Button size="small" onClick={() => setAboutOpen((v) => !v)} endIcon={aboutOpen ? <CollapseIcon /> : <ExpandIcon />} aria-expanded={aboutOpen}>
              About this campaign
            </Button>
          ) : (
            !archived && (
              <Button size="small" startIcon={<EditIcon />} onClick={() => setEditCampaign(true)}>
                Add key messages
              </Button>
            )
          )}
        </Box>
        <Collapse in={aboutOpen && hasAbout} unmountOnExit>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, pt: 1.5, mt: 1.5, borderTop: '1px solid var(--border)' }}>
            {campaign.description && <About label="What it’s about">{campaign.description}</About>}
            {campaign.coreMessages && <About label="Key messages">{campaign.coreMessages}</About>}
            {campaign.hashtags && campaign.hashtags.length > 0 && (
              <About label="Hashtags">
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {campaign.hashtags.map((h) => (
                    <Chip key={h} size="small" label={`#${h}`} />
                  ))}
                </Box>
              </About>
            )}
            {!archived && (
              <Button size="small" startIcon={<EditIcon />} onClick={() => setEditCampaign(true)} sx={{ alignSelf: 'flex-start' }}>
                Edit
              </Button>
            )}
          </Box>
        </Collapse>
      </Box>

      {/* Themes and posts */}
      <Box sx={{ display: 'grid', gridTemplateColumns: wide ? '260px minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 2, alignItems: 'start' }}>
        <Box sx={{ position: wide ? 'sticky' : 'static', top: 8 }}>
          {wide && (
            <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-subtle)', mb: 0.75, px: 1 }}>Themes</Typography>
          )}
          {themes === null ? <CircularProgress size={16} sx={{ color: 'var(--text-muted)', m: 1 }} /> : themeList}
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography component="h2" sx={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {theme ? theme.name : 'All posts'}
                {theme && <MetaChip meta={themeStatusMeta(theme.status)} size="xs" />}
              </Typography>
              {theme && (theme.description || theme.startDate || theme.dueDate) && (
                <Typography sx={{ fontSize: 13, color: 'var(--text-muted)' }}>{[formatDayRange(theme.startDate, theme.dueDate), theme.description].filter(Boolean).join(' · ')}</Typography>
              )}
            </Box>
            {theme && !archived && (
              <Button size="small" startIcon={<EditIcon />} onClick={() => setThemeDialog({ theme })}>
                Edit theme
              </Button>
            )}
            <Button size="small" startIcon={<PlannerIcon />} component={RouterLink} to={paths.planner({ view: 'list', campaign: campaign._id, theme: theme?._id })}>
              In the Planner
            </Button>
          </Box>

          {posts === null ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
              <CircularProgress size={20} sx={{ color: 'var(--text-muted)' }} />
            </Box>
          ) : shown.length === 0 ? (
            themes && themes.length === 0 && totalPosts === 0 ? (
              <EmptyState
                icon={<ThemeIcon />}
                title="Plan this campaign"
                text={aiOn ? 'Let AI draft themes and posts for you to review, or add them yourself.' : 'Add a theme (a strand of the campaign, like “Launch week”), then add posts to it.'}
                action={
                  archived ? undefined : (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {aiOn && (
                        <Button variant="contained" startIcon={<AiIcon />} onClick={() => setPlanOpen(true)}>
                          Plan with AI
                        </Button>
                      )}
                      <Button variant={aiOn ? 'outlined' : 'contained'} startIcon={<AddIcon />} onClick={() => setThemeDialog({})}>
                        New theme
                      </Button>
                    </Box>
                  )
                }
              />
            ) : (
              <EmptyState
                compact
                title={theme ? 'No posts in this theme yet' : 'No posts yet'}
                action={
                  archived ? undefined : (
                    <Button startIcon={<AddIcon />} onClick={() => setNewPost({ projectId: theme?._id })}>
                      New post
                    </Button>
                  )
                }
              />
            )
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {shown.map((p) => (
                <PostCard key={p._id} post={p} onOpen={openPost} variant="row" showDate draggable={false} />
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {!archived && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setEditCampaign(true);
            }}
          >
            Edit details
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenu(null);
            navigate(paths.planner({ view: 'month', campaign: campaign._id }));
          }}
        >
          See in the Planner
        </MenuItem>
        {archived ? (
          <MenuItem
            onClick={() => {
              setMenu(null);
              restore();
            }}
          >
            Restore
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setConfirmArchive(true);
            }}
          >
            Archive
          </MenuItem>
        )}
      </Menu>

      <Dialog open={confirmArchive} onClose={() => setConfirmArchive(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Archive “{campaign.name}”?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            It disappears from your lists and the Planner, and you can restore it from Campaigns › Archived.
            {scheduledCount > 0 &&
              ` Its ${scheduledCount} post${scheduledCount === 1 ? '' : 's'} waiting in Publishing will be cancelled and won’t go out, even if you restore it.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmArchive(false)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={archive}>
            {scheduledCount > 0 ? 'Archive and cancel' : 'Archive'}
          </Button>
        </DialogActions>
      </Dialog>

      <CampaignDialog open={editCampaign} campaign={campaign} onClose={() => setEditCampaign(false)} onSaved={(c) => setCampaign((prev) => ({ ...prev, ...c }) as Campaign)} />

      <ThemeDialog
        open={Boolean(themeDialog)}
        campaignId={campaign._id}
        theme={themeDialog?.theme}
        postCount={themeDialog?.theme ? countByTheme.get(themeDialog.theme._id) || 0 : 0}
        onClose={() => setThemeDialog(null)}
        onSaved={(t) => {
          loadThemes();
          if (!themeDialog?.theme) selectTheme(t._id);
        }}
        onDeleted={() => {
          selectTheme(ALL);
          loadThemes();
        }}
      />

      {aiOn && <PlanWithAIDialog open={planOpen} campaign={campaign} onClose={() => setPlanOpen(false)} onCreated={() => { loadThemes(); loadPosts(); }} />}

      <NewPostDialog
        open={Boolean(newPost)}
        defaults={{ campaignId: campaign._id, projectId: newPost?.projectId }}
        onClose={() => setNewPost(null)}
        onCreated={() => {
          loadThemes();
          loadPosts();
        }}
      />
    </Box>
  );
}

function ThemeItem({ active, onClick, title, meta, sub, progress, wide }: { active: boolean; onClick: () => void; title: string; meta: string; sub?: string; progress?: number; wide: boolean }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      sx={{
        all: 'unset', boxSizing: 'border-box', cursor: 'pointer', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.25,
        px: 1.25, py: wide ? 0.9 : 0.6, borderRadius: wide ? 'var(--r-card)' : 9999, maxWidth: wide ? 'none' : 220,
        bgcolor: active ? 'var(--bg-selected, var(--bg-hover))' : wide ? 'transparent' : 'var(--bg-subtle)',
        border: wide ? 'none' : '1px solid', borderColor: active ? 'var(--border-strong)' : 'var(--border)',
        '&:hover': { bgcolor: 'var(--bg-hover)' }, '&:focus-visible': { outline: '2px solid var(--border-strong)', outlineOffset: 1 }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: active ? 700 : 500, color: 'var(--text-strong)' }}>{title}</Typography>
        <Typography sx={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta}</Typography>
      </Box>
      {sub && <Typography noWrap sx={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{sub}</Typography>}
      {progress !== undefined && (
        <Box sx={{ height: 3, borderRadius: 2, bgcolor: 'var(--bg-subtle)', overflow: 'hidden', mt: 0.25 }} aria-hidden>
          <Box sx={{ height: '100%', width: `${Math.round(progress * 100)}%`, bgcolor: 'var(--st-ready-dot)' }} />
        </Box>
      )}
    </Box>
  );
}

function About({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-subtle)', mb: 0.25 }}>{label}</Typography>
      <Box sx={{ fontSize: 14, color: 'var(--text-strong)', whiteSpace: 'pre-wrap' }}>{children}</Box>
    </Box>
  );
}
