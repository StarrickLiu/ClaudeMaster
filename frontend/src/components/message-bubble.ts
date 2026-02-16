// 对话消息气泡组件
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { renderMarkdown } from "../utils/markdown.js";

@customElement("cm-message-bubble")
export class MessageBubble extends LitElement {
  @property() role: "user" | "assistant" = "user";
  @property() text = "";

  static styles = css`
    :host {
      display: block;
      margin-bottom: var(--space-md);
    }

    .bubble {
      padding: var(--space-md);
      border-radius: var(--radius-md);
      line-height: 1.7;
      font-size: var(--font-size-sm);
      overflow-wrap: break-word;
    }

    .user {
      background: var(--color-user-bg);
      border: 1px solid var(--color-user-border);
    }

    .assistant {
      background: var(--color-assistant-bg);
      border: 1px solid var(--color-border);
    }

    .role-label {
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: var(--space-xs);
      color: var(--color-text-muted);
    }

    .user .role-label { color: #3b82f6; }
    .assistant .role-label { color: #8b5cf6; }

    /* Markdown 渲染样式 */
    .content h2, .content h3, .content h4 {
      margin-top: var(--space-md);
      margin-bottom: var(--space-sm);
    }

    .content pre.code-block {
      background: #1e1e2e;
      color: #cdd6f4;
      padding: var(--space-md);
      border-radius: var(--radius-sm);
      overflow-x: auto;
      margin: var(--space-sm) 0;
      font-size: var(--font-size-xs);
      line-height: 1.5;
    }

    .content code.inline-code {
      background: var(--color-border-light);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
    }

    .content ul {
      padding-left: var(--space-lg);
      margin: var(--space-sm) 0;
    }

    .content li {
      margin-bottom: var(--space-xs);
    }

    .content strong {
      font-weight: 600;
    }
  `;

  render() {
    return html`
      <div class="bubble ${this.role}">
        <div class="role-label">${this.role === "user" ? "用户" : "Claude"}</div>
        <div class="content">${unsafeHTML(renderMarkdown(this.text))}</div>
      </div>
    `;
  }
}
