/**
 * Extension registry — maps file types to viewer components.
 *
 * Core code imports only from this module, never from individual extensions.
 * Extensions register themselves via registerExtension() at app startup.
 */

const extensions = [];

export function registerExtension(descriptor) {
  extensions.push(descriptor);
  extensions.sort((a, b) => b.priority - a.priority);
}

/**
 * Returns the React component that should render the given tab,
 * or null if no extension matches (fall back to Editor).
 */
export function resolveViewer(tab, activeFile) {
  for (const ext of extensions) {
    if (ext.canHandle(tab, activeFile)) return ext.component;
  }
  return null;
}

export function getRegisteredExtensions() {
  return [...extensions];
}
