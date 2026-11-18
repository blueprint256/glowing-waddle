import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import {
  Add as AddIcon,
  AutoAwesome as AiIcon,
  MoreVert as MoreIcon,
  Edit as EditIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  CalendarMonth as PlannerIcon,
  PostAdd as PostsIcon
} from '@mui/icons-material';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { MetaChip, StatusDot } from '../../components/ui/StatusChip';
import PostCard, { type PlannerPost } from '../../components/posts/PostCard';
import { useNewPost, useOpenPost, usePostEvents } from '../../components/posts/PostPanelHost';
import CampaignDialog, { type CampaignLike } from '../../components/campaigns/CampaignDialog';
import PlanWithAIDialog from '../../components/campaigns/PlanWithAIDialog';
import { campaignAPI, taskAPI } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { canUseAI } from '../../types';
import { campaignColor } from '../../lib/colors';
import { POST_STATUSES, campaignStatusMeta, postStatusMeta, toPostStatus } from '../../lib/status';
import { dayKey, formatDayRange, formatMonth, todayKey } from '../../lib/dates';
import { paths } from '../../lib/paths';
import { errorMessage, notify } from '../../store/toastStore';

/**
 * One campaign: what it's about and its posts, by month (posts without a day first). A campaign is
 * just a way to group posts: it can be archived (its unsent posts are cancelled) or deleted while
 * keeping its posts (they stay, without a campaign). Plan with AI drafts posts for review.
 */

interface Campaign extends CampaignLike {
  archived?: boolean;
  createdBy?: { _id: string } | string;
}

/** Posts with a day first (earliest first), then the ones without. */
function byDay(a: PlannerPost, b: PlannerPost) {
  const da = dayKey(a.taskDate) || '9999';
  const db = dayKey(b.taskDate) || '9999';
  return da.localeCompare(db) || a.name.localeCompare(b.name);
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const aiOn = canUseAI(user);
  const openPost = useOpenPost();
  const newPost = useNewPost();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<PlannerPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editCampaign, setEditCampaign] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  const loadCampaign = useCallback(async () => {
    try {
      const res = await campaignAPI.getById(id!);
      setCampaign(res.data.campaign);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'This campaign couldn’t be opened.'));
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
    loadPosts();
  }, [loadCampaign, loadPosts]);

  useEffect(() => {
    setCampaign(null);
    setPosts(null);
    loadAll();
  }, [loadAll]);

  usePostEvents(() => loadPosts());

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of posts || []) {
      const s = toPostStatus(p.status);
      m[s] = (m[s] || 0) + 1;
    }
    return m;
  }, [posts]);

  // Posts without a day, then by month; months before this one are folded away.
  const groups = useMemo(() => {
    const thisMonth = todayKey().slice(0, 7);
    const out: { key: string; title: string; earlier: boolean; posts: PlannerPost[] }[] = [];
    for (const p of [...(posts || [])].sort(byDay)) {
      const k = dayKey(p.taskDate);
      const key = k ? k.slice(0, 7) : 'none';
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, title: k ? formatMonth(`${key}-01`) : 'No day yet', earlier: Boolean(k && key < thisMonth), posts: [] };
        out.push(g);
      }
      g.posts.push(p);
    }
    return out.sort((a, b) => (a.key === 'none' ? -1 : b.key === 'none' ? 1 : a.key.localeCompare(b.key)));
  }, [posts]);

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
  const earlierGroups = groups.filter((g) => g.earlier);
  const earlierCount = earlierGroups.reduce((n, g) => n + g.posts.length, 0);
  const shownGroups = showEarlier ? groups : groups.filter((g) => !g.earlier);

  const archive = async () => {
    setConfirm(null);
    try {
      const res = await campaignAPI.archive(campaign._id);
      notify(res.data.message || 'Campaign archived');
      loadAll();
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t archive the campaign.'), { tone: 'error' });
    }
  };

  const deleteKeepingPosts = async () => {
    setConfirm(null);
    try {
      const res = await campaignAPI.deleteKeepingPosts(campaign._id);
      notify(res.data.message || 'Campaign deleted');
      navigate(paths.campaigns(), { replace: true });
    } catch (e) {
      notify(errorMessage(e, 'Couldn’t delete the campaign.'), { tone: 'error' });
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
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => newPost({ campaignId: campaign._id })}>
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

      {/* Posts */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <Typography component="h2" sx={{ flex: 1, fontSize: 17, fontWeight: 700, color: 'var(--text-strong)' }}>
          Posts{totalPosts ? ` · ${totalPosts}` : ''}
        </Typography>
        {earlierCount > 0 && (
          <Button size="small" onClick={() => setShowEarlier((v) => !v)}>
            {showEarlier ? 'Hide earlier months' : `Show ${earlierCount} earlier post${earlierCount === 1 ? '' : 's'}`}
          </Button>
        )}
        <Button size="small" startIcon={<PlannerIcon />} component={RouterLink} to={paths.planner({ view: 'month', campaign: campaign._id })}>
          In the Planner
        </Button>
      </Box>

      {posts === null ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress size={20} sx={{ color: 'var(--text-muted)' }} />
        </Box>
      ) : totalPosts === 0 ? (
        <EmptyState
          icon={<PostsIcon />}
          title="Plan this campaign"
          text={aiOn ? 'Let AI draft posts for you to review, or add them yourself.' : 'Add the campaign’s posts, each with a day.'}
          action={
            archived ? undefined : (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                {aiOn && (
                  <Button variant="contained" startIcon={<AiIcon />} onClick={() => setPlanOpen(true)}>
                    Plan with AI
                  </Button>
                )}
                <Button variant={aiOn ? 'outlined' : 'contained'} startIcon={<AddIcon />} onClick={() => newPost({ campaignId: campaign._id })}>
                  New post
                </Button>
              </Box>
            )
          }
        />
      ) : shownGroups.length === 0 ? (
        <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)', py: 2 }}>Nothing planned from this month on.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {shownGroups.map((g) => (
            <Box key={g.key} component="section" aria-label={g.title}>
              <Typography component="h3" sx={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', mb: 0.75 }}>
                {g.title} · {g.posts.length}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {g.posts.map((p) => (
                  <PostCard key={p._id} post={p} onOpen={openPost} variant="row" showDate={g.key !== 'none'} draggable={false} />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

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
              setConfirm('archive');
            }}
          >
            Archive
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenu(null);
            setConfirm('delete');
          }}
          sx={{ color: 'var(--danger-text)' }}
        >
          Delete campaign, keep its posts
        </MenuItem>
      </Menu>

      <Dialog open={confirm === 'archive'} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Archive “{campaign.name}”?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            It and its posts disappear from your lists and the Planner, and you can restore it from Campaigns › Archived.
            {scheduledCount > 0 &&
              ` Its ${scheduledCount} post${scheduledCount === 1 ? '' : 's'} waiting in Publishing will be cancelled and won’t go out, even if you restore it.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={archive}>
            {scheduledCount > 0 ? 'Archive and cancel' : 'Archive'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirm === 'delete'} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete “{campaign.name}”?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            The campaign goes, its details too (key messages, hashtags).{' '}
            {totalPosts > 0
              ? `Its ${totalPosts} post${totalPosts === 1 ? ' stays' : 's stay'} in the Planner without a campaign, and anything scheduled still goes out.`
              : 'It has no posts.'}{' '}
            This can’t be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={deleteKeepingPosts}>
            Delete campaign
          </Button>
        </DialogActions>
      </Dialog>

      <CampaignDialog open={editCampaign} campaign={campaign} onClose={() => setEditCampaign(false)} onSaved={(c) => setCampaign((prev) => ({ ...prev, ...c }) as Campaign)} />

      {aiOn && <PlanWithAIDialog open={planOpen} campaign={campaign} onClose={() => setPlanOpen(false)} onCreated={() => loadPosts()} />}
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
