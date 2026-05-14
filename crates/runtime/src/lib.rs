use socai_browser::{
    BrowserEvent, Cdp, PageSession, StatusPayload, TargetInfo, TaskSessionManager,
};
use tokio::sync::broadcast;

pub use socai_browser::{
    BrowserEvent as RuntimeBrowserEvent, StatusPayload as BrowserStatus,
    TargetInfo as BrowserTargetInfo,
};

/// Shared in-process runtime handle for Tauri, TUI, and the CLI. Owns the
/// browser session state and exposes the same task surface to every
/// entrypoint. Site-specific composition (XHS, etc.) lives in the callers,
/// not here.
#[derive(Clone)]
pub struct SocaiRuntime {
    cdp: Cdp,
}

impl SocaiRuntime {
    pub fn new() -> Self {
        Self { cdp: Cdp::new() }
    }

    pub fn browser(&self) -> Cdp {
        self.cdp.clone()
    }

    pub fn subscribe_browser_events(&self) -> broadcast::Receiver<BrowserEvent> {
        self.cdp.subscribe()
    }

    pub fn connect_browser(&self) {
        self.cdp.connect();
    }

    pub async fn disconnect_browser(&self) {
        self.cdp.disconnect().await;
    }

    pub async fn browser_status(&self) -> StatusPayload {
        self.cdp.status().await
    }

    pub async fn browser_pages(&self) -> Vec<TargetInfo> {
        self.cdp.pages().await
    }

    pub async fn wait_browser_connected(&self) -> anyhow::Result<()> {
        self.cdp.wait_connected().await
    }

    pub fn task_sessions(&self) -> TaskSessionManager {
        TaskSessionManager::new(self.cdp.clone())
    }

    pub async fn create_task(&self, start_url: &str) -> anyhow::Result<PageSession> {
        self.task_sessions().create_task(start_url).await
    }
}

impl Default for SocaiRuntime {
    fn default() -> Self {
        Self::new()
    }
}
