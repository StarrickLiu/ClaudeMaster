// 思维过程折叠块组件
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("cm-thinking-block")
export class ThinkingBlock extends LitElement {
  @property() content = "";

  static styles = css`
    :host {
      display: block;
      margin-bottom: var(--space-sm);
    }

    details {
      border: 1px solid var(--color-border-light);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }

    summary {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      background: var(--color-thinking-bg);
      cursor: pointer;
      font-size: var(--font-size-xs);
      color: var(--color-thinking-text);
      font-style: italic;
      user-select: none;
      list-style: none;
    }

    summary::-webkit-details-marker { display: none; }

    summary::before {
      content: "▶";
      font-size: 10px;
      transition: transform 0.15s;
    }

    details[open] summary::before {
      transform: rotate(90deg);
    }

    .content {
      padding: var(--space-md);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      line-height: 1.7;
      max-height: 400px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      border-top: 1px solid var(--color-border-light);
    }
  `;

  render() {
    const preview = this.content.slice(0, 60).replace(/\n/g, " ");
    return html`
      <details>
        <summary>思维过程 — ${preview}...</summary>
        <div class="content">${this.content}</div>
      </details>
    `;
  }
}
