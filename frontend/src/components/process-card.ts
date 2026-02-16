// 运行中进程卡片组件
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ClaudeProcess } from "../api.js";
import { formatDuration } from "../utils/time.js";

@customElement("cm-process-card")
export class ProcessCard extends LitElement {
  @property({ type: Object }) data!: ClaudeProcess;

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-working);
      border-left: 4px solid var(--color-working);
      border-radius: var(--radius-md);
      padding: var(--space-md);
      box-shadow: var(--shadow-sm);
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
      color: var(--color-working);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color-working);
      animation: pulse 2s infinite;
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
  `;

  render() {
    const d = this.data;
    return html`
      <div class="card">
        <div class="header">
          <span class="project-name">${d.project_name || "未知项目"}</span>
          <span class="status"><span class="dot"></span>运行中</span>
        </div>
        <div class="meta">
          <span>PID <span class="meta-item">${d.pid}</span></span>
          <span>已运行 <span class="meta-item">${formatDuration(d.uptime_seconds)}</span></span>
        </div>
      </div>
    `;
  }
}
