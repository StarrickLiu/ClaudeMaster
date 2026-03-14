// 会话摘要卡片：第一条消息、最后助手输出、token 统计
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionSummary } from "../api.js";
import { formatTokens } from "../utils/format.js";

@customElement("cm-session-summary")
export class SessionSummaryCard extends LitElement {
  @property({ type: Object }) summary: SessionSummary | null = null;

  static styles = css`
    :host {
      display: block;
    }

    .summary-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-md) var(--space-lg);
      margin-bottom: var(--space-lg);
    }

    .summary-topic {
      font-size: var(--font-size-base);
      font-weight: 500;
      color: var(--color-text);
      line-height: 1.5;
      margin-bottom: var(--space-sm);
    }

    .summary-progress {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.6;
      padding-left: var(--space-sm);
      border-left: 2px solid var(--color-primary);
      margin-bottom: var(--space-md);
    }

    .summary-metrics {
      display: flex;
      gap: var(--space-lg);
      flex-wrap: wrap;
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .summary-metric {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  `;

  render() {
    const s = this.summary;
    if (!s) return nothing;

    const totalTokens = s.total_input_tokens + s.total_output_tokens;

    return html`
      <div class="summary-card">
        <div class="summary-topic">${s.first_message || "（无消息）"}</div>
        ${s.last_assistant_text
          ? html`<div class="summary-progress">${s.last_assistant_text}</div>`
          : nothing}
        <div class="summary-metrics">
          <span class="summary-metric">💬 ${s.user_turns} 轮对话</span>
          ${s.tool_use_count > 0
            ? html`<span class="summary-metric">🔧 ${s.tool_use_count} 次工具调用</span>`
            : nothing}
          ${totalTokens > 0
            ? html`<span class="summary-metric">📊 ${formatTokens(totalTokens)} tokens</span>`
            : nothing}
          <span class="summary-metric">📝 ${s.message_count} 条消息</span>
        </div>
      </div>
    `;
  }
}
