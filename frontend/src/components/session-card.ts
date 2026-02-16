// 会话摘要卡片组件
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionSummary } from "../api.js";
import { timeAgo } from "../utils/time.js";

@customElement("cm-session-card")
export class SessionCard extends LitElement {
  @property({ type: Object }) data!: SessionSummary;
  @property({ type: Boolean }) showProject = true;

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-md);
      cursor: pointer;
      transition: all 0.15s;
      box-shadow: var(--shadow-sm);
    }

    .card:hover {
      box-shadow: var(--shadow-md);
      border-color: var(--color-primary);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-sm);
    }

    .project-name {
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--color-primary);
    }

    .time {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .preview {
      font-size: var(--font-size-sm);
      color: var(--color-text);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: var(--space-sm);
    }

    .meta {
      display: flex;
      gap: var(--space-md);
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .branch {
      background: var(--color-border-light);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
    }

    .active-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      background: var(--color-working-bg);
      color: var(--color-working);
    }

    .active-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-working);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;

  private _handleClick() {
    const d = this.data;
    const project = this._getEncodedProject();
    location.hash = `#/viewer/${project}/${d.session_id}`;
  }

  private _getEncodedProject(): string {
    return this.data.project_path.replace(/\//g, "-");
  }

  render() {
    const d = this.data;
    return html`
      <div class="card" @click=${this._handleClick}>
        <div class="header">
          ${this.showProject
            ? html`<span class="project-name">${d.project_name}</span>`
            : html`<span></span>`
          }
          <span class="time">${d.end_time ? timeAgo(d.end_time) : ""}</span>
        </div>
        <div class="preview">${d.first_message || "（无消息）"}</div>
        <div class="meta">
          <span>${d.message_count} 条消息</span>
          ${d.git_branch ? html`<span class="branch">${d.git_branch}</span>` : ""}
          ${d.is_active ? html`<span class="active-badge"><span class="active-dot"></span>运行中</span>` : ""}
        </div>
      </div>
    `;
  }
}
