import { Fragment, type ReactNode } from 'react';
import { Box } from '@mui/material';

/**
 * Renders Blue's replies: paragraphs, **bold**, `code`, and simple bullet / numbered lists.
 * Built from React elements only (no HTML injection).
 */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else
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
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <Box sx={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text)', '& p': { m: 0 }, '& p + p, & ul, & ol': { mt: 1 }, '& ul, & ol': { pl: 2.5, mb: 0 } }}>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        const bullet = lines.length > 0 && lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const numbered = lines.length > 0 && lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullet || numbered) {
          const Tag = numbered ? 'ol' : 'ul';
          return (
            <Tag key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </Box>
  );
}
