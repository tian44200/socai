use std::sync::Arc;

use chromiumoxide::Browser;

use crate::page::PageSession;
use crate::state::{Cdp, CdpState};

/// One CDP connection, one new tab per task. Mirrors Python's
/// `BrowserTaskSessionManager` minimum surface: caller creates tasks; the
/// returned `PageSession` is closed by the caller when the task ends.
pub struct TaskSessionManager {
    cdp: Cdp,
}

impl TaskSessionManager {
    pub fn new(cdp: Cdp) -> Self {
        Self { cdp }
    }

    /// Open a new tab navigated to `start_url`. Errors if the CDP connection
    /// is not in `Connected` state — callers should `cdp.wait_connected()`
    /// first (or surface the error to the user).
    pub async fn create_task(&self, start_url: &str) -> anyhow::Result<PageSession> {
        let browser = self.browser().await?;
        let page = browser.new_page(start_url).await?;
        Ok(PageSession::new(page))
    }

    async fn browser(&self) -> anyhow::Result<Arc<Browser>> {
        let state = self.cdp.state();
        let guard = state.lock().await;
        match &*guard {
            CdpState::Connected { browser, .. } => Ok(Arc::clone(browser)),
            _ => Err(anyhow::anyhow!("CDP not connected")),
        }
    }
}
