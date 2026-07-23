/// pty_manager.rs — manages PTY sessions using portable-pty.
///
/// Each session spawns a shell in a worktree directory. A reader thread
/// continuously reads PTY output and emits Tauri events to the frontend.
/// Write/resize/kill are handled via the master PTY handle.
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

// ── Event payloads ─────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct TerminalExit {
    pub terminal_id: String,
    pub code: i32,
}

// ── Session ────────────────────────────────────────────────────────────────

struct Session {
    terminal_id:   String,
    worktree_path: String,
    writer:        Box<dyn Write + Send>,
    master:        Box<dyn MasterPty + Send>,
}

// ── Manager ────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
}

impl PtyManager {
    pub fn create(
        &self,
        app: AppHandle,
        worktree_path: String,
        cols: u16,
        rows: u16,
    ) -> Result<String, String> {
        let path = PathBuf::from(&worktree_path);
        if !path.exists() {
            return Err(format!("Directory not found: {worktree_path}"));
        }

        let terminal_id = Uuid::new_v4().to_string();

        // Resolve the user's shell
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        // Open a PTY pair
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        // Build the shell command
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&worktree_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "worktree-dash");
        // Propagate essential env vars
        for key in &["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "SSH_AUTH_SOCK"] {
            if let Ok(val) = std::env::var(key) {
                cmd.env(key, val);
            }
        }

        // Spawn shell in the slave PTY
        let _child = pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {e}"))?;

        // Clone a reader for the background thread
        let mut reader = pair.master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

        let writer = pair.master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

        // Reader thread: stream PTY output → Tauri events.
        //
        // IMPORTANT: PTY bytes arrive in arbitrary chunks. Multi-byte UTF-8
        // sequences (like box-drawing chars: ─ = 0xE2 0x94 0x80) can be split
        // across reads. `from_utf8_lossy` on a partial sequence emits U+FFFD,
        // causing the "─???─" corruption the user sees.
        //
        // Fix: keep a carry buffer. Each iteration appends new bytes, then
        // emits only the valid UTF-8 prefix, leaving any trailing incomplete
        // sequence in the carry buffer for the next read.
        let tid = terminal_id.clone();
        let app_handle = app.clone();
        thread::spawn(move || {
            let mut buf    = [0u8; 4096];
            let mut carry: Vec<u8> = Vec::with_capacity(8);

            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        let _ = app_handle.emit("terminal-exit", TerminalExit {
                            terminal_id: tid.clone(),
                            code: 0,
                        });
                        break;
                    }
                    Ok(n) => {
                        carry.extend_from_slice(&buf[..n]);

                        // Find the largest valid UTF-8 prefix
                        let valid_end = match std::str::from_utf8(&carry) {
                            Ok(_)  => carry.len(),
                            Err(e) => e.valid_up_to(),
                        };

                        if valid_end > 0 {
                            // SAFETY: valid_end is guaranteed to be a valid UTF-8 boundary
                            let data = unsafe {
                                String::from_utf8_unchecked(carry[..valid_end].to_vec())
                            };
                            let _ = app_handle.emit("terminal-output", TerminalOutput {
                                terminal_id: tid.clone(),
                                data,
                            });
                            carry.drain(..valid_end);
                        }
                        // Any leftover bytes in carry are an incomplete sequence —
                        // they'll be completed on the next read.
                    }
                }
            }
        });

        let session = Session {
            terminal_id: terminal_id.clone(),
            worktree_path,
            writer,
            master: pair.master,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(terminal_id.clone(), session);

        Ok(terminal_id)
    }

    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {terminal_id}"))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write error: {e}"))
    }

    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {terminal_id}"))?;
        session
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Resize error: {e}"))
    }

    pub fn kill(&self, terminal_id: &str) {
        self.sessions.lock().unwrap().remove(terminal_id);
        // Dropping the session closes the master PTY, which signals the reader thread to exit
    }

    #[allow(dead_code)]
    pub fn kill_all(&self) {
        self.sessions.lock().unwrap().clear();
    }

    pub fn list(&self) -> Vec<(String, String)> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| (s.terminal_id.clone(), s.worktree_path.clone()))
            .collect()
    }
}
