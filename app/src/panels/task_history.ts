import type { AgentTaskEventPayload } from "../main";
import { esc } from "../lib/html";
import type { AgentTaskView } from "./tasks";

export interface TaskHistoryPageProps {
  tasks: AgentTaskView[];
  selectedTask: AgentTaskView | undefined;
  selectedTaskId: string | null;
}

export function renderHistoryPage(props: TaskHistoryPageProps): string {
  return `
    <div class="history-page">
      <div class="history-page-head">
        <div>
          <p class="t-eyebrow result-label">task history</p>
          <p class="t-small subtle">review completed, failed, interrupted, and running tasks.</p>
        </div>
        <button id="history-new-task" type="button" class="btn-ghost">new task</button>
      </div>
      ${renderTaskWorkspace(props)}
    </div>
  `;
}

function renderTaskWorkspace(props: TaskHistoryPageProps): string {
  return `
    <div class="tasks-layout">
      <aside class="task-list" aria-label="task history">
        <div class="task-list-head">
          <p class="t-eyebrow result-label">history</p>
          <span class="t-small subtle">${props.tasks.length} task${props.tasks.length === 1 ? "" : "s"}</span>
        </div>
        <div class="task-list-body">
          ${renderTaskRows(props.tasks, props.selectedTaskId)}
        </div>
      </aside>
      <section class="task-detail" aria-label="selected task">
        ${props.selectedTask ? renderSelectedTask(props.selectedTask) : renderNoTaskSelected()}
      </section>
    </div>
  `;
}

function renderTaskRows(tasks: AgentTaskView[], selectedTaskId: string | null): string {
  if (tasks.length === 0) {
    return `<p class="t-small placeholder task-list-empty">no tasks yet.</p>`;
  }
  return [...tasks]
    .sort((a, b) => b.created_at - a.created_at)
    .map((task) => {
      const active = task.task_id === selectedTaskId ? "task-row-active" : "";
      return `
        <button type="button" class="task-row ${active}" data-task-id="${esc(task.task_id)}">
          <span class="task-row-glyph task-row-glyph-${esc(task.status)}" aria-hidden="true">${taskStatusGlyph(task.status)}</span>
          <span class="task-row-main">
            <span class="task-row-title">${esc(task.task)}</span>
            <span class="task-row-meta">${esc(task.status)} · ${esc(formatTime(task.created_at))}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderSelectedTask(task: AgentTaskView): string {
  const tokenLine = task.input_tokens !== null && task.output_tokens !== null
    ? ` · in ${task.input_tokens} / out ${task.output_tokens} tokens`
    : "";
  return `
    <div class="task-detail-head">
      <div>
        <p class="t-eyebrow result-label">selected task</p>
        <h2 class="t-h3 task-detail-title">${esc(task.task)}</h2>
      </div>
      <div class="task-detail-actions">
        <span class="badge"><i class="badge-dot ${task.status === "running" ? "badge-dot-ink badge-dot-pulse" : "badge-dot-hollow"}" aria-hidden="true"></i>${esc(task.status)}</span>
        ${canCancel(task) ? `<button type="button" class="btn-ghost btn-compact" data-cancel-task="${esc(task.task_id)}">cancel</button>` : ""}
      </div>
    </div>

    ${renderTaskTimeline(task)}

    ${
      task.error
        ? `<pre class="result-pre result-error">${esc(task.error)}</pre>`
        : ""
    }
    ${
      task.final_text
        ? `
          <div class="agent-outcome">
            <p class="t-eyebrow result-label">final answer</p>
            <pre class="result-pre">${esc(task.final_text.trim())}</pre>
            <p class="t-small subtle">run ${esc(task.run_id ?? task.task_id)}${task.turns !== null ? ` · ${task.turns} turns` : ""}${tokenLine}</p>
            ${task.run_dir ? `<p class="t-small subtle">run_dir: <span class="t-mono">${esc(task.run_dir)}</span></p>` : ""}
          </div>`
        : ""
    }
  `;
}

function renderTaskTimeline(task: AgentTaskView): string {
  if (task.events.length > 0) {
    return `
      <div class="result-block">
        <div class="event-stream" data-agent-events="${esc(task.task_id)}">
          ${task.events.map(renderAgentEvent).join("")}
        </div>
      </div>
    `;
  }
  if (task.status === "running" || task.status === "queued") {
    return `
      <div class="result-block">
        <div class="event-stream" data-agent-events="${esc(task.task_id)}">
          <p class="t-small placeholder" data-events-placeholder>waiting for events…</p>
        </div>
      </div>
    `;
  }
  if (task.final_text) return "";
  return `<p class="t-small placeholder">no event timeline available.</p>`;
}

function renderNoTaskSelected(): string {
  return `
    <div class="task-empty-detail">
      <p class="t-eyebrow result-label">selected task</p>
      <p class="t-small placeholder">start a task or choose one from history.</p>
    </div>
  `;
}

export function renderAgentEvent(ev: AgentTaskEventPayload): string {
  const glyph = eventGlyph(ev.kind);
  return `<div class="event event-${ev.kind}"><span class="event-glyph">${glyph}</span><span class="event-text">${esc(ev.text)}</span></div>`;
}

function eventGlyph(kind: AgentTaskEventPayload["kind"]): string {
  switch (kind) {
    case "queued": return "○";
    case "running": return "●";
    case "started": return "▸";
    case "tab": return "□";
    case "turn": return "──";
    case "assistant": return " ";
    case "reasoning": return "·";
    case "tool_call": return "→";
    case "tool_result": return "←";
    case "tool_error": return "✗";
    case "api_error": return "✗";
    case "done": return "✓";
    case "completed": return "✓";
    case "failed": return "✗";
    case "cancelled": return "−";
    case "interrupted": return "!";
  }
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

function canCancel(task: AgentTaskView): boolean {
  return task.status === "queued" || task.status === "running";
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
