// 对话查看器页面：消息流 + 代码变更标签页
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { SessionDetail, Message, ContentBlock } from "../api.js";
import type { ToolResult } from "../components/tool-call.js";
import { timeAgo, formatDateTime } from "../utils/time.js";
import "../components/message-bubble.js";
import "../components/tool-call.js";
import "../components/thinking-block.js";
import "../components/diff-view.js";

@customElement("cm-viewer")
export class ViewerPage extends LitElement {
  @property() sessionId = "";
  @property() project = "";

  @state() data: SessionDetail | null = null;
  @state() loading = true;
  @state() activeTab: "conversation" | "diff" = "conversation";
  @state() diffContent = "";
  @state() diffStat = "";
  @state() diffLoading = false;
  @state() showOnlyChat = false;

  // tool_use_id → ToolResult 映射
  private toolResultMap = new Map<string, ToolResult>();

  static styles = css`
    :host {
      display: block;
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      margin-bottom: var(--space-lg);
      flex-wrap: wrap;
    }

    .back-btn {
      padding: var(--space-xs) var(--space-sm);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
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
    }

    .session-meta {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      display: flex;
      gap: var(--space-md);
      flex-wrap: wrap;
      margin-top: var(--space-xs);
    }

    .branch-tag {
      background: var(--color-border-light);
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
    }

    /* 标签页 */
    .tabs {
      display: flex;
      gap: 2px;
      background: var(--color-border-light);
      border-radius: var(--radius-sm);
      padding: 2px;
      margin-bottom: var(--space-lg);
      width: fit-content;
    }

    .tab {
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      transition: all 0.15s;
    }

    .tab[data-active] {
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-sm);
    }

    /* 工具栏 */
    .toolbar {
      display: flex;
      gap: var(--space-sm);
      margin-bottom: var(--space-md);
    }

    .toolbar-btn {
      padding: var(--space-xs) var(--space-sm);
      font-size: var(--font-size-xs);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-secondary);
    }

    .toolbar-btn:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .toolbar-btn[data-active] {
      background: var(--color-primary);
      color: white;
      border-color: var(--color-primary);
    }

    /* 消息流 */
    .messages {
      display: flex;
      flex-direction: column;
    }

    .loading, .empty {
      text-align: center;
      padding: var(--space-2xl);
      color: var(--color-text-muted);
    }

    /* 悬浮按钮：跳到底部 */
    .scroll-bottom {
      position: fixed;
      bottom: 80px;
      right: 20px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--color-primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-lg);
      font-size: 18px;
      z-index: 50;
    }

    .scroll-bottom:hover {
      background: var(--color-primary-hover);
    }

    .token-stats {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      padding: var(--space-sm) 0;
    }

    @media (max-width: 768px) {
      .header { flex-direction: column; align-items: flex-start; }
      .scroll-bottom { bottom: 72px; right: 12px; }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  private async _load() {
    this.loading = true;
    try {
      this.data = await api.getSession(this.sessionId, this.project);
      this._buildToolResultMap();
    } catch (e) {
      console.error("加载会话失败:", e);
    }
    this.loading = false;
  }

  private _buildToolResultMap() {
    this.toolResultMap.clear();
    if (!this.data) return;

    for (const msg of this.data.messages) {
      if (msg.type !== "user" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          this.toolResultMap.set(block.tool_use_id, {
            content: block.content,
            isError: block.is_error,
          });
        }
      }
    }
  }

  private _isToolResultMessage(msg: Message): boolean {
    if (msg.type !== "user" || !Array.isArray(msg.content)) return false;
    return msg.content.every(b => b.type === "tool_result");
  }

  private _getTextContent(msg: Message): string {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(b => b.type === "text")
        .map(b => b.text || "")
        .join("\n");
    }
    return "";
  }

  private async _loadDiff() {
    if (!this.data) return;
    this.diffLoading = true;
    try {
      const result = await api.getDiff(this.data.summary.project_path);
      this.diffContent = result.diff;
      this.diffStat = result.stat;
    } catch (e) {
      console.error("加载 diff 失败:", e);
      this.diffContent = "";
      this.diffStat = "加载失败";
    }
    this.diffLoading = false;
  }

  private _switchTab(tab: "conversation" | "diff") {
    this.activeTab = tab;
    if (tab === "diff" && !this.diffContent && !this.diffLoading) {
      this._loadDiff();
    }
  }

  private _scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  private _renderMessage(msg: Message) {
    // 跳过 tool_result 类型的 user 消息（内容已关联到 tool_use 中展示）
    if (this._isToolResultMessage(msg)) return nothing;

    // 用户文字消息
    if (msg.type === "user") {
      const text = this._getTextContent(msg);
      if (!text) return nothing;
      return html`<cm-message-bubble role="user" .text=${text}></cm-message-bubble>`;
    }

    // assistant 消息：遍历 content blocks
    if (msg.type === "assistant" && Array.isArray(msg.content)) {
      const blocks = msg.content as ContentBlock[];
      return html`
        ${blocks.map(block => {
          switch (block.type) {
            case "text":
              return block.text
                ? html`<cm-message-bubble role="assistant" .text=${block.text}></cm-message-bubble>`
                : nothing;

            case "thinking":
              return this.showOnlyChat
                ? nothing
                : html`<cm-thinking-block .content=${block.thinking || ""}></cm-thinking-block>`;

            case "tool_use":
              if (this.showOnlyChat) return nothing;
              const result = block.id ? this.toolResultMap.get(block.id) ?? null : null;
              return html`<cm-tool-call .toolUse=${block} .result=${result}></cm-tool-call>`;

            default:
              return nothing;
          }
        })}
      `;
    }

    // assistant 消息但 content 是字符串
    if (msg.type === "assistant" && typeof msg.content === "string") {
      return msg.content
        ? html`<cm-message-bubble role="assistant" .text=${msg.content}></cm-message-bubble>`
        : nothing;
    }

    return nothing;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">加载中...</div>`;
    }

    if (!this.data) {
      return html`<div class="empty">会话不存在</div>`;
    }

    const s = this.data.summary;

    return html`
      <div class="header">
        <button class="back-btn" @click=${() => history.back()}>← 返回</button>
        <div class="session-info">
          <div class="session-title">${s.project_name}</div>
          <div class="session-meta">
            <span>${s.message_count} 条消息</span>
            <span>${s.start_time ? formatDateTime(s.start_time) : ""}</span>
            ${s.git_branch ? html`<span class="branch-tag">${s.git_branch}</span>` : ""}
            <span>${s.end_time ? timeAgo(s.end_time) : ""}</span>
          </div>
        </div>
      </div>

      <div class="tabs">
        <button class="tab" ?data-active=${this.activeTab === "conversation"}
          @click=${() => this._switchTab("conversation")}>对话</button>
        <button class="tab" ?data-active=${this.activeTab === "diff"}
          @click=${() => this._switchTab("diff")}>代码变更</button>
      </div>

      ${this.activeTab === "conversation" ? html`
        <div class="toolbar">
          <button class="toolbar-btn" ?data-active=${this.showOnlyChat}
            @click=${() => { this.showOnlyChat = !this.showOnlyChat; }}>
            ${this.showOnlyChat ? "显示全部" : "只看对话"}
          </button>
        </div>
        <div class="messages">
          ${this.data.messages.map(m => this._renderMessage(m))}
        </div>
        <div class="token-stats">
          输入 ${(s.total_input_tokens / 1000).toFixed(0)}K · 输出 ${(s.total_output_tokens / 1000).toFixed(0)}K tokens
        </div>
        <button class="scroll-bottom" @click=${this._scrollToBottom}>↓</button>
      ` : html`
        ${this.diffLoading
          ? html`<div class="loading">加载中...</div>`
          : html`<cm-diff-view .diff=${this.diffContent} .stat=${this.diffStat}></cm-diff-view>`
        }
      `}
    `;
  }
}
