// Server URL configuration
// Thin-shell preload injects window.__QUIPU_CONFIG__ via contextBridge
// In dev browser mode, defaults to localhost:3000
const config = window.__QUIPU_CONFIG__;
export const SERVER_URL = config?.serverUrl || 'http://localhost:3000';
export const WS_URL = config?.wsUrl || SERVER_URL.replace(/^http/, 'ws');
