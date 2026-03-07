import '@testing-library/jest-dom';

// Mock crypto.randomUUID
if (!globalThis.crypto) {
  globalThis.crypto = {};
}
if (!globalThis.crypto.randomUUID) {
  let counter = 0;
  globalThis.crypto.randomUUID = () => `test-uuid-${++counter}`;
}

// Mock window.electronAPI as undefined (browser mode)
delete window.electronAPI;

// Mock localStorage
const store = {};
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  },
});
