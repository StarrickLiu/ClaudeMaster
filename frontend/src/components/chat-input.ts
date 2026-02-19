// 聊天输入框组件：发送消息、中断、连接状态指示
import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { ChatState } from "../services/chat-client.js";

@customElement("cm-chat-input")
export class ChatInput extends LitElement {
  @property() chatState: ChatState = "closed";
  @state() private text = "";
  @query("textarea") private textarea!: HTMLTextAreaElement;

  static styles = css`
    :host {
      display: block;
      position: sticky;
      bottom: 0;
      background: var(--color-surface);
      border-top: 1px solid var(--color-border);
      padding: var(--space-sm) var(--space-md);
      z-index: 50;
    }

    .input-row {
      display: flex;
      gap: var(--space-sm);
      align-items: flex-end;
    }

    textarea {
      flex: 1;
      resize: none;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: var(--space-sm) var(--space-md);
      font-size: var(--font-size-sm);
      font-family: var(--font-body);
      line-height: 1.5;
      min-height: 40px;
      max-height: 120px;
      outline: none;
      background: var(--color-surface);
      color: var(--color-text);
    }

    textarea:focus {
      border-color: var(--color-primary);
    }

    textarea:disabled {
      opacity: 0.5;
    }

    .send-btn,
    .interrupt-btn {
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      font-weight: 500;
      white-space: nowrap;
      min-height: 40px;
      cursor: pointer;
      border: none;
    }

    .send-btn {
      background: var(--color-primary);
      color: white;
    }
    .send-btn:hover:not(:disabled) {
      background: var(--color-primary-hover);
    }
    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .interrupt-btn {
      background: var(--color-error);
      color: white;
    }
    .interrupt-btn:hover {
      opacity: 0.85;
    }

    .status-bar {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: var(--space-xs);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot-idle { background: var(--color-working); }
    .dot-connected { background: var(--color-working); }
    .dot-streaming {
      background: var(--color-working);
      animation: pulse 1s infinite;
    }
    .dot-waiting_permission {
      background: var(--color-attention);
      animation: pulse 1s infinite;
    }
    .dot-closed { background: var(--color-done); }
    .dot-error { background: var(--color-error); }
    .dot-connecting {
      background: var(--color-attention);
      animation: pulse 1s infinite;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.3;
      }
    }

    @media (max-width: 768px) {
      :host {
        padding: var(--space-xs) var(--space-sm);
      }
    }
  `;

  private _onInput(e: Event) {
    this.text = (e.target as HTMLTextAreaElement).value;
    const ta = e.target as HTMLTextAreaElement;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  private _onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  private _send() {
    const msg = this.text.trim();
    if (!msg || !this._canSend()) return;
    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: msg,
        bubbles: true,
        composed: true,
      })
    );
    this.text = "";
    if (this.textarea) {
      this.textarea.style.height = "auto";
    }
  }

  private _interrupt() {
    this.dispatchEvent(
      new CustomEvent("interrupt", { bubbles: true, composed: true })
    );
  }

  private _canSend(): boolean {
    // error 时不可发送；closed 时允许（viewer 层会自动重连）
    return this.chatState !== "error";
  }

  private _isStreaming(): boolean {
    return (
      this.chatState === "streaming" ||
      this.chatState === "waiting_permission"
    );
  }

  private _statusText(): string {
    const map: Record<string, string> = {
      connecting: "正在连接...",
      connected: "已连接",
      starting: "Claude 启动中...",
      streaming: "Claude 正在回复...",
      waiting_permission: "等待权限确认",
      idle: "就绪",
      closed: "已断开 · 发消息将自动重连",
      error: "连接失败",
    };
    return map[this.chatState] || this.chatState;
  }

  render() {
    return html`
      <div class="input-row">
        <textarea
          rows="1"
          placeholder="发送消息给 Claude..."
          .value=${this.text}
          @input=${this._onInput}
          @keydown=${this._onKeydown}
        ></textarea>
        ${this._isStreaming()
          ? html`<button class="interrupt-btn" @click=${this._interrupt}>
              停止
            </button>`
          : html`<button
              class="send-btn"
              @click=${this._send}
              ?disabled=${!this._canSend() || !this.text.trim()}
            >
              发送
            </button>`}
      </div>
      <div class="status-bar">
        <span class="status-dot dot-${this.chatState}"></span>
        <span>${this._statusText()}</span>
      </div>
    `;
  }
}
