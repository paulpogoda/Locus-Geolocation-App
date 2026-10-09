import { useEffect, useMemo, useRef, useState } from 'react';

/** Strips scripts and makes every link open without a reference back to LOCUS. */
function hardenHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script').forEach((el) => el.remove());
  doc.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return doc.head.innerHTML + doc.body.innerHTML;
}

/**
 * Google requires showing the Search Suggestions chip returned with Search grounding.
 * The HTML comes from the API, so it is rendered in a sandboxed iframe without script
 * execution instead of being injected into the app's DOM. allow-same-origin (without
 * allow-scripts) only lets the parent read the content height; nothing runs inside.
 */
export function SearchEntryPointFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(64);
  const safeHtml = useMemo(() => hardenHtml(html), [html]);

  useEffect(() => {
    setHeight(64);
  }, [html]);

  const onLoad = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(Math.min(Math.max(doc.body.scrollHeight + 8, 40), 240));
  };

  return (
    <iframe
      ref={ref}
      title="Google Search suggestions"
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${safeHtml}</body></html>`}
      onLoad={onLoad}
      style={{ width: '100%', height, border: 0, colorScheme: 'normal' }}
    />
  );
}
