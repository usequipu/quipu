import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface MessageMarkdownProps {
  body: string;
}

export default function MessageMarkdown({ body }: MessageMarkdownProps) {
  const html = useMemo(() => {
    const raw = marked.parse(body ?? '', { async: false }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [body]);

  const ref = (el: HTMLDivElement | null) => {
    if (!el) return;
    const blocks = el.querySelectorAll<HTMLElement>('pre code');
    blocks.forEach((block) => {
      if (block.dataset.highlighted === 'true') return;
      try {
        hljs.highlightElement(block);
        block.dataset.highlighted = 'true';
      } catch {
        /* swallow — leave block unstyled */
      }
    });
  };

  return <div ref={ref} className="agent-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
