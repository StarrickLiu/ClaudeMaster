// 会话头部组件：标题（可内联改名）、元信息、配置摘要、接入/恢复/断开按钮
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionSummary } from "../api.js";
import { timeAgo, formatDateTime } from "../utils/time.js";
import type { LaunchConfig } from "./launch-config-dialog.js";
import "./launch-config-dialog.js";

@customElement("cm-session-header")
export class SessionHeader extends LitElement {
  @property({ type: Object }) summary: SessionSummary | null = null;
  @property() sessionName = "";
  @property({ type: Boolean }) chatMode = false;
  @property({ type: Boolean }) chatConnecting = false;
  /** broker 有活跃会话但未连接，显示「接入会话」按钮 */
  @property({ type: Boolean }) hasActiveBroker = false;
  /** 当前会话的启动配置（用于配置摘要和对话框预填充） */
  @property({ type: Object }) launchConfig: Record<string, unknown> | null = null;
  /** 会话来源："local" | "remote" */
  @property() source = "local";
  /** 远程主机名 */
  @property() hostname = "";

  @state() private _configOpen = false;
  @state() private _copied = false;
  @state() private _editingName = false;
  @state() private _editNameValue = "";

  static styles = css`
    :host {
      display: block;
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      margin-bottom: var(--space-sm);
      flex-wrap: wrap;
    }

    .back-btn {
      padding: var(--space-xs) var(--space-sm);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      background: none;
      border: none;
      cursor: pointer;
    }

    .back-btn:hover {
      color: var(--color-primary);
    }

    .session-info {
      flex: 1;
    }

    .session-title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      flex-wrap: wrap;
      min-width: 0;
      overflow-wrap: break-word;
    }

    .name-display {
      cursor: pointer;
      border-bottom: 1px dashed transparent;
      transition: border-color 0.15s;
    }

    .name-display:hover {
      border-bottom-color: var(--color-text-muted);
    }

    .name-edit-input {
      font-size: var(--font-size-lg);
      font-weight: 600;
      font-family: inherit;
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm);
      padding: 0 var(--space-xs);
      outline: none;
      background: var(--color-bg);
      color: var(--color-text);
      max-width: 200px;
      width: 100%;
    }

    .hostname-badge {
      background: var(--color-primary-bg, #dbeafe);
      color: var(--color-primary, #2563eb);
      font-size: var(--font-size-xs);
      font-weight: 600;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      white-space: nowrap;
    }

    .session-meta {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      display: flex;
      gap: var(--space-sm);
      flex-wrap: wrap;
      margin-top: var(--space-xs);
      min-width: 0;
    }

    .branch-tag {
      background: var(--color-border-light);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
    }

    .session-id-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      background: var(--color-border-light);
      border: 1px solid var(--color-border);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      user-select: none;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }

    .session-id-chip:hover {
      background: var(--color-border);
      color: var(--color-text);
    }

    .session-id-chip.copied {
      background: #dcfce7;
      border-color: #86efac;
      color: #16a34a;
    }

    .copy-icon {
      font-style: normal;
      font-size: 10px;
      opacity: 0.6;
    }

    .resume-btn {
      padding: var(--space-sm) var(--space-md);
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }

    .resume-btn:hover:not(:disabled) {
      background: var(--color-primary-hover);
    }

    .resume-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .attach-btn {
      padding: var(--space-sm) var(--space-md);
      background: var(--color-working);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }

    .attach-btn:hover {
      filter: brightness(0.9);
    }

    .disconnect-btn {
      padding: var(--space-sm) var(--space-md);
      background: none;
      color: var(--color-text-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    .disconnect-btn:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .connecting {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* 配置摘要 */
    .config-summary {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-bottom: var(--space-md);
      padding-left: calc(var(--space-sm) + var(--space-xs) + var(--space-md));
    }

    .config-tag {
      display: inline;
    }

    .config-sep {
      margin: 0 var(--space-xs);
      opacity: 0.5;
    }

    @media (max-width: 768px) {
      .header {
        flex-direction: column;
        align-items: flex-start;
      }
      .config-summary {
        padding-left: 0;
      }
    }
  `;

  private async _copySessionId() {
    const id = this.summary?.resume_session_id ?? this.summary?.session_id;
    const cwd = this.summary?.project_path;
    if (!id) return;
    const cmd = cwd ? `cd ${cwd} && claude --resume ${id}` : `claude --resume ${id}`;
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // clipboard API 不可用时回退到 execCommand
      const ta = document.createElement("textarea");
      ta.value = cmd;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    this._copied = true;
    setTimeout(() => { this._copied = false; }, 1500);
  }

  private _startEdit() {
    this._editNameValue = this.sessionName;
    this._editingName = true;
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector<HTMLInputElement>(".name-edit-input");
      input?.focus();
      input?.select();
    });
  }

  private _confirmEdit() {
    this._editingName = false;
    const newName = this._editNameValue.trim();
    if (newName && newName !== this.sessionName) {
      this.dispatchEvent(new CustomEvent("rename", {
        detail: newName,
        bubbles: true,
        composed: true,
      }));
    }
  }

  private _cancelEdit() {
    this._editingName = false;
  }

  private _onEditKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      this._confirmEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._cancelEdit();
    }
  }

  private _renderConfigSummary() {
    const c = this.launchConfig;
    if (!c || Object.keys(c).length === 0) return nothing;

    const tags: string[] = [];

    // 模型
    const model = c.model as string | null | undefined;
    if (model) {
      tags.push(`模型:${model.charAt(0).toUpperCase() + model.slice(1)}`);
    }

    // 权限模式
    const perm = c.permission_mode as string | null | undefined;
    if (perm) {
      const permLabels: Record<string, string> = {
        bypassPermissions: "跳过所有",
        acceptEdits: "自动接受编辑",
        plan: "仅计划",
        default: "手动确认",
      };
      tags.push(`权限:${permLabels[perm] ?? perm}`);
    }

    // 预算
    const budget = c.max_budget_usd as number | null | undefined;
    if (budget != null) {
      tags.push(`预算:$${budget.toFixed(2)}`);
    }

    // 轮数
    const turns = c.max_turns as number | null | undefined;
    tags.push(`轮数:${turns != null ? String(turns) : "不限"}`);

    if (tags.length === 0) return nothing;

    return html`
      <div class="config-summary">
        ${tags.map((t, i) => html`${i > 0 ? html`<span class="config-sep">·</span>` : nothing}<span class="config-tag">${t}</span>`)}
      </div>
    `;
  }

  render() {
    const s = this.summary;
    return html`
      <div class="header">
        <button class="back-btn" @click=${() => history.back()}>
          ← 返回
        </button>
        <div class="session-info">
          <div class="session-title">
            ${this.sessionName
              ? this._editingName
                ? html`<input
                    class="name-edit-input"
                    .value=${this._editNameValue}
                    @input=${(e: Event) => { this._editNameValue = (e.target as HTMLInputElement).value; }}
                    @keydown=${this._onEditKeydown}
                    @blur=${this._confirmEdit}
                  /> · ${s?.project_name ?? ""}`
                : html`<span class="name-display" @click=${this._startEdit}>${this.sessionName}</span> · ${s?.project_name ?? ""}`
              : s?.project_name ?? ""}
            ${this.source === "remote" && this.hostname ? html`<span class="hostname-badge">${this.hostname}</span>` : nothing}
          </div>
          <div class="session-meta">
            <span>${s?.start_time ? formatDateTime(s.start_time) : ""}</span>
            ${s?.git_branch
              ? html`<span class="branch-tag">${s.git_branch}</span>`
              : ""}
            <span>${s?.end_time ? timeAgo(s.end_time) : ""}</span>
            ${(s?.resume_session_id ?? s?.session_id) ? html`
              <span
                class="session-id-chip ${this._copied ? "copied" : ""}"
                title="点击复制：cd ${s!.project_path} && claude --resume ${s!.resume_session_id ?? s!.session_id}"
                @click=${this._copySessionId}
              >
                ${this._copied
                  ? "✓ 已复制"
                  : html`<i class="copy-icon">⧉</i>${(s!.resume_session_id ?? s!.session_id).slice(0, 8)}`}
              </span>
            ` : nothing}
          </div>
        </div>
        ${this.chatMode
          ? html`<button
              class="disconnect-btn"
              @click=${() => this.dispatchEvent(new CustomEvent("disconnect", { bubbles: true, composed: true }))}
            >
              断开连接
            </button>`
          : this.chatConnecting
          ? html`<div class="connecting">
              <span class="spinner"></span>
              连接中...
            </div>`
          : this.hasActiveBroker
          ? html`<button
              class="attach-btn"
              @click=${() => this.dispatchEvent(new CustomEvent("attach", { bubbles: true, composed: true }))}
            >
              接入会话
            </button>`
          : html`<button
              class="resume-btn"
              @click=${() => { this._configOpen = true; }}
            >
              恢复会话
            </button>`}
      </div>

      ${this._renderConfigSummary()}

      <cm-launch-config-dialog
        .open=${this._configOpen}
        .initialConfig=${this.launchConfig}
        @cancel=${() => { this._configOpen = false; }}
        @start=${(e: CustomEvent<LaunchConfig>) => {
          this._configOpen = false;
          this.dispatchEvent(new CustomEvent("resume", {
            detail: e.detail,
            bubbles: true,
            composed: true,
          }));
        }}
      ></cm-launch-config-dialog>
    `;
  }
}
