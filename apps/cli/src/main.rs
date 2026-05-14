use clap::{Parser, Subcommand};
use socai_runtime::SocaiRuntime;
use socai_sites::xhs::{XhsSiteRuntime, XHS_HOME_URL};

#[derive(Debug, Parser)]
#[command(name = "socai")]
#[command(about = "socai Rust runtime CLI")]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    BrowserStatus,
    ExtractNote {
        url: String,
        #[arg(long, default_value_t = 8.0)]
        wait_seconds: f64,
    },
    SearchNotes {
        query: String,
        #[arg(long, default_value_t = 2.0)]
        wait_seconds: f64,
    },
    PageState {
        #[arg(default_value = XHS_HOME_URL)]
        url: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let runtime = SocaiRuntime::new();
    runtime.connect_browser();
    runtime.wait_browser_connected().await?;

    match args.command {
        Command::BrowserStatus => {
            println!(
                "{}",
                serde_json::to_string_pretty(&runtime.browser_status().await)?
            );
        }
        Command::ExtractNote { url, wait_seconds } => {
            let page = runtime.create_task("about:blank").await?;
            page.navigate_with_timeout(&url, 60.0).await?;
            let note = XhsSiteRuntime::new(&page).extract_note(wait_seconds).await;
            let close = page.close().await;
            let note = note?;
            close?;
            println!("{}", serde_json::to_string_pretty(&note)?);
        }
        Command::SearchNotes {
            query,
            wait_seconds,
        } => {
            // search_notes internally calls ensure_xhs(true), so we don't
            // pre-navigate here — opening an about:blank tab is enough.
            let page = runtime.create_task("about:blank").await?;
            let result = XhsSiteRuntime::new(&page)
                .search_notes(&query, wait_seconds)
                .await;
            let close = page.close().await;
            let result = result?;
            close?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::PageState { url } => {
            let page = runtime.create_task("about:blank").await?;
            page.navigate(&url).await?;
            let result = XhsSiteRuntime::new(&page).detect_state().await;
            let close = page.close().await;
            let result = result?;
            close?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }

    Ok(())
}
