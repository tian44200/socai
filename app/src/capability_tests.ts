//! Capability panels shipped with the desktop app. The shell in `main.ts`
//! renders one universal task entrance; this file keeps the task state,
//! agent configuration, and low-level tool runners together.

import { invoke } from "@tauri-apps/api/core";
import type { AgentEventPayload, ModelInfo, ShellState } from "./main";

interface AgentOutcome {
  run_id: string;
  run_dir: string;
  turns: number;
  final_text: string;
  input_tokens: number;
  output_tokens: number;
}

export function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    return (
      { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" } as Record<string, string>
    )[c];
  });
}

// ── Agent task ─────────────────────────────────────────────────────────────

export namespace agentPanel {
  type TaskMode = "agent" | "tools";
  type ToolCommand = "search_notes" | "topic_scan" | "extract_note";

  let task = "";
  let mode: TaskMode = "agent";
  let toolCommand: ToolCommand = "search_notes";
  let model = "";
  let inFlight = false;
  let toolInFlight = false;
  let toolResult: unknown = null;
  let toolError = "";
  let events: AgentEventPayload[] = [];
  let outcome: AgentOutcome | null = null;
  let errorText = "";
  let modelsCache: ModelInfo[] = [];

  // Key-entry sub-state — used by the header configuration popover.
  let pendingKey = "";
  let savingKey = false;
  let keyError = "";
  let configOpen = false;

  export function setModels(models: ModelInfo[]): void {
    modelsCache = models;
    if (!model || !models.some((m) => m.default_model === model)) {
      const withKey = models.find((m) => m.has_key);
      model = (withKey ?? models[0])?.default_model ?? "";
    }
  }

  export function renderHeader(): string {
    return `
      <div class="agent-status">
        ${renderAgentBadge()}
        ${configOpen ? renderConfigPopover() : ""}
      </div>
    `;
  }

  export function bindHeader(shell: ShellState): void {
    document.getElementById("agent-config-toggle")?.addEventListener("click", () => {
      configOpen = !configOpen;
      shell.rerender();
    });

    const modelEl = document.getElementById("agent-header-model") as HTMLSelectElement | null;
    modelEl?.addEventListener("change", () => {
      model = modelEl.value;
      keyError = "";
      pendingKey = "";
      shell.rerender();
    });

    const keyInput = document.getElementById("agent-header-key-input") as HTMLInputElement | null;
    keyInput?.addEventListener("input", () => { pendingKey = keyInput.value; });

    const saveBtn = document.getElementById("agent-header-key-save") as HTMLButtonElement | null;
    saveBtn?.addEventListener("click", async () => {
      const provider = saveBtn.dataset.provider;
      const key = pendingKey.trim();
      if (!provider || !key || savingKey) return;
      savingKey = true;
      keyError = "";
      shell.rerender();
      try {
        await invoke("agent_save_api_key", { provider, apiKey: key });
        setModels(await invoke<ModelInfo[]>("agent_list_models"));
        pendingKey = "";
      } catch (err) {
        keyError = `${err}`;
      } finally {
        savingKey = false;
        shell.rerender();
      }
    });
  }

  export function closeHeaderConfig(): boolean {
    if (!configOpen) return false;
    configOpen = false;
    return true;
  }

  function renderAgentBadge(): string {
    const selected = selectedModel();
    const expanded = configOpen ? "true" : "false";
    if (!selected) {
      return `<button id="agent-config-toggle" type="button" class="badge badge-button" aria-expanded="${expanded}"><i class="badge-dot badge-dot-muted" aria-hidden="true"></i>agent · loading</button>`;
    }
    if (!selected.has_key) {
      return `<button id="agent-config-toggle" type="button" class="badge badge-button" aria-expanded="${expanded}"><i class="badge-dot badge-dot-hollow" aria-hidden="true"></i>agent · ${esc(selected.display_name)} · key needed</button>`;
    }
    return `<button id="agent-config-toggle" type="button" class="badge badge-button" aria-expanded="${expanded}"><i class="badge-dot badge-dot-ink" aria-hidden="true"></i>agent · ${esc(selected.display_name)}</button>`;
  }

  function renderConfigPopover(): string {
    const selected = selectedModel();
    const modelOpts = modelsCache
      .map((m) => {
        const sel = model === m.default_model ? "selected" : "";
        const flag = m.has_key ? "" : " · no key";
        return `<option value="${esc(m.default_model)}" ${sel}>${esc(m.display_name)} — ${esc(m.default_model)}${flag}</option>`;
      })
      .join("");

    return `
      <div class="topbar-popover agent-config-popover" role="dialog" aria-label="agent configuration">
        <p class="t-eyebrow agent-config-title">agent</p>
        <label class="agent-config-field">
          <span class="t-small">model</span>
          <select id="agent-header-model" class="input-field" ${savingKey || inFlight ? "disabled" : ""}>
            ${modelOpts || `<option value="">loading…</option>`}
          </select>
        </label>
        ${
          selected
            ? `<p class="t-small subtle">${esc(selected.display_name)} · <span class="t-mono">${esc(selected.default_model)}</span></p>`
            : `<p class="t-small subtle">loading available models…</p>`
        }
        ${selected ? selected.has_key ? `<p class="t-small subtle">api key configured.</p>` : renderHeaderKeyEntry(selected) : ""}
      </div>
    `;
  }

  function renderHeaderKeyEntry(selected: ModelInfo): string {
    return `
      <div class="agent-config-key">
        <p class="t-small subtle">${esc(selected.display_name)} needs an API key.</p>
        <input
          id="agent-header-key-input"
          class="input-field"
          type="password"
          placeholder="paste api key"
          value="${esc(pendingKey)}"
          autocomplete="off"
          ${savingKey ? "disabled" : ""}
        />
        <div class="agent-config-actions">
          <button id="agent-header-key-save" type="button" data-provider="${esc(selected.provider)}" class="btn-primary btn-compact" ${savingKey ? "disabled" : ""}>
            ${savingKey ? "saving…" : "save"}
          </button>
          ${keyError ? `<span class="t-small result-error">${esc(keyError)}</span>` : ""}
        </div>
      </div>
    `;
  }

  function selectedModel(): ModelInfo | undefined {
    return modelsCache.find((m) => m.default_model === model);
  }

  /// Append a streamed event AND incrementally update the DOM so we don't
  /// re-render the entire page on every chunk. Pins scroll-to-bottom.
  export function appendEvent(payload: AgentEventPayload): void {
    events = [...events, payload];

    const stream = document.querySelector<HTMLDivElement>("[data-agent-events]");
    if (!stream) return;

    const placeholder = stream.querySelector("[data-events-placeholder]");
    if (placeholder) placeholder.remove();

    stream.insertAdjacentHTML("beforeend", renderAgentEvent(payload));
    stream.scrollTop = stream.scrollHeight;
  }

  export function render(shell: ShellState): string {
    const connected = shell.status.state === "connected";
    const selected = selectedModel();
    const modelReady = !!selected && selected.has_key;
    const agentMode = mode === "agent";
    const running = agentMode ? inFlight : toolInFlight;
    const runDisabled = running || !connected || (agentMode && !modelReady);
    const guard = renderTaskGuard(connected, selected);

    return `
      <div class="task-interface">
        <form id="task-form" class="task-form">
          <textarea
            id="task-input"
            class="task-input"
            rows="5"
            placeholder="${esc(taskPlaceholder())}"
            ${running ? "disabled" : ""}
          >${esc(task)}</textarea>

          <div class="task-controls">
            <div class="mode-switch" aria-label="task mode">
              <button id="mode-agent" type="button" class="mode-button ${agentMode ? "mode-button-active" : ""}">agent mode</button>
              <button id="mode-tools" type="button" class="mode-button ${!agentMode ? "mode-button-active" : ""}">dedicated tools</button>
            </div>
            ${agentMode ? renderAgentSummary(selected) : renderToolPicker()}
            <button type="submit" class="btn-primary" ${runDisabled ? "disabled" : ""}>
              ${running ? "running…" : agentMode ? "run task" : "run tool"}
            </button>
          </div>
        </form>

        ${guard}
        ${agentMode ? renderAgentResult() : renderToolResult()}
      </div>
    `;
  }

  function renderTaskGuard(connected: boolean, selected: ModelInfo | undefined): string {
    if (!connected) return `<p class="t-small subtle">connect chrome first.</p>`;
    if (mode !== "agent") return renderToolHint();
    if (!selected) return `<p class="t-small subtle">loading agent models…</p>`;
    if (!selected.has_key) return `<p class="t-small subtle">configure the agent in the header first.</p>`;
    return `<p class="t-small subtle">socai will decide which browser steps and tools to use.</p>`;
  }

  function renderAgentSummary(selected: ModelInfo | undefined): string {
    const summary = selected
      ? `agent · ${esc(selected.display_name)} · <span class="t-mono">${esc(selected.default_model)}</span>`
      : "agent · loading";
    return `<p class="t-small subtle task-context">${summary}</p>`;
  }

  function renderToolPicker(): string {
    const tools: Array<[ToolCommand, string]> = [
      ["search_notes", "search notes"],
      ["topic_scan", "topic scan"],
      ["extract_note", "extract note"],
    ];
    return `
      <div class="tool-picker" aria-label="tool">
        ${tools.map(([cmd, label]) => `
          <button type="button" data-tool="${cmd}" class="tool-choice ${toolCommand === cmd ? "tool-choice-active" : ""}">
            ${label}
          </button>
        `).join("")}
      </div>
    `;
  }

  function renderToolHint(): string {
    switch (toolCommand) {
      case "search_notes":
        return `<p class="t-small subtle">search xiaohongshu notes for the query above.</p>`;
      case "topic_scan":
        return `<p class="t-small subtle">run a structured topic scan for the query above.</p>`;
      case "extract_note":
        return `<p class="t-small subtle">paste a note id above to extract the note.</p>`;
    }
  }

  function taskPlaceholder(): string {
    if (mode === "agent") return "tell socai what you want researched…";
    switch (toolCommand) {
      case "search_notes": return "search query…";
      case "topic_scan": return "topic to scan…";
      case "extract_note": return "note_id…";
    }
  }

  function renderAgentResult(): string {
    return `
      <p class="t-eyebrow result-label">result</p>
      <div class="result-block">
        ${
          errorText
            ? `<pre class="result-pre result-error">${esc(errorText)}</pre>`
            : `<div class="event-stream" data-agent-events>${
                events.length === 0
                  ? `<p class="t-small placeholder" data-events-placeholder>no run yet.</p>`
                  : events.map(renderAgentEvent).join("")
              }</div>`
        }
      </div>

      ${
        outcome
          ? `
        <div class="agent-outcome">
          <p class="t-eyebrow result-label">final answer</p>
          <pre class="result-pre">${esc(outcome.final_text.trim())}</pre>
          <p class="t-small subtle">run ${esc(outcome.run_id)} · ${outcome.turns} turns · in ${outcome.input_tokens} / out ${outcome.output_tokens} tokens</p>
          <p class="t-small subtle">run_dir: <span class="t-mono">${esc(outcome.run_dir)}</span></p>
        </div>`
          : ""
      }
    `;
  }

  function renderToolResult(): string {
    if (toolInFlight) {
      return `<pre class="result-pre result-running">running: ${esc(toolCommand)}(${esc(JSON.stringify(task.trim()))})</pre>`;
    }
    if (toolError) {
      return `<pre class="result-pre result-error">${esc(toolError)}</pre>`;
    }
    if (toolResult) {
      return `<pre class="result-pre">${esc(JSON.stringify(toolResult, null, 2))}</pre>`;
    }
    return `<p class="t-small placeholder">no tool result yet.</p>`;
  }

  export function bind(shell: ShellState): void {
    const taskEl = document.getElementById("task-input") as HTMLTextAreaElement | null;
    taskEl?.addEventListener("input", () => { task = taskEl.value; });

    document.getElementById("mode-agent")?.addEventListener("click", () => {
      mode = "agent";
      shell.rerender();
    });
    document.getElementById("mode-tools")?.addEventListener("click", () => {
      mode = "tools";
      shell.rerender();
    });
    document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        toolCommand = btn.dataset.tool as ToolCommand;
        toolError = "";
        toolResult = null;
        shell.rerender();
      });
    });

    document.getElementById("task-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (mode === "agent") await runAgentTask(shell);
      else await runDedicatedTool(shell);
    });
  }

  async function runAgentTask(shell: ShellState): Promise<void> {
    const t = task.trim();
    if (!t || inFlight) return;
    inFlight = true;
    events = [];
    outcome = null;
    errorText = "";
    shell.rerender();
    try {
      outcome = await invoke<AgentOutcome>("agent_run", {
        task: t,
        model: model || null,
      });
    } catch (err) {
      errorText = `${err}`;
    } finally {
      inFlight = false;
      shell.rerender();
    }
  }

  async function runDedicatedTool(shell: ShellState): Promise<void> {
    const value = task.trim();
    if (!value || toolInFlight) return;
    toolInFlight = true;
    toolError = "";
    toolResult = null;
    shell.rerender();
    try {
      if (toolCommand === "extract_note") {
        toolResult = await invoke("tool_extract_note", { noteId: value });
      } else if (toolCommand === "topic_scan") {
        toolResult = await invoke("tool_topic_scan", { query: value });
      } else {
        toolResult = await invoke("tool_search_notes", { query: value });
      }
    } catch (err) {
      toolError = `${err}`;
    } finally {
      toolInFlight = false;
      shell.rerender();
    }
  }

  function renderAgentEvent(ev: AgentEventPayload): string {
    const glyph = eventGlyph(ev.kind);
    return `<div class="event event-${ev.kind}"><span class="event-glyph">${glyph}</span><span class="event-text">${esc(ev.text)}</span></div>`;
  }

  function eventGlyph(kind: AgentEventPayload["kind"]): string {
    switch (kind) {
      case "started": return "▸";
      case "turn": return "──";
      case "assistant": return " ";
      case "reasoning": return "·";
      case "tool_call": return "→";
      case "tool_result": return "←";
      case "tool_error": return "✗";
      case "api_error": return "✗";
      case "done": return "✓";
    }
  }
}
