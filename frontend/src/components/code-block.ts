// 代码块显示组件（MVP 不做语法高亮）
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("cm-code-block")
export class CodeBlock extends LitElement {
  @property() code = "";
  @property() language = "";

  static styles = css`
    :host {
      display: block;
      margin: var(--space-sm) 0;
    }

    .wrapper {
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--color-border);
    }

    .header {
      background: #2d2d3f;
      padding: var(--space-xs) var(--space-md);
      font-size: var(--font-size-xs);
      color: #9ca3af;
      font-family: var(--font-mono);
    }

    pre {
      background: #1e1e2e;
      color: #cdd6f4;
      padding: var(--space-md);
      margin: 0;
      overflow-x: auto;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      line-height: 1.6;
    }
  `;

  render() {
    return html`
      <div class="wrapper">
        ${this.language ? html`<div class="header">${this.language}</div>` : ""}
        <pre><code>${this.code}</code></pre>
      </div>
    `;
  }
}
