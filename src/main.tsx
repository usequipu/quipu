import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './index.css'
import './styles/prosemirror.css'
import App from './App'

// In dev Electron mode the renderer origin is http://localhost:5188 — Chromium
// blocks file:// loads from http:// origins before the request reaches the
// network service (so session.webRequest.onBeforeRequest can't help).
// We intercept at the JS level and redirect file:// → quipu-file://, which is
// already registered in the main process and served via net.fetch with no CORS.
if (import.meta.env.DEV && (window as unknown as Record<string, unknown>).electronAPI) {
  const toQuipuFile = (url: string): string =>
    url.replace(/^file:\/\//, 'quipu-file://');

  // --- fetch ---
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init?) => {
    if (typeof input === 'string' && input.startsWith('file://'))
      input = toQuipuFile(input);
    else if (input instanceof Request && input.url.startsWith('file://'))
      input = new Request(toQuipuFile(input.url), input);
    return _fetch(input, init);
  };

  // --- XMLHttpRequest ---
  const _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string, url: string | URL,
    async = true, user?: string | null, pass?: string | null,
  ) {
    if (typeof url === 'string' && url.startsWith('file://'))
      url = toQuipuFile(url);
    return _xhrOpen.call(this, method, url, async as boolean, user, pass);
  };

  // --- Element.setAttribute (covers dynamic src="file://…") ---
  const _setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (name === 'src' && typeof value === 'string' && value.startsWith('file://'))
      value = toQuipuFile(value);
    return _setAttr.call(this, name, value);
  };

  // --- img / video src property setters ---
  for (const ctor of [HTMLImageElement, HTMLVideoElement, HTMLAudioElement] as const) {
    const desc = Object.getOwnPropertyDescriptor(ctor.prototype, 'src');
    if (desc?.set) {
      const _origSet = desc.set;
      Object.defineProperty(ctor.prototype, 'src', {
        ...desc,
        set(value: string) {
          if (typeof value === 'string' && value.startsWith('file://'))
            value = toQuipuFile(value);
          _origSet.call(this, value);
        },
      });
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
