// 工具权限确认弹窗：显示工具名和输入，允许/拒绝；AskUserQuestion 特殊展示
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PermissionRequest } from "../services/chat-client.js";

interface QuestionEntry {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

@customElement("cm-permission-dialog")
export class PermissionDialog extends LitElement {
  @property({ type: Object }) request: PermissionRequest | null = null;
  @state() private _answers: Record<string, string> = {};

  override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (changed.has("request")) {
      this._answers = {};
    }
  }

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-md);
    }

    .dialog {
      background: var(--color-surface);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      width: 100%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
    }

    .dialog-header {
      padding: var(--space-md);
      border-bottom: 1px solid var(--color-border);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }

    .tool-badge {
      background: var(--color-attention-bg);
      color: var(--color-attention);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
    }

    .dialog-body {
      padding: var(--space-md);
    }

    .label {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-bottom: var(--space-xs);
    }

    pre {
      background: var(--color-border-light);
      padding: var(--space-sm);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      overflow-x: auto;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
    }

    .actions {
      display: flex;
      gap: var(--space-sm);
      justify-content: flex-end;
      padding: var(--space-md);
      border-top: 1px solid var(--color-border);
    }

    .btn {
      padding: var(--space-sm) var(--space-lg);
      border-radius: var(--radius-sm);
      font-weight: 500;
      font-size: var(--font-size-sm);
      cursor: pointer;
      border: none;
    }

    .btn-approve {
      background: var(--color-working);
      color: white;
    }

    .btn-always {
      background: var(--color-primary);
      color: white;
    }

    .btn-deny {
      background: none;
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }

    .btn:hover {
      opacity: 0.85;
    }

    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* AskUserQuestion 选项按钮 */
    .option-btn {
      background: var(--color-border-light);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      text-align: left;
      padding: var(--space-sm) var(--space-md);
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: background 0.15s, border-color 0.15s;
    }

    .option-btn:hover {
      background: var(--color-surface);
      border-color: var(--color-primary);
      opacity: 1;
    }

    .option-btn.selected {
      background: var(--color-primary-bg, rgba(59,130,246,0.1));
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .opt-label {
      font-weight: 500;
    }

    .opt-desc {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      font-weight: 400;
    }

    .question-section {
      margin-bottom: var(--space-md);
    }

    .question-section:last-child {
      margin-bottom: 0;
    }

    .question-text {
      font-size: var(--font-size-sm);
      font-weight: 500;
      margin-bottom: var(--space-sm);
      line-height: 1.5;
    }

    .options-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    @media (max-width: 768px) {
      .dialog {
        max-width: none;
        margin: var(--space-sm);
      }
    }
  `;

  private _approve(always = false) {
    if (!this.request) return;
    this.dispatchEvent(
      new CustomEvent("approve", {
        detail: {
          requestId: this.request.requestId,
          input: this.request.input,
          always,
          toolName: this.request.toolName,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _deny() {
    if (!this.request) return;
    this.dispatchEvent(
      new CustomEvent("deny", {
        detail: this.request.requestId,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _selectOption(q: QuestionEntry, label: string) {
    this._answers = { ...this._answers, [q.question]: label };
    // 只有一个问题时，选择即提交
    const questions = this.request?.input["questions"] as QuestionEntry[] | undefined;
    if (questions && questions.length === 1) {
      this._submitAnswers();
    }
  }

  private _submitAnswers() {
    if (!this.request) return;
    const questions =
      (this.request.input["questions"] as QuestionEntry[] | undefined) ?? [];
    this.dispatchEvent(
      new CustomEvent("answer", {
        detail: {
          requestId: this.request.requestId,
          // updatedInput 格式：{ questions: [...], answers: { "问题文本": "选项标签" } }
          updatedInput: { questions, answers: this._answers },
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.request) return nothing;

    // ── AskUserQuestion：展示结构化问题和选项 ──
    if (this.request.toolName === "AskUserQuestion") {
      const questions = this.request.input["questions"] as QuestionEntry[] | undefined;

      if (!questions || questions.length === 0) {
        // fallback：用 JSON 展示原始 input
        return html`
          <div class="overlay">
            <div class="dialog">
              <div class="dialog-header">Claude 提问 <span class="tool-badge">AskUserQuestion</span></div>
              <div class="dialog-body">
                <div class="label">原始输入</div>
                <pre>${JSON.stringify(this.request.input, null, 2)}</pre>
              </div>
              <div class="actions">
                <button class="btn btn-deny" @click=${this._deny}>取消</button>
              </div>
            </div>
          </div>
        `;
      }

      const allAnswered = questions.every((q) => this._answers[q.question]);

      return html`
        <div class="overlay">
          <div class="dialog">
            <div class="dialog-header">
              Claude 提问
              <span class="tool-badge">AskUserQuestion</span>
            </div>
            <div class="dialog-body">
              ${questions.map(
                (q) => html`
                  <div class="question-section">
                    <div class="question-text">${q.question}</div>
                    <div class="options-list">
                      ${q.options.map(
                        (opt) => html`
                          <button
                            class="btn option-btn ${this._answers[q.question] === opt.label ? "selected" : ""}"
                            @click=${() => this._selectOption(q, opt.label)}
                          >
                            <span class="opt-label">${opt.label}</span>
                            ${opt.description
                              ? html`<span class="opt-desc">${opt.description}</span>`
                              : nothing}
                          </button>
                        `
                      )}
                    </div>
                  </div>
                `
              )}
            </div>
            <div class="actions">
              <button class="btn btn-deny" @click=${this._deny}>取消</button>
              ${questions.length > 1
                ? html`
                    <button
                      class="btn btn-approve"
                      ?disabled=${!allAnswered}
                      @click=${this._submitAnswers}
                    >
                      提交
                    </button>
                  `
                : nothing}
            </div>
          </div>
        </div>
      `;
    }

    // ── 普通工具权限请求 ──
    return html`
      <div class="overlay">
        <div class="dialog">
          <div class="dialog-header">
            Claude 请求使用工具
            <span class="tool-badge">${this.request.toolName}</span>
          </div>
          <div class="dialog-body">
            <div class="label">工具输入</div>
            <pre>${JSON.stringify(this.request.input, null, 2)}</pre>
          </div>
          <div class="actions">
            <button class="btn btn-deny" @click=${this._deny}>拒绝</button>
            <button class="btn btn-approve" @click=${() => this._approve(false)}>允许</button>
            <button class="btn btn-always" @click=${() => this._approve(true)}>始终允许</button>
          </div>
        </div>
      </div>
    `;
  }
}
