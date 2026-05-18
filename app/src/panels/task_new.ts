import type { ModelInfo, ShellState } from "../main";
import { esc } from "../lib/html";
import type { AgentTaskView, TaskMode, ToolCommand } from "./tasks";

export interface NewTaskPageProps {
  shell: ShellState;
  mode: TaskMode;
  toolCommand: ToolCommand;
  draft: string;
  submittingTask: boolean;
  toolInFlight: boolean;
  toolResult: unknown;
  toolError: string;
  submitError: string;
  tasks: AgentTaskView[];
  selectedModel: ModelInfo | undefined;
}

export function renderNewTaskPage(props: NewTaskPageProps): string {
  const connected = props.shell.status.state === "connected";
  const modelReady = !!props.selectedModel && props.selectedModel.has_key;
  const agentMode = props.mode === "agent";
  const running = agentMode ? props.submittingTask : props.toolInFlight;
  const runDisabled = running || !props.draft.trim() || !connected || (agentMode && !modelReady);
  const guard = renderTaskGuard(props.mode, connected, props.selectedModel);

  return `
    <div class="new-task-page">
      <div class="new-task-compose">
        <div class="new-task-copy">
          <p class="t-eyebrow">new task</p>
          <h2 class="t-h2">what should socai research?</h2>
          <p class="t-small subtle">start a one-shot browser task. socai opens a temporary chrome tab, runs the agent, saves the result, then closes the tab.</p>
        </div>
        ${renderTaskForm(props, agentMode, running, runDisabled)}
        ${guard}
        ${props.submitError ? `<pre class="result-pre result-error">${esc(props.submitError)}</pre>` : ""}
        ${agentMode ? "" : renderToolResult(props)}
      </div>
      ${renderTaskGlance(props.tasks)}
    </div>
  `;
}

function renderTaskForm(
  props: NewTaskPageProps,
  agentMode: boolean,
  running: boolean,
  runDisabled: boolean,
): string {
  return `
    <form id="task-form" class="task-form task-form-centered">
      <textarea
        id="task-input"
        class="task-input"
        rows="5"
        placeholder="${esc(taskPlaceholder(props.mode, props.toolCommand))}"
        ${running ? "disabled" : ""}
      >${esc(props.draft)}</textarea>

      <div class="task-controls">
        <div class="mode-switch" aria-label="task mode">
          <button id="mode-agent" type="button" class="mode-button ${agentMode ? "mode-button-active" : ""}">agent tasks</button>
          <button id="mode-tools" type="button" class="mode-button ${!agentMode ? "mode-button-active" : ""}">tool tests</button>
        </div>
        ${agentMode ? renderAgentSummary(props.selectedModel) : renderToolPicker(props.toolCommand)}
        <button id="task-submit" type="submit" class="btn-primary" ${runDisabled ? "disabled" : ""}>
          ${running ? "starting…" : agentMode ? "new task" : "run test"}
        </button>
      </div>
    </form>
  `;
}

function renderTaskGuard(mode: TaskMode, connected: boolean, selected: ModelInfo | undefined): string {
  if (!connected) return `<p class="t-small subtle">connect chrome first.</p>`;
  if (mode !== "agent") return renderToolHint(mode);
  if (!selected) return `<p class="t-small subtle">loading agent models…</p>`;
  if (!selected.has_key) return `<p class="t-small subtle">configure the agent in the header first.</p>`;
  return `<p class="t-small subtle">each task gets its own temporary chrome tab and closes it when finished.</p>`;
}

function renderAgentSummary(selected: ModelInfo | undefined): string {
  const summary = selected
    ? `agent · ${esc(selected.display_name)} · <span class="t-mono">${esc(selected.default_model)}</span>`
    : "agent · loading";
  return `<p class="t-small subtle task-context">${summary}</p>`;
}

function renderToolPicker(toolCommand: ToolCommand): string {
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

function renderToolHint(_mode: TaskMode): string {
  return `<p class="t-small subtle">test tools on a fresh temporary xiaohongshu tab.</p>`;
}

function taskPlaceholder(mode: TaskMode, toolCommand: ToolCommand): string {
  if (mode === "agent") return "tell socai what you want researched…";
  switch (toolCommand) {
    case "search_notes": return "search query…";
    case "topic_scan": return "topic to scan…";
    case "extract_note": return "note id or url…";
  }
}

function renderTaskGlance(tasks: AgentTaskView[]): string {
  const running = [...tasks]
    .filter((task) => task.status === "running" || task.status === "queued")
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 4);
  const recent = [...tasks]
    .filter((task) => task.status !== "running" && task.status !== "queued")
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 5);

  return `
    <div class="task-glance">
      <section class="task-glance-card">
        <div class="task-glance-head">
          <p class="t-eyebrow result-label">running</p>
          <span class="t-small subtle">${running.length}</span>
        </div>
        ${renderTaskSummaryRows(running, "no running tasks.")}
      </section>
      <section class="task-glance-card">
        <div class="task-glance-head">
          <p class="t-eyebrow result-label">recent</p>
          <button id="recent-history-link" type="button" class="btn-ghost btn-compact">view history</button>
        </div>
        ${renderTaskSummaryRows(recent, "no recent tasks yet.")}
      </section>
    </div>
  `;
}

function renderTaskSummaryRows(items: AgentTaskView[], emptyText: string): string {
  if (items.length === 0) {
    return `<p class="t-small placeholder task-summary-empty">${emptyText}</p>`;
  }
  return `
    <div class="task-summary-list">
      ${items.map((task) => `
        <button type="button" class="task-summary-row" data-task-id="${esc(task.task_id)}">
          <span class="task-row-glyph task-row-glyph-${esc(task.status)}" aria-hidden="true">${taskStatusGlyph(task.status)}</span>
          <span class="task-row-main">
            <span class="task-row-title">${esc(task.task)}</span>
            <span class="task-row-meta">${esc(task.status)} · ${esc(formatTime(task.created_at))}</span>
          </span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderToolResult(props: NewTaskPageProps): string {
  if (props.toolInFlight) {
    return `<pre class="result-pre result-running">running: ${esc(props.toolCommand)}(${esc(JSON.stringify(props.draft.trim()))})</pre>`;
  }
  if (props.toolError) {
    return `<pre class="result-pre result-error">${esc(props.toolError)}</pre>`;
  }
  if (props.toolResult) {
    return `<pre class="result-pre">${esc(JSON.stringify(props.toolResult, null, 2))}</pre>`;
  }
  return `<p class="t-small placeholder">no tool test result yet.</p>`;
}

function taskStatusGlyph(status: AgentTaskView["status"]): string {
  switch (status) {
    case "queued": return "○";
    case "running": return "●";
    case "completed": return "✓";
    case "failed": return "×";
    case "cancelled": return "−";
    case "interrupted": return "!";
  }
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
