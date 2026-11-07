import { Fragment, type ReactNode } from 'react';

/** Inline: **bold**, *italic*, `code`. Rendered as React nodes — never as HTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++} className="font-semibold text-slate-900">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++} className="rounded bg-slate-100 px-1 text-[0.85em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A small, safe markdown renderer for agent answers: headings, lists, tables-as-text, paragraphs. */
export default function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length} className="leading-relaxed">{inline(para.join(' '))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered
      ? <ol key={blocks.length} className="list-decimal space-y-1 pl-5">{items}</ol>
      : <ul key={blocks.length} className="list-disc space-y-1 pl-5">{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*(---|━+|\|?\s*-{3,})/.test(line)) { flushPara(); flushList(); continue; }
    if (h) {
      flushPara(); flushList();
      const size = h[1].length <= 2 ? 'text-base' : 'text-sm';
      blocks.push(<h4 key={blocks.length} className={`${size} mt-1 font-bold text-slate-900`}>{inline(h[2])}</h4>);
    } else if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else {
      flushList();
      para.push(line.trim().replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' · '));
    }
  }
  flushPara(); flushList();
  return <div className={`space-y-2 text-sm text-slate-700 ${className}`}>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
