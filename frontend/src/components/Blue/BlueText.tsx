import { Fragment, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { pathFrom, useBlueOpen } from './BlueSurface';

/**
 * Renders Blue's replies: paragraphs, **bold**, `code`, [links](url), bare links, and simple
 * bullet / numbered lists. Built from React elements only (no HTML injection).
 * Links into the app open in place (the right-hand panel on the full-screen Blue page); others open
 * in a new tab. Only http(s) and app paths become links.
 */
type Opener = ReturnType<typeof useBlueOpen>;

function isAppLink(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url);
    return u.origin === window.location.origin || (/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && /^\/(tasks|projects|campaigns|library|inbox|publishing|calendar)\b/.test(u.pathname));
  } catch {
    return false;
  }
}

function Link({ url, label, open }: { url: string; label: ReactNode; open: Opener }) {
  const safe = /^https?:\/\//i.test(url) || url.startsWith('/');
  if (!safe) return <>{label}</>;
  const sx = { color: 'var(--accent-blue-fg, var(--link))', textDecoration: 'underline', cursor: 'pointer', overflowWrap: 'anywhere' } as const;
  if (isAppLink(url) && pathFrom(url)) {
    return (
      <Box component="a" href={pathFrom(url)!} sx={sx} onClick={(e: { preventDefault(): void }) => { e.preventDefault(); open(url)?.(); }}>
        {label}
      </Box>
    );
  }
  return (
    <Box component="a" href={url} target="_blank" rel="noopener noreferrer" sx={sx}>
      {label}
    </Box>
  );
}

function inline(text: string, open: Opener): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|!?\[[^\]]*\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('[') || token.startsWith('![')) {
      const lm = token.match(/^!?\[([^\]]*)\]\(([^)\s]+)\)$/);
      parts.push(lm ? <Link key={key++} url={lm[2]} label={lm[1] || 'link'} open={open} /> : token);
    } else if (/^https?:\/\//.test(token)) {
      const url = token.replace(/[.,;:!?]+$/, '');
      parts.push(<Link key={key++} url={url} label={url} open={open} />);
      if (url.length < token.length) parts.push(token.slice(url.length));
    } else
      parts.push(
        <Box key={key++} component="code" sx={{ fontFamily: 'var(--font-mono)', fontSize: '0.92em', bgcolor: 'var(--bg-subtle)', px: 0.5, borderRadius: '4px' }}>
          {token.slice(1, -1)}
        </Box>
      );
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function BlueText({ text }: { text: string }) {
  const open = useBlueOpen();
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <Box sx={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0, '& p': { m: 0 }, '& p + p, & ul, & ol': { mt: 1 }, '& ul, & ol': { pl: 2.5, mb: 0 } }}>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        const bullet = lines.length > 0 && lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const numbered = lines.length > 0 && lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullet || numbered) {
          const Tag = numbered ? 'ol' : 'ul';
          return (
            <Tag key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), open)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, open)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </Box>
  );
}
