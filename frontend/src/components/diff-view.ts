// Git diff 视图组件
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("cm-diff-view")
export class DiffView extends LitElement {
  @property() diff = "";
  @property() stat = "";

  static styles = css`
    :host {
      display: block;
    }

    .stat {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      padding: var(--space-md);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      margin-bottom: var(--space-md);
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .diff-container {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      line-height: 1.6;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      overflow-x: auto;
    }

    .diff-line {
      padding: 1px var(--space-md);
      white-space: pre;
      min-height: 1.6em;
    }

    .add {
      background: var(--color-diff-add-bg);
      color: var(--color-diff-add-text);
    }

    .del {
      background: var(--color-diff-del-bg);
      color: var(--color-diff-del-text);
    }

    .hunk {
      background: #eef2ff;
      color: var(--color-diff-hunk);
      font-weight: 500;
      padding-top: var(--space-sm);
      padding-bottom: var(--space-sm);
      margin-top: var(--space-xs);
    }

    .file-header {
      background: var(--color-border-light);
      font-weight: 600;
      color: var(--color-text);
      padding-top: var(--space-sm);
      padding-bottom: var(--space-sm);
      border-top: 2px solid var(--color-border);
    }

    .file-header:first-child {
      border-top: none;
    }

    .empty {
      padding: var(--space-xl);
      text-align: center;
      color: var(--color-text-muted);
    }
  `;

  render() {
    if (!this.diff) {
      return html`<div class="empty">无代码变更</div>`;
    }

    return html`
      ${this.stat ? html`<pre class="stat">${this.stat}</pre>` : nothing}
      <div class="diff-container">
        ${this.diff.split("\n").map(line => {
          let cls = "ctx";
          if (line.startsWith("+++") || line.startsWith("---")) cls = "file-header";
          else if (line.startsWith("diff ")) cls = "file-header";
          else if (line.startsWith("@@")) cls = "hunk";
          else if (line.startsWith("+")) cls = "add";
          else if (line.startsWith("-")) cls = "del";
          return html`<div class="diff-line ${cls}">${line}</div>`;
        })}
      </div>
    `;
  }
}
