import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, IconButton, Menu, Tooltip, Typography } from '@mui/material';
import {
  Close as CloseIcon,
  OpenInFull as FullScreenIcon,
  History as HistoryIcon,
  AddComment as NewChatIcon
} from '@mui/icons-material';
import { useBlueStore } from '../../store/blueStore';
import BlueChat, { BlueMark } from './BlueChat';
import { ConversationList } from './BlueConversations';

export { BlueMark };

/**
 * Blue's side panel: docked on the right while you work on other pages (toggle from the sidebar or
 * Ctrl/⌘+J), full screen on phones. "Full screen" moves the same conversation to the Blue page.
 * Hidden on the Blue page itself.
 */
export default function BluePanel() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onBluePage = pathname === '/blue' || pathname.startsWith('/blue/');
  const { open, busy, setOpen, init, newChat } = useBlueStore();
  const [historyAnchor, setHistoryAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (open && !onBluePage) init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onBluePage]);

  if (!open || onBluePage) return null;

  return (
    <aside className="bp-blue" aria-label="Blue assistant">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, height: 48, borderBottom: '1px solid var(--border)', flex: '0 0 auto' }}>
        <BlueMark />
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>Blue</Typography>
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
        <Tooltip title="Full screen: chat in the middle, results on the side">
          <IconButton size="small" onClick={() => navigate('/blue')} aria-label="Open Blue full screen" sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
            <FullScreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close (Ctrl+J)">
          <IconButton size="small" onClick={() => setOpen(false)} aria-label="Close Blue">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Menu anchorEl={historyAnchor} open={Boolean(historyAnchor)} onClose={() => setHistoryAnchor(null)} PaperProps={{ sx: { width: 300, maxHeight: 420 } }}>
        <ConversationList dense onPicked={() => setHistoryAnchor(null)} />
      </Menu>

      <BlueChat surface="panel" autoFocus />
    </aside>
  );
}
