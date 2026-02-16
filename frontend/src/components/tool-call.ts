// 工具调用折叠面板组件
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ContentBlock } from "../api.js";

export interface ToolResult {
  content: unknown;
  isError?: boolean;
}

@customElement("cm-tool-call")
export class ToolCall extends LitElement {
  @property({ type: Object }) toolUse!: ContentBlock;
  @property({ type: Object }) result: ToolResult | null = null;

  static styles = css`
    :host {
      display: block;
      margin-bottom: var(--space-sm);
    }

    details {
      border: 1px solid var(--color-tool-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }

    summary {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      background: var(--color-tool-bg);
      cursor: pointer;
      font-size: var(--font-size-sm);
      user-select: none;
      list-style: none;
    }

    summary::-webkit-details-marker { display: none; }

    summary::before {
      content: "▶";
      font-size: 10px;
      color: var(--color-text-muted);
      transition: transform 0.15s;
    }

    details[open] summary::before {
      transform: rotate(90deg);
    }

    .tool-name {
      font-weight: 600;
      color: var(--color-primary);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      background: var(--color-border-light);
      padding: 1px 6px;
      border-radius: 4px;
    }

    .tool-desc {
      color: var(--color-text-secondary);
      font-size: var(--font-size-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .content-area {
      border-top: 1px solid var(--color-tool-border);
    }

    .section {
      padding: var(--space-sm) var(--space-md);
    }

    .section-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-bottom: var(--space-xs);
      font-weight: 500;
    }

    pre {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 300px;
      overflow-y: auto;
      background: #f8f9fa;
      padding: var(--space-sm);
      border-radius: 4px;
      margin: 0;
    }

    .error pre {
      background: var(--color-diff-del-bg);
      color: var(--color-diff-del-text);
    }
  `;

  private _getDescription(): string {
    const input = this.toolUse.input;
    if (!input) return "";
    if (input["command"]) return String(input["command"]).slice(0, 80);
    if (input["file_path"]) return String(input["file_path"]);
    if (input["pattern"]) return String(input["pattern"]);
    if (input["query"]) return String(input["query"]).slice(0, 80);
    if (input["url"]) return String(input["url"]).slice(0, 80);
    if (input["description"]) return String(input["description"]).slice(0, 80);
    return "";
  }

  private _formatContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (content === null || content === undefined) return "";
    return JSON.stringify(content, null, 2);
  }

  render() {
    return html`
      <details>
        <summary>
          <span class="tool-name">${this.toolUse.name || "Tool"}</span>
          <span class="tool-desc">${this._getDescription()}</span>
        </summary>
        <div class="content-area">
          <div class="section">
            <div class="section-label">输入</div>
            <pre>${JSON.stringify(this.toolUse.input, null, 2)}</pre>
          </div>
          ${this.result ? html`
            <div class="section ${this.result.isError ? "error" : ""}">
              <div class="section-label">${this.result.isError ? "错误" : "输出"}</div>
              <pre>${this._formatContent(this.result.content)}</pre>
            </div>
          ` : nothing}
        </div>
      </details>
    `;
  }
}
