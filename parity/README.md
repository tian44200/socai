# parity/

**Agents**: read [AGENTS.md](./AGENTS.md) before running any parity command.

## Phase 1 smoke test

Preferred runner:

```bash
scripts/run_parity.sh phase1
scripts/run_parity.sh extract_note
scripts/run_parity.sh all
```

The two `*xhs_extractor*` scripts inject the same `page_scripts.js` and call
the same XHS function, so we can confirm the Rust foundation (chromiumoxide
+ evaluate_json + IIFE wrap) produces the same shape Python does:

```bash
mkdir -p parity/phase1_smoke
cargo run --example eval_xhs_extractor -p socai-browser -- \
    https://www.xiaohongshu.com pageState > parity/phase1_smoke/rust.json
uv run python scripts/run_xhs_extractor.py \
    https://www.xiaohongshu.com pageState > parity/phase1_smoke/python.json

diff <(jq -S . parity/phase1_smoke/rust.json) \
     <(jq -S . parity/phase1_smoke/python.json)
```

Expect zero diff for stable fields. Live-UI fields (`card_count`,
feed listings, comment counts) can drift between runs and are not bugs.
Functions that observe a list of items (`searchCards`, `comments`) belong
in per-tool parity fixtures under Phase 2, not at this layer.

---


Fixtures and snapshot inputs for the Python → Rust migration. Each Rust port of
a tool drops a fixture here that pins the Python output for the same input, so
the Rust version can be asserted byte- or schema-equal during the dual-run
window.

Layout per fixture:

```
parity/<tool_name>/
  ├── input.json        # args passed to the tool
  ├── expected.json     # captured Python output (truth oracle)
  └── notes.md          # any caveats (volatile fields, time-sensitive data)
```

Captures should be regenerated when the upstream site changes shape, not when
the Rust impl diverges — the whole point is to catch divergence.
