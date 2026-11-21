import { Box, IconButton, ListItemButton, ListItemText, Typography } from '@mui/material';
import { DeleteOutline as DeleteIcon } from '@mui/icons-material';
import { useBlueStore } from '../../store/blueStore';

function when(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Saved chats: in the side panel's "Previous chats" menu and down the left of the Blue page. */
export function ConversationList({ dense, onPicked }: { dense?: boolean; onPicked?: () => void }) {
  const { conversations, conversationId, openConversation, deleteConversation } = useBlueStore();
  if (!conversations.length) {
    return <Typography sx={{ fontSize: 13, color: 'var(--text-muted)', px: 2, py: 1.5 }}>No previous chats</Typography>;
  }
  return (
    <Box role="list">
      {conversations.map((c) => (
        <ListItemButton
          key={c.id}
          role="listitem"
          selected={c.id === conversationId}
          onClick={() => {
            onPicked?.();
            openConversation(c.id);
          }}
          sx={{
            gap: 0.5, py: dense ? 0.5 : 0.75, px: 1.5, borderRadius: dense ? 0 : 'var(--r-ctl)',
            '& .del': { opacity: 0 }, '&:hover .del, &.Mui-focusVisible .del': { opacity: 1 },
            '&.Mui-selected': { bgcolor: 'var(--bg-hover)' }
          }}
        >
          <ListItemText
            primary={c.title}
            secondary={when(c.updatedAt)}
            primaryTypographyProps={{ noWrap: true, fontSize: 13, color: 'var(--text-strong)' }}
            secondaryTypographyProps={{ fontSize: 12 }}
          />
          <IconButton
            className="del"
            size="small"
            aria-label={`Delete chat ${c.title}`}
            onClick={(e) => {
              e.stopPropagation();
              deleteConversation(c.id);
            }}
          >
            <DeleteIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </ListItemButton>
      ))}
    </Box>
  );
}
