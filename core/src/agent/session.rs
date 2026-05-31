//! Chat session: a persistent multi-turn conversation built on top of runs.
//!
//! Each session is one folder under `~/.socai/sessions/<id>/` (override with
//! `SOCAI_SESSIONS_DIR`) holding `session.json` — the structured turns
//! (user / assistant / run pointers), which is also the seed source.
//!
//! Run-dir granularity is unchanged: every user turn still produces its own
//! run dir. The session only records *pointers* to those run dirs plus the
//! chat-level text, so the agent can refer back to earlier artifacts (via the
//! local environment tools) without bloating the seed.
//!
//! This lives in core so any entrypoint (TUI today, desktop later) can reuse
//! it. Nothing constructs a `Session` implicitly — entrypoints opt in.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::agent::llm::{Block, Message};

#[derive(Serialize, Deserialize, Clone)]
pub struct Turn {
    pub user: String,
    pub assistant: String,
    pub run_id: String,
    pub run_dir: String,
    pub ts_ms: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    #[serde(skip)]
    pub dir: PathBuf,
    pub model: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub turns: Vec<Turn>,
}

impl Session {
    /// Create a fresh session folder and persist its (empty) index.
    pub fn new(model: Option<String>) -> std::io::Result<Self> {
        let now = now_ms();
        let id = format!("session-{now}");
        let dir = default_sessions_root().join(&id);
        std::fs::create_dir_all(&dir)?;
        let session = Self {
            id,
            dir,
            model,
            created_at_ms: now,
            updated_at_ms: now,
            turns: Vec::new(),
        };
        session.persist();
        Ok(session)
    }

    /// Record a completed turn and flush to disk.
    pub fn record_turn(&mut self, user: &str, assistant: &str, run_id: &str, run_dir: &Path) {
        self.turns.push(Turn {
            user: user.to_string(),
            assistant: assistant.to_string(),
            run_id: run_id.to_string(),
            run_dir: run_dir.to_string_lossy().to_string(),
            ts_ms: now_ms(),
        });
        self.updated_at_ms = now_ms();
        self.persist();
    }

    /// Chat-level seed messages (prior user inputs + assistant answers) used to
    /// continue the conversation on the next turn.
    pub fn chat_messages(&self) -> Vec<Message> {
        let mut out = Vec::with_capacity(self.turns.len() * 2);
        for turn in &self.turns {
            out.push(Message::user(turn.user.clone()));
            out.push(Message::assistant_blocks(vec![Block::Text {
                text: turn.assistant.clone(),
            }]));
        }
        out
    }

    /// A short note for the agent instructions so it knows which run dirs
    /// belong to this session and can read their artifacts on demand.
    pub fn context_note(&self) -> String {
        if self.turns.is_empty() {
            return format!(
                "This is an ongoing chat session. Session dir: {}. \
                 Use the local environment tools (read_file, bash) when the user asks \
                 to inspect earlier results or produce output files.",
                self.dir.display()
            );
        }
        let mut lines = vec![format!(
            "This is an ongoing chat session (session dir: {}). Earlier turns saved \
             artifacts under these run dirs — inspect them with read_file/bash when \
             the user refers back to them:",
            self.dir.display()
        )];
        for (i, turn) in self.turns.iter().enumerate() {
            lines.push(format!(
                "  {}. {} — {}",
                i + 1,
                turn.run_dir,
                preview(&turn.user)
            ));
        }
        lines.join("\n")
    }

    fn persist(&self) {
        if let Ok(text) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(self.dir.join("session.json"), text);
        }
    }
}

/// Root directory for chat sessions: `$SOCAI_SESSIONS_DIR` or
/// `~/.socai/sessions`. Mirrors [`crate::agent::run_logging::default_runs_root`].
pub fn default_sessions_root() -> PathBuf {
    if let Ok(env) = std::env::var("SOCAI_SESSIONS_DIR") {
        return PathBuf::from(env);
    }
    if let Some(home) = dirs::home_dir() {
        return home.join(".socai/sessions");
    }
    PathBuf::from(".socai/sessions")
}

fn preview(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or("").trim();
    if line.chars().count() > 60 {
        let s: String = line.chars().take(60).collect();
        format!("{s}…")
    } else {
        line.to_string()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
