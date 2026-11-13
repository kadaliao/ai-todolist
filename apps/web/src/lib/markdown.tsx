import { Fragment, type ReactNode } from 'react';

/**
 * Minimal Markdown for task notes: headings, bullet/numbered/check lists, paragraphs, **bold**,
 * *italic*, `code`, [links](url) and bare URLs. Renders React nodes (no innerHTML), and only
 * http(s)/mailto links, so notes can't inject markup.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const s = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${i++}`;
    if (s.startsWith('**')) out.push(<strong key={k}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith('`')) out.push(<code key={k}>{s.slice(1, -1)}</code>);
    else if (s.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(s);
      const href = mm ? safeHref(mm[2] as string) : null;
      out.push(
        href ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
          >
            {mm?.[1]}
          </a>
        ) : (
          s
        ),
      );
    } else if (s.startsWith('http')) {
      out.push(
        <a key={k} href={s} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
          {s.replace(/^https?:\/\//, '')}
        </a>,
      );
    } else out.push(<em key={k}>{s.slice(1, -1)}</em>);
    last = at + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      blocks.push(list.ordered ? <ol key={k}>{list.items}</ol> : <ul key={k}>{list.items}</ul>);
      list = null;
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = (h[1] as string).length;
      const Tag = (['h1', 'h2', 'h3'] as const)[level - 1] ?? 'h3';
      blocks.push(<Tag key={`h${idx}`}>{inline(h[2] as string, `h${idx}`)}</Tag>);
    } else if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      const body = (bullet ? bullet[2] : num?.[1]) ?? '';
      const checked = bullet?.[1];
      list.items.push(
        <li key={`i${idx}`} className={checked !== undefined ? 'list-none -ml-4' : undefined}>
          {checked !== undefined && <span className="mr-1.5">{checked === ' ' ? '☐' : '☑'}</span>}
          {inline(body, `i${idx}`)}
        </li>,
      );
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  });
  flushPara();
  flushList();
  return <div className="prose-notes">{blocks}</div>;
}
