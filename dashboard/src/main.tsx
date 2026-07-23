import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import HudApp from './HudApp';

// Both Tauri windows load this same bundle. The `hud` window is opened with
// url "index.html#hud"; the tray popup ("main") has no hash. Route on that.
const isHud = window.location.hash === '#hud';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isHud ? <HudApp /> : <App />}</StrictMode>
);
