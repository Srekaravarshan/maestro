/**
 * In dev mode, Vite proxies /events and /api to localhost:3444.
 * In the production Tauri build, there's no Vite proxy — use absolute URL.
 */
export const SERVER_URL = import.meta.env?.DEV ? '' : 'http://localhost:3444';
