mod pty_manager;
use pty_manager::PtyManager;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

// ── Tray state ──────────────────────────────────────────────────────────────

struct TrayState {
    icon_name:     Mutex<String>,
    /// Unix-ms timestamp of the last time we SHOWED the popover.
    /// The global mouse-click monitor uses this to ignore the very click
    /// that opened the popover (otherwise it would immediately re-close it).
    last_shown_ms: AtomicI64,
}
impl Default for TrayState {
    fn default() -> Self {
        Self {
            icon_name:     Mutex::new("idle".into()),
            last_shown_ms: AtomicI64::new(0),
        }
    }
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn load_tray_icon(app: &tauri::AppHandle, name: &str) -> Option<Image<'static>> {
    let filename = format!("icons/tray-{}.png", name);
    app.path().resource_dir().ok()
        .and_then(|dir| Image::from_path(dir.join(&filename)).ok())
}

/// Position the popover directly below the tray icon using the click rect.
/// tauri::Position / tauri::Size are enums — match to get physical pixels.
fn position_below_tray(window: &tauri::WebviewWindow, rect: &tauri::Rect) {
    let scale    = window.scale_factor().unwrap_or(1.0);
    let win_w_px = 320.0 * scale;

    let (px, py) = match rect.position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p)  => (p.x * scale, p.y * scale),
    };
    let (sw, sh) = match rect.size {
        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
        tauri::Size::Logical(s)  => (s.width * scale, s.height * scale),
    };

    let icon_cx  = px + sw / 2.0;
    let icon_bot = py + sh;
    let x = (icon_cx - win_w_px / 2.0).max(0.0) as i32;
    let y = icon_bot as i32 + 4;

    window.set_position(tauri::PhysicalPosition::new(x, y)).ok();
}

/// Fallback: position near top-right of screen (used on single-instance re-open).
fn position_popover_fallback(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let sw    = monitor.size().width as f64 / scale;
        let x = ((sw - 320.0 - 16.0) * scale) as i32;
        let y = (28.0 * scale) as i32;
        window.set_position(tauri::PhysicalPosition::new(x, y)).ok();
    }
}

// ── HUD pill positioning ─────────────────────────────────────────────────────

/// Logical width of the collapsed pill — must match HUD_PILL_W in HudApp.tsx.
const HUD_PILL_W: f64 = 200.0;

/// True for notched MacBook displays (14" = 1512pt, 16" = 1728pt wide).
fn is_notched(logical_width: f64) -> bool {
    matches!(logical_width.round() as i64, 1512 | 1728)
}

/// Vertical offset from the top edge — clears the menu bar (taller on notched Macs).
fn hud_top_y(logical_width: f64) -> f64 {
    if is_notched(logical_width) { 40.0 } else { 26.0 }
}

/// Center the HUD horizontally at the top of the primary display.
/// Uses the monitor ORIGIN (which is non-zero on secondary displays / multi-
/// monitor layouts) so it lands truly centered, not offset by the primary's width.
fn position_hud(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let pos   = monitor.position();               // physical, global coords
        let ox    = pos.x as f64 / scale;
        let oy    = pos.y as f64 / scale;
        let sw    = monitor.size().width as f64 / scale; // logical width
        let x     = ox + (sw - HUD_PILL_W) / 2.0;
        let y     = oy + hud_top_y(sw);
        window.set_position(tauri::LogicalPosition::new(x, y)).ok();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenInfo {
    width:    f64,  // logical
    height:   f64,  // logical
    scale:    f64,
    notch:    bool,
    origin_x: f64,  // logical origin of the display (multi-monitor aware)
    origin_y: f64,
}

/// Play a short native system sound for an alert.
/// kind: "done" | "error" | anything else (→ needs input).
#[tauri::command]
fn play_sound(kind: String) {
    #[cfg(target_os = "macos")]
    {
        let name = match kind.as_str() {
            "done"  => "Glass",
            "error" => "Basso",
            _       => "Ping",
        };
        Command::new("/usr/bin/afplay")
            .arg(format!("/System/Library/Sounds/{}.aiff", name))
            .spawn()
            .ok();
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = kind; }
}

/// Report primary-display geometry so the HUD can re-center itself as it resizes.
#[tauri::command]
fn get_screen(window: tauri::WebviewWindow) -> ScreenInfo {
    if let Ok(Some(m)) = window.primary_monitor() {
        let scale = m.scale_factor();
        let pos   = m.position();
        let w = m.size().width as f64 / scale;
        let h = m.size().height as f64 / scale;
        ScreenInfo { width: w, height: h, scale, notch: is_notched(w),
                     origin_x: pos.x as f64 / scale, origin_y: pos.y as f64 / scale }
    } else {
        ScreenInfo { width: 1440.0, height: 900.0, scale: 2.0, notch: false, origin_x: 0.0, origin_y: 0.0 }
    }
}

// ── macOS: global mouse-click monitor ────────────────────────────────────────
//
// A plain Tauri WebviewWindow doesn't participate in NSPopover's mutual-
// exclusion system, so clicking another menu-bar status item doesn't close
// our popup, and Focused(false) doesn't always fire for those clicks.
//
// This installs a global NSEvent monitor for left/right mouse-down events.
// Any click anywhere — in another app, on the desktop, on another menu-bar
// item — hides our popup.  A 300 ms guard around "last shown" prevents the
// click that OPENS the popup from immediately closing it again.

#[cfg(target_os = "macos")]
fn install_global_mouse_monitor(app: tauri::AppHandle) {
    use block::ConcreteBlock;
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    let app_clone = app.clone();

    // This closure becomes the ObjC block passed to NSEvent.
    // NSEvent retains the block, so it lives for the lifetime of the process.
    let handler = ConcreteBlock::new(move |_event: *mut Object| {
        let ts      = app_clone.state::<TrayState>();
        let elapsed = now_ms() - ts.last_shown_ms.load(Ordering::Relaxed);
        if elapsed < 300 {
            // This is the same mouse-down that triggered the tray-icon show;
            // don't close the popup we just opened.
            return;
        }
        if let Some(w) = app_clone.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) {
                w.hide().ok();
            }
        }
    })
    .copy(); // copies closure to a heap-allocated ObjC block (RcBlock)

    unsafe {
        // NSEventMaskLeftMouseDown (1<<1) | NSEventMaskRightMouseDown (1<<3)
        let mask: u64 = (1 << 1) | (1 << 3);
        // NSEvent retains `handler`; our Rust RcBlock can drop freely after this.
        let _: *mut Object = msg_send![
            class!(NSEvent),
            addGlobalMonitorForEventsMatchingMask: mask
            handler: handler
        ];
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn set_tray_status(app: tauri::AppHandle, tray_state: State<TrayState>, status: String) {
    let mut current = tray_state.icon_name.lock().unwrap();
    if *current == status { return; }
    *current = status.clone();
    drop(current);
    if let Some(tray) = app.tray_by_id("main") {
        if let Some(icon) = load_tray_icon(&app, &status) {
            tray.set_icon(Some(icon)).ok();
        }
    }
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
    window.hide().ok();
}

/// Open a worktree in the app that hosts its Claude session.
/// host: "vscode" | "iterm" | "terminal" | "app" | "tmux" | (unknown → VS Code)
#[tauri::command]
fn open_worktree(worktree_path: String, host: Option<String>) {
    let host = host.unwrap_or_default();
    std::thread::spawn(move || {
        match host.as_str() {
            // Claude Code desktop app — bring it to the front (can't deep-link a session).
            "app" => {
                let ok = Command::new("/usr/bin/open")
                    .args(["-b", "com.anthropic.claudefordesktop"]).spawn().is_ok();
                if !ok {
                    Command::new("/usr/bin/open").args(["-a", "Claude"]).spawn().ok();
                }
            }
            "iterm"    => { Command::new("/usr/bin/open").args(["-a", "iTerm"]).spawn().ok(); }
            "terminal" => { Command::new("/usr/bin/open").args(["-a", "Terminal"]).spawn().ok(); }
            // vscode + tmux/unknown → focus the folder's VS Code window (best default).
            _ => open_in_vscode(&worktree_path),
        }
    });
}

/// Activate VS Code and open/focus the window for a folder.
fn open_in_vscode(worktree_path: &str) {
    Command::new("/usr/bin/osascript")
        .args(["-e", "tell application \"Visual Studio Code\" to activate"])
        .spawn().ok();
    let bundled = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
    if Path::new(bundled).exists() {
        Command::new(bundled).arg(worktree_path).spawn().ok();
    } else {
        Command::new("/usr/bin/open").args(["-a", "Visual Studio Code", worktree_path]).spawn().ok();
    }
}

#[tauri::command]
fn focus_vscode(worktree_path: String) {
    std::thread::spawn(move || {
        Command::new("/usr/bin/osascript")
            .args(["-e", "tell application \"Visual Studio Code\" to activate"])
            .spawn().ok();
        let bundled = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
        if Path::new(bundled).exists() {
            Command::new(bundled).arg(&worktree_path).spawn().ok();
        } else {
            Command::new("/usr/bin/open")
                .args(["-a", "Visual Studio Code", &worktree_path])
                .spawn().ok();
        }
    });
}

// ── Prompt queue ─────────────────────────────────────────────────────────────
//
// Persisted to ~/.worktree-dash/prompt-queue.json.
// The user queues ideas while Claude is busy; copies them when ready.

#[derive(Clone, Serialize, Deserialize)]
struct QueueItem {
    id:   String,
    text: String,
    ts:   i64,
    /// Worktree (cwd) this idea is parked against. None = general/unassigned.
    #[serde(default)]
    cwd:  Option<String>,
}

fn queue_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home)
        .join(".worktree-dash")
        .join("prompt-queue.json")
}

fn read_queue() -> Vec<QueueItem> {
    let p = queue_path();
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_queue(items: &[QueueItem]) {
    let p = queue_path();
    if let Some(dir) = p.parent() { std::fs::create_dir_all(dir).ok(); }
    if let Ok(json) = serde_json::to_string_pretty(items) {
        std::fs::write(&p, json).ok();
    }
}

#[tauri::command]
fn get_queue() -> Vec<QueueItem> {
    read_queue()
}

#[tauri::command]
fn add_to_queue(text: String, cwd: Option<String>) -> Vec<QueueItem> {
    let mut items = read_queue();
    let trimmed = text.trim().to_string();
    if !trimmed.is_empty() {
        items.push(QueueItem {
            id:   uuid::Uuid::new_v4().to_string(),
            text: trimmed,
            ts:   now_ms(),
            cwd,
        });
        save_queue(&items);
    }
    items
}

#[tauri::command]
fn remove_from_queue(id: String) -> Vec<QueueItem> {
    let mut items = read_queue();
    items.retain(|item| item.id != id);
    save_queue(&items);
    items
}

// ── PTY commands (retained for future use) ────────────────────────────────

#[tauri::command]
fn create_terminal(app: tauri::AppHandle, state: State<PtyManager>, worktree_path: String, cols: u16, rows: u16) -> Result<String, String> {
    state.create(app, worktree_path, cols, rows)
}
#[tauri::command]
fn write_terminal(state: State<PtyManager>, terminal_id: String, data: String) -> Result<(), String> {
    state.write(&terminal_id, &data)
}
#[tauri::command]
fn resize_terminal(state: State<PtyManager>, terminal_id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(&terminal_id, cols, rows)
}
#[tauri::command]
fn kill_terminal(state: State<PtyManager>, terminal_id: String) { state.kill(&terminal_id); }

#[derive(Serialize)]
struct TerminalInfo { terminal_id: String, worktree_path: String }
#[tauri::command]
fn list_terminals(state: State<PtyManager>) -> Vec<TerminalInfo> {
    state.list().into_iter().map(|(tid, wp)| TerminalInfo { terminal_id: tid, worktree_path: wp }).collect()
}

// ── Auto-start the Node server ───────────────────────────────────────────────
//
// The pill/popup talk to the Node server over SSE (localhost:3444). Rather than
// make the user run `npm start` in a separate terminal, we launch it here on
// startup and kill it on quit. If the port is already up (they started it
// manually), we leave that instance alone.
//
// macOS GUI apps don't inherit the shell PATH, so `node` (esp. via nvm) isn't
// found by default. We resolve it through a login shell, then fall back to
// common install locations, and finally to a `nodeBin` override in config.

struct ServerProcess(Mutex<Option<std::process::Child>>);

fn dash_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    std::path::PathBuf::from(home).join(".worktree-dash")
}

/// Read a string field from ~/.worktree-dash/config.json (optional overrides).
fn config_string(key: &str) -> Option<String> {
    let raw = std::fs::read_to_string(dash_dir().join("config.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get(key)?.as_str().map(|s| s.to_string())
}

fn expand_home(p: &str) -> std::path::PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join(rest);
        }
    }
    std::path::PathBuf::from(p)
}

/// Is something already listening on the port?
fn port_open(port: u16) -> bool {
    if let Ok(addr) = format!("127.0.0.1:{port}").parse::<std::net::SocketAddr>() {
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
    } else {
        false
    }
}

/// Best-effort resolution of the `node` binary for a GUI (no shell PATH).
fn resolve_node() -> Option<String> {
    if let Some(n) = config_string("nodeBin") {
        if !n.is_empty() { return Some(n); }
    }
    for shell in ["zsh", "bash"] {
        if let Ok(out) = Command::new(shell).args(["-lic", "command -v node"]).output() {
            let p = String::from_utf8_lossy(&out.stdout)
                .lines().last().unwrap_or("").trim().to_string();
            if !p.is_empty() && std::path::Path::new(&p).exists() { return Some(p); }
        }
    }
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if std::path::Path::new(p).exists() { return Some(p.to_string()); }
    }
    None
}

/// Server directory: config `serverDir`, else the default repo location.
fn server_dir() -> std::path::PathBuf {
    if let Some(d) = config_string("serverDir") {
        if !d.is_empty() { return expand_home(&d); }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    std::path::PathBuf::from(home).join("Documents/personal/worktree-dash/server")
}

/// Launch the Node server unless it's already running on :3444.
fn start_server(app: &tauri::AppHandle) {
    if port_open(3444) {
        eprintln!("[maestro] server already running on :3444 — not spawning");
        return;
    }
    let dir   = server_dir();
    let entry = dir.join("dist/http-server.js");
    if !entry.exists() {
        eprintln!("[maestro] server not built at {} — run `npm run build` in server/", entry.display());
        return;
    }
    let node = match resolve_node() {
        Some(n) => n,
        None => {
            eprintln!("[maestro] could not find node — set \"nodeBin\" in ~/.worktree-dash/config.json");
            return;
        }
    };

    std::fs::create_dir_all(dash_dir()).ok();
    let (out, err) = match std::fs::File::create(dash_dir().join("server.log")) {
        Ok(f) => {
            let f2 = f.try_clone();
            (std::process::Stdio::from(f),
             f2.map(std::process::Stdio::from).unwrap_or_else(|_| std::process::Stdio::null()))
        }
        Err(_) => (std::process::Stdio::null(), std::process::Stdio::null()),
    };

    match Command::new(&node).arg(&entry).current_dir(&dir).stdout(out).stderr(err).spawn() {
        Ok(child) => {
            eprintln!("[maestro] started server: {} {}", node, entry.display());
            if let Some(state) = app.try_state::<ServerProcess>() {
                *state.0.lock().unwrap() = Some(child);
            }
        }
        Err(e) => eprintln!("[maestro] failed to start server: {e}"),
    }
}

// ── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                position_popover_fallback(&w);
                w.show().ok();
                w.set_focus().ok();
            }
        }))
        .manage(PtyManager::default())
        .manage(TrayState::default())
        .manage(ServerProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            set_tray_status,
            hide_window,
            focus_vscode,
            open_worktree,
            get_screen,
            play_sound,
            get_queue,
            add_to_queue,
            remove_from_queue,
            create_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            list_terminals,
        ])
        .setup(|app| {
            // ── Launch the Node server (idempotent, off-thread) ──────────
            // Off-thread so shell/PATH resolution can't block the UI coming up.
            {
                let h = app.handle().clone();
                std::thread::spawn(move || start_server(&h));
            }

            // ── Tray icon ────────────────────────────────────────────────
            let icon = load_tray_icon(app.handle(), "idle")
                .or_else(|| app.default_window_icon().cloned())
                .expect("no tray icon — add icons/tray-idle.png");

            // Right-click context menu: Quit
            let quit_item = MenuItem::with_id(app, "quit", "Quit Maestro", true, None::<&str>)?;
            let menu      = Menu::with_items(app, &[&quit_item])?;

            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Maestro")
                .menu(&menu)
                .menu_on_left_click(false) // left click = toggle popup; right click = menu
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                w.hide().ok();
                            } else {
                                position_below_tray(&w, &rect);
                                // Record the show time so the global mouse monitor
                                // ignores this same click event (300 ms guard).
                                app.state::<TrayState>()
                                    .last_shown_ms
                                    .store(now_ms(), Ordering::Relaxed);
                                w.show().ok();
                                w.set_focus().ok();
                            }
                        }
                    }
                })
                .build(app)?;

            // ── macOS: install global click-outside monitor ──────────────
            #[cfg(target_os = "macos")]
            install_global_mouse_monitor(app.handle().clone());

            // ── Position + show the always-on HUD pill ───────────────────
            if let Some(hud) = app.get_webview_window("hud") {
                position_hud(&hud);
                // Show on every Space/desktop, not just the one it was born on.
                hud.set_visible_on_all_workspaces(true).ok();
                hud.show().ok();
            }

            // ── Hide from Dock — menu-bar only ───────────────────────────
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the tray popup auto-hides on blur. The HUD is always visible,
            // so it must never hide on focus loss.
            if window.label() == "main" {
                if let tauri::WindowEvent::Focused(false) = event {
                    window.hide().ok();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building Maestro")
        .run(|handle, event| {
            // Kill the server we spawned when Maestro exits.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = handle.try_state::<ServerProcess>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
