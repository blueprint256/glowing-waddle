import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, CircularProgress, IconButton, TextField, Typography } from '@mui/material';
import { ArrowUpward as SendIcon, WarningAmber as WarningIcon } from '@mui/icons-material';
import { useBlueStore } from '../../store/blueStore';
import { useAuthStore } from '../../store/authStore';
import { BlueToolItem } from './BlueBlocks';
import BlueText from './BlueText';
import { BlueSurfaceContext, type BlueSurface } from './BlueSurface';
import type { BlueItem } from '../../services/blue';
import { UserRole } from '../../types';

const STARTERS = [
  'What’s going out this week?',
  'Which posts are still in Draft?',
  'Plan a 5-day campaign with a post every day',
  'Show my latest pictures from the Library'
];

export function BlueMark({ size = 22 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size, height: size, borderRadius: '50%', flex: '0 0 auto',
        bgcolor: 'var(--accent-blue-fg)', color: '#fff', display: 'grid', placeItems: 'center',
        fontSize: size * 0.5, fontWeight: 700, fontFamily: 'var(--font-sans)'
      }}
    >
      B
    </Box>
  );
}

function ConfirmCard({ item }: { item: Extract<BlueItem, { kind: 'confirm' }> }) {
  const { confirm, busy } = useBlueStore();
  return (
    <Box sx={{ border: '1px solid var(--border-strong)', borderRadius: 'var(--r-card)', p: 1.25, bgcolor: 'var(--warning-surface)' }}>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
        <WarningIcon sx={{ fontSize: 18, color: 'var(--warning)', mt: '1px' }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>Confirm before Blue continues</Typography>
          {item.pending.summaries.map((s, i) => (
            <Typography key={i} sx={{ fontSize: 13, color: 'var(--text)' }}>
              {s}
            </Typography>
          ))}
        </Box>
      </Box>
      {item.resolved ? (
        <Typography sx={{ fontSize: 12, color: 'var(--text-muted)', mt: 1 }}>{item.resolved === 'approved' ? 'Confirmed' : 'Cancelled'}</Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.25, justifyContent: 'flex-end' }}>
          <Button size="small" variant="outlined" onClick={() => confirm(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="small" variant="contained" color="error" onClick={() => confirm(true)} disabled={busy}>
            Confirm
          </Button>
        </Box>
      )}
    </Box>
  );
}

function Item({ item }: { item: BlueItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <Box
          sx={{
            alignSelf: 'flex-end', maxWidth: '85%', bgcolor: 'var(--bg-hover)', color: 'var(--text-strong)',
            borderRadius: '14px 14px 4px 14px', px: 1.5, py: 1, fontSize: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'
          }}
        >
          {item.text}
        </Box>
      );
    case 'assistant':
      return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <BlueMark size={20} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <BlueText text={item.text} />
          </Box>
        </Box>
      );
    case 'tool':
      return (
        <Box sx={{ pl: '28px' }}>
          <BlueToolItem item={item} />
        </Box>
      );
    case 'confirm':
      return (
        <Box sx={{ pl: '28px' }}>
          <ConfirmCard item={item} />
        </Box>
      );
    case 'error':
      return (
        <Box sx={{ pl: '28px', fontSize: 13, color: 'var(--danger-text)', display: 'flex', gap: 0.75 }}>
          <WarningIcon sx={{ fontSize: 16, mt: '1px' }} />
          <span>{item.message}</span>
        </Box>
      );
  }
}

/**
 * The conversation and the message box. Used by the side panel and by the full-screen Blue page
 * (same conversation, so switching between them never loses your place).
 */
export default function BlueChat({ surface, autoFocus }: { surface: BlueSurface; autoFocus?: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { status, items, busy, loading, send } = useBlueStore();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wide = surface === 'page';

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 50);
  }, [autoFocus]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, busy]);

  const submit = () => {
    if (!text.trim() || busy || status?.available === false) return;
    send(text);
    setText('');
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const unavailable = status && !status.available;
  // Whichever runs out first: today's messages or this month's allowance.
  const today = status?.remainingToday;
  const month = status?.remainingThisMonth;
  const remaining = typeof month === 'number' && (typeof today !== 'number' || month < today) ? month : today;
  const remainingLabel = remaining === month && typeof month === 'number' && month !== today ? 'this month' : 'today';
  const last = items[items.length - 1];
  const lastIsWorking = busy && !(last && last.kind === 'tool' && last.running);
  const column = wide ? { width: '100%', maxWidth: 760, mx: 'auto' } : {};

  return (
    <BlueSurfaceContext.Provider value={surface}>
      {/* Messages */}
      <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: wide ? { xs: 1.5, md: 3 } : 1.5, py: 2 }}>
        <Box sx={{ ...column, display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: '100%' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={20} sx={{ color: 'var(--text-muted)' }} />
            </Box>
          ) : items.length === 0 ? (
            <Box sx={{ m: 'auto', textAlign: 'center', maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
              <BlueMark size={40} />
              <Typography sx={{ fontSize: 17, fontWeight: 600, color: 'var(--text-strong)' }}>Hi {user?.firstName || 'there'}, I’m Blue</Typography>
              <Typography sx={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                Tell me what you need and I’ll do it in the app: create campaigns and tasks, check your calendar, update statuses, write posts, find past work.
              </Typography>
              {!unavailable && (
                <Box sx={{ display: 'grid', gridTemplateColumns: wide ? { xs: '1fr', sm: '1fr 1fr' } : '1fr', gap: 0.75, width: '100%', mt: 1 }}>
                  {STARTERS.map((s) => (
                    <Button
                      key={s}
                      variant="outlined"
                      size="small"
                      onClick={() => send(s)}
                      sx={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 13, textTransform: 'none', color: 'var(--text)', borderColor: 'var(--border)' }}
                    >
                      {s}
                    </Button>
                  ))}
                </Box>
              )}
            </Box>
          ) : (
            items.map((item, i) => <Item key={i} item={item} />)
          )}
          {lastIsWorking && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', pl: '28px', color: 'var(--text-muted)', fontSize: 13 }}>
              <CircularProgress size={13} sx={{ color: 'var(--text-muted)' }} />
              Blue is working…
            </Box>
          )}
        </Box>
      </Box>

      {/* Composer */}
      <Box sx={{ p: 1.5, borderTop: wide ? 'none' : '1px solid var(--border)', flex: '0 0 auto' }}>
        <Box sx={column}>
          {unavailable ? (
            <Box sx={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span>{status?.reason || 'Blue is unavailable right now.'}</span>
              {user?.role === UserRole.SYSTEM_ADMIN && status?.code === 'BLUE_NOT_CONFIGURED' && (
                <Button size="small" variant="outlined" onClick={() => navigate('/settings')} sx={{ alignSelf: 'flex-start' }}>
                  Open settings
                </Button>
              )}
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  display: 'flex', alignItems: 'flex-end', gap: 1, border: '1px solid var(--border-strong)', borderRadius: 'var(--r-card)',
                  px: 1.25, py: 0.75, bgcolor: 'var(--bg-raised)'
                }}
              >
                <TextField
                  inputRef={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Ask Blue or tell it what to do…"
                  multiline
                  maxRows={8}
                  fullWidth
                  variant="standard"
                  InputProps={{ disableUnderline: true, sx: { fontSize: 14 } }}
                  inputProps={{ 'aria-label': 'Message Blue', maxLength: 8000 }}
                />
                <IconButton
                  onClick={submit}
                  disabled={busy || !text.trim()}
                  aria-label="Send"
                  sx={{
                    width: 32, height: 32, bgcolor: 'var(--primary-bg)', color: 'var(--primary-fg)',
                    '&:hover': { bgcolor: 'var(--primary-bg-hover)' }, '&.Mui-disabled': { bgcolor: 'var(--bg-hover)' }
                  }}
                >
                  {busy ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </Box>
              <Typography sx={{ fontSize: 12, color: 'var(--text-faint)', mt: 0.75, textAlign: 'center' }}>
                Blue acts with your permissions and asks before deleting anything.
                {typeof remaining === 'number' ? ` ${remaining} message${remaining === 1 ? '' : 's'} left ${remainingLabel}.` : ''}
              </Typography>
            </>
          )}
        </Box>
      </Box>
    </BlueSurfaceContext.Provider>
  );
}
