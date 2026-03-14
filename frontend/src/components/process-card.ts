// 待命中进程卡片组件（本地或远程非 broker 管理的 Claude 进程）
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ClaudeProcess } from "../api.js";
import { formatDuration } from "../utils/time.js";

@customElement("cm-process-card")
export class ProcessCard extends LitElement {
  @property({ type: Object }) data!: ClaudeProcess;
  /** 可选：所在机器名称，有值时显示 badge */
  @property() machineName = "";

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-standby);
      border-left: 4px solid var(--color-standby);
      border-radius: var(--radius-md);
      padding: var(--space-md);
      box-shadow: var(--shadow-sm);
      cursor: pointer;
      transition: box-shadow 0.15s;
    }

    .card:hover {
      box-shadow: 0 0 0 2px var(--color-standby);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-sm);
    }

    .project-name {
      font-weight: 600;
      font-size: var(--font-size-base);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-size-xs);
      color: var(--color-standby);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-standby);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .meta {
      display: flex;
      gap: var(--space-md);
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .meta-item {
      font-family: var(--font-mono);
    }

    .machine-badge {
      background: var(--color-primary-bg, #dbeafe);
      color: var(--color-primary, #2563eb);
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 160px;
    }
  `;

  private _handleClick() {
    const d = this.data;
    const encoded = d.cwd.replace(/\//g, "-");
    if (d.session_id) {
      location.hash = `#/viewer/${encoded}/${d.session_id}`;
    } else {
      // 无 session_id 时跳转到会话历史筛选该项目
      location.hash = `#/sessions?project=${encoded}`;
    }
  }

  render() {
    const d = this.data;
    return html`
      <div class="card" @click=${this._handleClick}>
        <div class="header">
          <span class="project-name">${d.project_name || "未知项目"}</span>
          ${this.machineName ? html`<span class="machine-badge" title=${this.machineName}>${this.machineName}</span>` : nothing}
          <span class="status"><span class="dot"></span>待命中</span>
        </div>
        <div class="meta">
          <span>PID <span class="meta-item">${d.pid}</span></span>
          <span>已运行 <span class="meta-item">${formatDuration(d.uptime_seconds)}</span></span>
          ${d.git_branch ? html`<span class="meta-item">${d.git_branch}</span>` : ""}
        </div>
      </div>
    `;
  }
}
