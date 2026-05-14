"""Phase-1 parity smoke test (Python half).

Inject the same page_scripts.js bundle the Rust example uses and call the
same function. Output JSON on stdout so the two can be diffed:

    cargo run --example eval_xhs_extractor -p socai-browser -- <url> > rust.json
    uv run python scripts/run_xhs_extractor.py <url> > py.json
    diff <(jq -S . rust.json) <(jq -S . py.json)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from socai.browser.cdp import BrowserSession
from socai.browser.cdp.endpoint import discover_existing_chrome_endpoint
from socai.sites.xhs.runtime import xhs_page_script_call


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("function", nargs="?", default="pageState")
    parser.add_argument("arg_json", nargs="?", default="null")
    args = parser.parse_args()

    arg = None if args.arg_json == "null" else json.loads(args.arg_json)

    # Match the Rust example's discovery semantics: walk Chrome profile roots
    # for a live DevToolsActivePort, fall back to /json/version probes. The
    # public BrowserSession.connect() only accepts explicit endpoints/env
    # vars, so we resolve here and pass the result in.
    endpoint = discover_existing_chrome_endpoint()
    if endpoint is None:
        print(
            "No CDP endpoint discovered. Open Chrome with remote debugging "
            "(chrome://inspect/#remote-debugging → Allow) and rerun.",
            file=sys.stderr,
        )
        return 1
    browser = await BrowserSession.connect(endpoint=endpoint)
    try:
        created = await browser.send("Target.createTarget", {"url": "about:blank"})
        page = await browser.attach_page(str(created["targetId"]))
        await page.navigate(args.url, timeout=20.0)
        try:
            js = xhs_page_script_call(args.function, arg)
            value = await page.evaluate(js)
            print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))
        finally:
            await browser.close_page(page.target_id)
    finally:
        await browser.stop()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
