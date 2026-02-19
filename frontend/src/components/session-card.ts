// 会话摘要卡片组件：三层信息架构（主题 → 进展 → 指标）
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionSummary } from "../api.js";
import { timeAgo } from "../utils/time.js";

@customElement("cm-session-card")
export class SessionCard extends LitElement {
  @property({ type: Object }) data!: SessionSummary;
  @property({ type: Boolean }) showProject = true;
  @property() reviewStat = "";
  @property() brokerName = "";

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

    .card[data-review] {
      border-left: 4px solid var(--color-attention);
    }

    .card:hover {
      box-shadow: var(--shadow-md);
      border-color: var(--color-primary);
    }

    .card[data-review]:hover {
      border-left-color: var(--color-attention);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-sm);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      min-width: 0;
    }

    .project-name {
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--color-primary);
      white-space: nowrap;
    }

    .session-name {
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--color-text-secondary);
      white-space: nowrap;
    }

    .name-sep {
      color: var(--color-text-muted);
      font-size: var(--font-size-xs);
      margin: 0 2px;
    }

    .branch {
      background: var(--color-border-light);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
    }

    .time {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      white-space: nowrap;
    }

    .topic {
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--color-text);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: var(--space-sm);
    }

    .progress {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: var(--space-sm);
      padding-left: var(--space-sm);
      border-left: 2px solid var(--color-border);
    }

    .metrics {
      display: flex;
      gap: var(--space-md);
      align-items: center;
      flex-wrap: wrap;
    }

    .metric {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .metric-icon {
      font-size: 11px;
      opacity: 0.7;
    }

    .metric-review {
      color: var(--color-attention);
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

  private _formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return `${tokens}`;
  }

  render() {
    const d = this.data;
    const totalTokens = d.total_input_tokens + d.total_output_tokens;

    return html`
      <div class="card" @click=${this._handleClick} ?data-review=${!!this.reviewStat}>
        <div class="header">
          <div class="header-left">
            ${this.showProject
              ? html`<span class="project-name">${d.project_name}</span>`
              : nothing}
            ${this.brokerName
              ? html`<span class="name-sep">/</span><span class="session-name">${this.brokerName}</span>`
              : nothing}
            ${d.git_branch ? html`<span class="branch">${d.git_branch}</span>` : nothing}
          </div>
          <span class="time">${d.end_time ? timeAgo(d.end_time) : ""}</span>
        </div>

        <div class="topic">${d.first_message || "（无消息）"}</div>

        ${d.last_assistant_text
          ? html`<div class="progress">${d.last_assistant_text}</div>`
          : nothing}

        <div class="metrics">
          <span class="metric">
            <span class="metric-icon">💬</span> ${d.user_turns} 轮对话
          </span>
          ${d.tool_use_count > 0
            ? html`<span class="metric">
                <span class="metric-icon">🔧</span> ${d.tool_use_count} 次工具
              </span>`
            : nothing}
          ${totalTokens > 0
            ? html`<span class="metric">
                <span class="metric-icon">📊</span> ${this._formatTokens(totalTokens)} tokens
              </span>`
            : nothing}
          ${this.reviewStat
            ? html`<span class="metric metric-review">
                <span class="metric-icon">📋</span> ${this.reviewStat}
              </span>`
            : nothing}
          ${d.is_active
            ? html`<span class="active-badge"><span class="active-dot"></span>运行中</span>`
            : nothing}
        </div>
      </div>
    `;
  }
}
