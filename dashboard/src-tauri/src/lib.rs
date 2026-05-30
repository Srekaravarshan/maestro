mod pty_manager;
use pty_manager::PtyManager;
use serde::Serialize;
use tauri::State;
use std::process::Command;
use std::path::Path;

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Focus VS Code on the given worktree path — no HTTP roundtrip, runs native.
/// Phase 1: osascript activate (~50ms, VS Code appears immediately)
/// Phase 2: code CLI switches to the specific folder via IPC
#[tauri::command]
fn focus_vscode(worktree_path: String) {
    std::thread::spawn(move || {
        // Phase 1 — snap VS Code to front NOW
        Command::new("/usr/bin/osascript")
            .args(["-e", "tell application \"Visual Studio Code\" to activate"])
            .spawn().ok();

        // Phase 2 — switch to the right folder
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

/// Spawn a new shell in the given worktree directory.
/// Returns the terminal_id to use in subsequent calls.
#[tauri::command]
fn create_terminal(
    app: tauri::AppHandle,
    state: State<PtyManager>,
    worktree_path: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    state.create(app, worktree_path, cols, rows)
}

/// Send raw input bytes to a running terminal.
#[tauri::command]
fn write_terminal(
    state: State<PtyManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    state.write(&terminal_id, &data)
}

/// Notify the terminal of a window resize.
#[tauri::command]
fn resize_terminal(
    state: State<PtyManager>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&terminal_id, cols, rows)
}

/// Kill a terminal session.
#[tauri::command]
fn kill_terminal(state: State<PtyManager>, terminal_id: String) {
    state.kill(&terminal_id);
}

/// List all active terminal sessions.
#[derive(Serialize)]
struct TerminalInfo {
    terminal_id: String,
    worktree_path: String,
}

#[tauri::command]
fn list_terminals(state: State<PtyManager>) -> Vec<TerminalInfo> {
    state
        .list()
        .into_iter()
        .map(|(terminal_id, worktree_path)| TerminalInfo { terminal_id, worktree_path })
        .collect()
}

// ── App entry ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            focus_vscode,
            create_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            list_terminals,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // PTY sessions are dropped automatically when the app exits
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running worktree-dash");
}
