// 工具调用折叠面板组件（TodoWrite/TodoRead 有专属渲染）
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ContentBlock } from "../api.js";

export interface ToolResult {
  content: unknown;
  isError?: boolean;
}

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

@customElement("cm-tool-call")
export class ToolCall extends LitElement {
  @property({ type: Object }) toolUse!: ContentBlock;
  @property({ type: Object }) result: ToolResult | null = null;

  static styles = css`
    :host {
      display: block;
      margin-bottom: var(--space-sm);
    }

    /* ── 普通工具调用 ── */
    details {
      border: 1px solid var(--color-tool-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }

    summary {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      background: var(--color-tool-bg);
      cursor: pointer;
      font-size: var(--font-size-sm);
      user-select: none;
      list-style: none;
    }

    summary::-webkit-details-marker { display: none; }

    summary::before {
      content: "▶";
      font-size: 10px;
      color: var(--color-text-muted);
      transition: transform 0.15s;
    }

    details[open] summary::before { transform: rotate(90deg); }

    .tool-name {
      font-weight: 600;
      color: var(--color-primary);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      background: var(--color-border-light);
      padding: 1px 6px;
      border-radius: 4px;
    }

    .tool-desc {
      color: var(--color-text-secondary);
      font-size: var(--font-size-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .content-area { border-top: 1px solid var(--color-tool-border); }

    .section { padding: var(--space-sm) var(--space-md); }

    .section-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-bottom: var(--space-xs);
      font-weight: 500;
    }

    pre {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 300px;
      overflow-y: auto;
      background: #f8f9fa;
      padding: var(--space-sm);
      border-radius: 4px;
      margin: 0;
    }

    .error pre {
      background: var(--color-diff-del-bg);
      color: var(--color-diff-del-text);
    }

    /* ── Todo 专属渲染 ── */

    .todo-wrap {
      border-left: 2px solid var(--color-border);
      margin-left: 2px;
      padding-left: 12px;
    }

    /* 当前任务标题行（activeForm） */
    .todo-active-header {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 6px;
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--color-primary);
    }

    .todo-active-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--color-primary);
      flex-shrink: 0;
      animation: todo-pulse 1s ease-in-out infinite;
    }

    @keyframes todo-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.4; transform: scale(1.5); }
    }

    /* 任务列表 */
    .todo-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .todo-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 2px 0;
      font-size: var(--font-size-sm);
      line-height: 1.5;
    }

    /* 状态符号 */
    .todo-mark {
      flex-shrink: 0;
      width: 14px;
      font-size: 11px;
      font-family: var(--font-mono);
      text-align: center;
      margin-top: 1px;
    }

    .mark-progress { color: var(--color-primary); }
    .mark-pending  { color: var(--color-text-muted); }
    .mark-done     { color: var(--color-working, #22c55e); }

    /* 文字 */
    .todo-label {
      flex: 1;
      color: var(--color-text);
    }

    .todo-row.is-done .todo-label {
      color: var(--color-text-muted);
      text-decoration: line-through;
      text-decoration-color: var(--color-border);
    }

    .todo-row.is-progress .todo-label {
      color: var(--color-text);
      font-weight: 500;
    }

    .todo-row.is-pending .todo-label {
      color: var(--color-text-secondary);
    }
  `;

  private _getDescription(): string {
    const input = this.toolUse.input;
    if (!input) return "";
    if (input["command"]) return String(input["command"]).slice(0, 80);
    if (input["file_path"]) return String(input["file_path"]);
    if (input["pattern"]) return String(input["pattern"]);
    if (input["query"]) return String(input["query"]).slice(0, 80);
    if (input["url"]) return String(input["url"]).slice(0, 80);
    if (input["description"]) return String(input["description"]).slice(0, 80);
    return "";
  }

  private _formatContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (content === null || content === undefined) return "";
    return JSON.stringify(content, null, 2);
  }

  private _parseTodos(): TodoItem[] | null {
    const name = this.toolUse.name;
    if (name !== "TodoWrite" && name !== "TodoRead") return null;
    const input = this.toolUse.input as Record<string, unknown> | undefined;
    const todos = input?.["todos"];
    if (!Array.isArray(todos)) return null;
    return todos as TodoItem[];
  }

  private _renderTodos(todos: TodoItem[]) {
    // 分组排序：in_progress → pending → completed
    const inProgress = todos.filter(t => t.status === "in_progress");
    const pending    = todos.filter(t => t.status === "pending");
    const done       = todos.filter(t => t.status === "completed");
    const ordered    = [...inProgress, ...pending, ...done];

    // 取第一个 in_progress 的 activeForm 作为标题
    const active = inProgress[0];
    const headerText = active?.activeForm ?? active?.content ?? null;

    return html`
      <div class="todo-wrap">
        ${headerText ? html`
          <div class="todo-active-header">
            <span class="todo-active-dot"></span>
            ${headerText}…
          </div>
        ` : nothing}
        <div class="todo-list">
          ${ordered.map(t => this._renderRow(t))}
        </div>
      </div>
    `;
  }

  private _renderRow(t: TodoItem) {
    let markClass = "mark-pending";
    let rowClass  = "is-pending";
    let mark: unknown = "◻";

    if (t.status === "in_progress") {
      markClass = "mark-progress";
      rowClass  = "is-progress";
      mark      = "◼";
    } else if (t.status === "completed") {
      markClass = "mark-done";
      rowClass  = "is-done";
      mark      = "✔";
    }

    return html`
      <div class="todo-row ${rowClass}">
        <span class="todo-mark ${markClass}">${mark}</span>
        <span class="todo-label">${t.content}</span>
      </div>
    `;
  }

  render() {
    const todos = this._parseTodos();
    if (todos) return this._renderTodos(todos);

    return html`
      <details>
        <summary>
          <span class="tool-name">${this.toolUse.name || "Tool"}</span>
          <span class="tool-desc">${this._getDescription()}</span>
        </summary>
        <div class="content-area">
          <div class="section">
            <div class="section-label">输入</div>
            <pre>${JSON.stringify(this.toolUse.input, null, 2)}</pre>
          </div>
          ${this.result ? html`
            <div class="section ${this.result.isError ? "error" : ""}">
              <div class="section-label">${this.result.isError ? "错误" : "输出"}</div>
              <pre>${this._formatContent(this.result.content)}</pre>
            </div>
          ` : nothing}
        </div>
      </details>
    `;
  }
}
