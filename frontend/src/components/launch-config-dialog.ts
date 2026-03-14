// 会话启动配置对话框：选择模型、权限模式、工具权限、预算、轮数、系统提示、额外目录
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { MODEL_OPTIONS, PERMISSION_MODES, TOOL_PRESETS } from "../utils/constants.js";

export interface LaunchConfig {
  model: string;
  permissionMode: string;
  allowedTools: string[];
  maxBudgetUsd: number | null;
  maxTurns: number | null;
  appendSystemPrompt: string;
  addDirs: string[];
}

@customElement("cm-launch-config-dialog")
export class LaunchConfigDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  /** 预填充配置（后端 launch_config 格式，snake_case） */
  @property({ type: Object }) initialConfig: Record<string, unknown> | null = null;

  @state() private _model = "";
  @state() private _permissionMode = "default";
  @state() private _toolPreset = 0;
  @state() private _customTools = "";
  @state() private _maxBudget = "";
  @state() private _maxTurns = "";
  @state() private _systemPrompt = "";
  @state() private _addDirs = "";

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 300;
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
      max-width: 520px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .dialog-header {
      padding: var(--space-md) var(--space-lg);
      border-bottom: 1px solid var(--color-border);
      font-size: var(--font-size-base);
      font-weight: 600;
    }

    .dialog-body {
      padding: var(--space-md) var(--space-lg);
      display: flex;
      flex-direction: column;
      gap: var(--space-lg);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .label {
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--color-text);
    }

    .hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .btn-group {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }

    .btn-option {
      padding: var(--space-xs) var(--space-md);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: none;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
    }

    .btn-option[data-selected] {
      background: var(--color-primary);
      color: white;
      border-color: var(--color-primary);
    }

    .btn-option:hover:not([data-selected]) {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    input, textarea {
      padding: var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      background: var(--color-bg);
      color: var(--color-text);
      font-family: inherit;
    }

    input:focus, textarea:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    textarea {
      resize: vertical;
      min-height: 60px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-md);
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-sm);
      padding: var(--space-md) var(--space-lg);
      border-top: 1px solid var(--color-border);
    }

    .btn {
      padding: var(--space-sm) var(--space-lg);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      border: none;
    }

    .btn-cancel {
      background: none;
      color: var(--color-text-secondary);
      border: 1px solid var(--color-border);
    }

    .btn-cancel:hover {
      border-color: var(--color-text-muted);
      color: var(--color-text);
    }

    .btn-start {
      background: var(--color-primary);
      color: white;
    }

    .btn-start:hover {
      background: var(--color-primary-hover);
    }

    @media (max-width: 600px) {
      .row {
        grid-template-columns: 1fr;
      }
    }
  `;

  protected override updated(changed: Map<PropertyKey, unknown>) {
    if (changed.has("open") && this.open && this.initialConfig) {
      const c = this.initialConfig;
      this._model = (c.model as string) ?? "";
      this._permissionMode = (c.permission_mode as string) ?? "default";
      const budget = c.max_budget_usd as number | null | undefined;
      this._maxBudget = budget != null ? String(budget) : "";
      const turns = c.max_turns as number | null | undefined;
      this._maxTurns = turns != null ? String(turns) : "";
      this._systemPrompt = (c.append_system_prompt as string) ?? "";
      this._addDirs = ((c.add_dirs as string[] | null) ?? []).join("\n");

      // 工具预设：匹配已知预设或设为自定义
      const tools = c.allowed_tools as string[] | null | undefined;
      if (!tools || tools.length === 0) {
        this._toolPreset = 0;
      } else {
        const presetIdx = TOOL_PRESETS.findIndex(
          (p) => p.tools.length === tools.length && p.tools.every((t) => tools.includes(t))
        );
        if (presetIdx >= 0) {
          this._toolPreset = presetIdx;
        } else {
          this._toolPreset = TOOL_PRESETS.length;
          this._customTools = tools.join(", ");
        }
      }
    }
  }

  private _cancel() {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
  }

  private _start() {
    const preset = TOOL_PRESETS[this._toolPreset];
    const allowedTools =
      this._toolPreset === 0
        ? []
        : this._customTools.trim()
          ? this._customTools.split(",").map((t) => t.trim()).filter(Boolean)
          : preset.tools;

    const addDirs = this._addDirs
      .split("\n")
      .map((d) => d.trim())
      .filter(Boolean);

    const config: LaunchConfig = {
      model: this._model,
      permissionMode: this._permissionMode,
      allowedTools,
      maxBudgetUsd: this._maxBudget ? parseFloat(this._maxBudget) : null,
      maxTurns: this._maxTurns ? parseInt(this._maxTurns, 10) : null,
      appendSystemPrompt: this._systemPrompt.trim(),
      addDirs,
    };
    this.dispatchEvent(
      new CustomEvent("start", { detail: config, bubbles: true, composed: true })
    );
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._cancel(); }}>
        <div class="dialog">
          <div class="dialog-header">启动配置</div>
          <div class="dialog-body">

            <!-- 模型选择 -->
            <div class="field">
              <div class="label">模型</div>
              <div class="btn-group">
                ${MODEL_OPTIONS.map(({ value, label }) => html`
                  <button
                    class="btn-option"
                    ?data-selected=${this._model === value}
                    @click=${() => { this._model = value; }}
                  >${label}</button>
                `)}
              </div>
            </div>

            <!-- 权限模式 -->
            <div class="field">
              <div class="label">权限模式</div>
              <div class="btn-group">
                ${PERMISSION_MODES.map(({ value, label }) => html`
                  <button
                    class="btn-option"
                    ?data-selected=${this._permissionMode === value}
                    @click=${() => { this._permissionMode = value; }}
                  >${label}</button>
                `)}
              </div>
            </div>

            <!-- 工具权限 -->
            <div class="field">
              <div class="label">工具权限预设</div>
              <div class="btn-group">
                ${TOOL_PRESETS.map(({ label }, i) => html`
                  <button
                    class="btn-option"
                    ?data-selected=${this._toolPreset === i}
                    @click=${() => { this._toolPreset = i; }}
                  >${label}</button>
                `)}
                <button
                  class="btn-option"
                  ?data-selected=${this._toolPreset === TOOL_PRESETS.length}
                  @click=${() => { this._toolPreset = TOOL_PRESETS.length; }}
                >自定义</button>
              </div>
              ${this._toolPreset === TOOL_PRESETS.length ? html`
                <input
                  type="text"
                  placeholder="逗号分隔，如 Read, Bash(git *)"
                  .value=${this._customTools}
                  @input=${(e: Event) => { this._customTools = (e.target as HTMLInputElement).value; }}
                />
                <div class="hint">支持 pattern 匹配，如 Bash(git *)</div>
              ` : nothing}
            </div>

            <!-- 预算 & 轮数 -->
            <div class="row">
              <div class="field">
                <div class="label">最大花费 (USD)</div>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="不限"
                  .value=${this._maxBudget}
                  @input=${(e: Event) => { this._maxBudget = (e.target as HTMLInputElement).value; }}
                />
              </div>
              <div class="field">
                <div class="label">最大轮数</div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="不限"
                  .value=${this._maxTurns}
                  @input=${(e: Event) => { this._maxTurns = (e.target as HTMLInputElement).value; }}
                />
              </div>
            </div>

            <!-- 附加系统提示 -->
            <div class="field">
              <div class="label">附加系统提示（可选）</div>
              <textarea
                placeholder="追加到默认系统提示之后..."
                .value=${this._systemPrompt}
                @input=${(e: Event) => { this._systemPrompt = (e.target as HTMLTextAreaElement).value; }}
              ></textarea>
            </div>

            <!-- 额外可访问目录 -->
            <div class="field">
              <div class="label">额外可访问目录（--add-dir）</div>
              <textarea
                placeholder="每行一个路径，如&#10;/mnt/data1/starrick/dataset&#10;/home/user/data"
                .value=${this._addDirs}
                @input=${(e: Event) => { this._addDirs = (e.target as HTMLTextAreaElement).value; }}
              ></textarea>
              <div class="hint">允许 Claude 访问项目目录以外的路径</div>
            </div>

          </div>
          <div class="dialog-actions">
            <button class="btn btn-cancel" @click=${this._cancel}>取消</button>
            <button class="btn btn-start" @click=${this._start}>启动会话</button>
          </div>
        </div>
      </div>
    `;
  }
}
