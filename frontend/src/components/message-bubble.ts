// 对话消息气泡组件
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { renderMarkdown } from "../utils/markdown.js";

@customElement("cm-message-bubble")
export class MessageBubble extends LitElement {
  @property() role: "user" | "assistant" = "user";
  @property() text = "";
  /** 流式输出中：显示光标动画 */
  @property({ type: Boolean, reflect: true }) streaming = false;

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

    /* Markdown 渲染样式（marked 生成标准 HTML） */
    .content h1, .content h2, .content h3,
    .content h4, .content h5, .content h6 {
      margin-top: var(--space-lg);
      margin-bottom: var(--space-sm);
      font-weight: 600;
      line-height: 1.3;
    }
    .content h1 { font-size: 1.4em; }
    .content h2 { font-size: 1.2em; }
    .content h3 { font-size: 1.05em; }

    .content p {
      margin: var(--space-sm) 0;
    }

    .content pre {
      background: #1e1e2e;
      color: #cdd6f4;
      padding: var(--space-md);
      border-radius: var(--radius-sm);
      overflow-x: auto;
      margin: var(--space-sm) 0;
      font-size: var(--font-size-xs);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .content pre code {
      background: none;
      padding: 0;
      font-size: inherit;
      border-radius: 0;
    }

    .content code {
      background: var(--color-border-light);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      font-family: var(--font-mono, monospace);
      word-break: break-word;
    }

    .content ul, .content ol {
      padding-left: 1.5em;
      margin: var(--space-sm) 0;
    }

    .content li {
      margin-bottom: 2px;
    }

    .content li > ul, .content li > ol {
      margin: 2px 0;
    }

    .content strong { font-weight: 600; }
    .content em { font-style: italic; }

    .content a {
      color: var(--color-primary);
      text-decoration: underline;
    }

    .content blockquote {
      border-left: 3px solid var(--color-border);
      margin: var(--space-sm) 0;
      padding: var(--space-xs) var(--space-md);
      color: var(--color-text-secondary);
    }

    .content table {
      border-collapse: collapse;
      width: 100%;
      margin: var(--space-sm) 0;
      font-size: var(--font-size-xs);
      display: block;
      overflow-x: auto;
    }
    .content th, .content td {
      border: 1px solid var(--color-border);
      padding: var(--space-xs) var(--space-sm);
      text-align: left;
    }
    .content th {
      background: var(--color-border-light);
      font-weight: 600;
    }

    .content hr {
      border: none;
      border-top: 1px solid var(--color-border);
      margin: var(--space-md) 0;
    }

    /* 流式光标：插在最后一个文字末尾 */
    :host([streaming]) .content::after {
      content: "";
      display: inline-block;
      width: 2px;
      height: 0.9em;
      background: var(--color-primary);
      border-radius: 1px;
      margin-left: 2px;
      vertical-align: text-bottom;
      animation: cursor-blink 0.9s ease-in-out infinite;
    }

    @keyframes cursor-blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0; }
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
