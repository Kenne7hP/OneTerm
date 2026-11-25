import React, { useLayoutEffect, useRef } from 'react';
import { PromptPage } from '../../../shared/workbench';
import { t } from '../i18n';

interface Props {
  assistant: string;
  page?: PromptPage;
  busy: boolean;
  older: () => Promise<void>;
  resume: () => void;
  link?: () => void;
}

export function ConversationReader({ assistant, page, busy, older, resume, link }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const previous = useRef<{ height: number; cursor?: string }>();
  const loading = useRef(false);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || !page) { previous.current = undefined; return; }
    const before = previous.current;
    if (!before) node.scrollTop = node.scrollHeight;
    else if (before.cursor !== page.next) node.scrollTop += node.scrollHeight - before.height;
    previous.current = { height: node.scrollHeight, cursor: page.next };
  }, [page]);
  const earlier = async () => {
    if (!page?.next || busy || loading.current) return;
    loading.current = true;
    if (previous.current && viewport.current) previous.current.height = viewport.current.scrollHeight;
    try { await older(); } finally { loading.current = false; }
  };
  return <section className="flex min-h-0 flex-1 flex-col" aria-label={t('历史对话')}>
    <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [overflow-anchor:none]"
      onScroll={e => { if (e.currentTarget.scrollTop < 24) void earlier(); }}>
      <div className="mx-auto max-w-3xl space-y-4">
        {page?.next && <button className="btn-secondary" disabled={busy} onClick={() => void earlier()}>{t('加载更早消息')}</button>}
        {!page && <p>{t('加载中…')}</p>}
        {page?.error && <p role="alert">{page.error}</p>}
        {page && !page.items.length && !page.error && <p>{t('本页没有对话消息')}</p>}
        {page?.items.slice().reverse().map((item,i) => <article key={i} className="rounded-md border border-line px-4 py-3">
          <b className="text-xs text-fg-subtle">{item.role === 'assistant' ? assistant : t('你')}</b>
          <div className="mt-1 select-text whitespace-pre-wrap break-words text-fg">{item.text}</div>
          {item.truncated && <p className="text-xs text-fg-faint">{t('内容已截断')}</p>}
        </article>)}
      </div>
    </div>
    <footer className="flex shrink-0 justify-end gap-2 border-t border-line p-3">
      {link && <button className="btn-secondary" disabled={busy} onClick={link}>{t('关联到此任务')}</button>}
      <button className="btn-primary" disabled={busy} onClick={resume}>{t('继续此对话')}</button>
    </footer>
  </section>;
}
