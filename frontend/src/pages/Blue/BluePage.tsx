import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Drawer, IconButton, Menu, Tooltip, Typography, useMediaQuery } from '@mui/material';
import {
  AddComment as NewChatIcon,
  History as HistoryIcon,
  CloseFullscreen as SidePanelIcon
} from '@mui/icons-material';
import { useBlueStore } from '../../store/blueStore';
import { useAuthStore } from '../../store/authStore';
import BlueChat, { BlueMark } from '../../components/Blue/BlueChat';
import BlueDetail from '../../components/Blue/BlueDetail';
import { ConversationList } from '../../components/Blue/BlueConversations';

/**
 * Blue, full screen: saved chats on the left, the conversation in the middle, and whatever you click
 * in the chat (a task, poster, campaign, project) opens on the right. "Side panel" goes back to the
 * page you were on with Blue docked beside it; the conversation is the same either way.
 */
export default function BluePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { init, newChat, busy, detail, closeDetail, setOpen, conversationId, conversations } = useBlueStore();
  // ≥1200px: chats + chat + panel side by side. ≥992px: chat + panel side by side.
  // 768–991px: the panel slides over the chat from the right. Phones: it slides up from the bottom.
  const wideEnough = useMediaQuery('(min-width: 75em)');
  const sideBySide = useMediaQuery('(min-width: 62em)');
  const tablet = useMediaQuery('(min-width: 48em)');
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the right-hand panel when leaving the page, so it doesn't reappear unexpectedly.
  useEffect(() => () => closeDetail(), [closeDetail]);

  if (user?.assistantEnabled === false) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>Blue isn’t turned on for your account.</Box>
    );
  }

  const title = conversations.find((c) => c.id === conversationId)?.title || 'New chat';
  const showList = wideEnough || (sideBySide && !detail);

  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Saved chats */}
      {showList && (
        <Box
          component="nav"
          aria-label="Blue chats"
          sx={{ width: 240, flex: '0 0 240px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 48, flex: '0 0 auto' }}>
            <BlueMark />
            <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>Blue</Typography>
          </Box>
          <Box sx={{ px: 1, pb: 1 }}>
            <Button fullWidth size="small" variant="outlined" startIcon={<NewChatIcon fontSize="small" />} onClick={newChat} disabled={busy} sx={{ justifyContent: 'flex-start' }}>
              New chat
            </Button>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 0.5 }}>
            <ConversationList />
          </Box>
        </Box>
      )}

      {/* Conversation */}
      <Box component="section" aria-label="Conversation" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 48, borderBottom: '1px solid var(--border)', flex: '0 0 auto' }}>
          {!showList && <BlueMark />}
          <Typography noWrap sx={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</Typography>
          {!showList && (
            <>
              <Tooltip title="New chat">
                <span>
                  <IconButton size="small" onClick={newChat} aria-label="New chat" disabled={busy}>
                    <NewChatIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Previous chats">
                <IconButton size="small" onClick={(e) => setHistoryAnchor(e.currentTarget)} aria-label="Previous chats">
                  <HistoryIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
          <Tooltip title="Back to the side panel">
            <IconButton
              size="small"
              aria-label="Use Blue as a side panel"
              onClick={() => {
                setOpen(true);
                navigate(-1);
              }}
              sx={{ display: { xs: 'none', md: 'inline-flex' } }}
            >
              <SidePanelIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Menu anchorEl={historyAnchor} open={Boolean(historyAnchor)} onClose={() => setHistoryAnchor(null)} PaperProps={{ sx: { width: 300, maxHeight: 420 } }}>
          <ConversationList dense onPicked={() => setHistoryAnchor(null)} />
        </Menu>
        <BlueChat surface="page" autoFocus />
      </Box>

      {/* What you clicked in the chat */}
      {detail && sideBySide && (
        <Box
          component="aside"
          aria-label="Details"
          sx={{ width: { xs: 360, xl: 420 }, flex: { xs: '0 0 360px', xl: '0 0 420px' }, borderLeft: '1px solid var(--border)', minHeight: 0 }}
        >
          <BlueDetail />
        </Box>
      )}
      {detail && !sideBySide && (
        <Drawer
          anchor={tablet ? 'right' : 'bottom'}
          open
          onClose={closeDetail}
          PaperProps={{
            sx: tablet
              ? { width: 'min(440px, 92vw)', bgcolor: 'var(--bg-panel)', backgroundImage: 'none' }
              : { height: '88dvh', borderRadius: '12px 12px 0 0', bgcolor: 'var(--bg-panel)', backgroundImage: 'none' }
          }}
        >
          <BlueDetail />
        </Drawer>
      )}
    </Box>
  );
}
