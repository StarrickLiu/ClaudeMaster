// 新建会话对话框：选择项目 + 启动配置
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { Project, AgentInfo } from "../api.js";
import type { LaunchConfig } from "./launch-config-dialog.js";
import { MODEL_OPTIONS, PERMISSION_MODES, TOOL_PRESETS } from "../utils/constants.js";

export interface NewSessionConfig extends LaunchConfig {
  projectPath: string;
  name: string;
  agentId?: string;
}

@customElement("cm-new-session-dialog")
export class NewSessionDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  /** 预选远程 agent（从外部传入） */
  @property({ attribute: false }) initialAgentId = "";
  /** 预填项目路径（从外部传入） */
  @property({ attribute: false }) initialPath = "";

  @state() private _projects: Project[] = [];
  @state() private _projectsLoading = false;
  @state() private _selectedProject = "";   // encoded_name 或 "__custom__"
  @state() private _name = "";
  @state() private _customPath = "";
  @state() private _agents: AgentInfo[] = [];
  @state() private _selectedAgent = "";     // "" = 本机，agent_id = 远程
  @state() private _model = "";
  @state() private _permissionMode = "default";
  @state() private _toolPreset = 0;
  @state() private _customTools = "";
  @state() private _maxBudget = "";
  @state() private _maxTurns = "";
  @state() private _systemPrompt = "";
  @state() private _addDirs = "";
  @state() private _showAdvanced = false;

  static styles = css`
    :host { display: block; }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
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
      max-width: 540px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .dialog-header {
      padding: var(--space-md) var(--space-lg);
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }

    .dialog-title {
      font-size: var(--font-size-base);
      font-weight: 600;
      flex: 1;
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

    .project-select-row {
      display: flex;
      gap: var(--space-sm);
    }

    select, input, textarea {
      padding: var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      background: var(--color-bg);
      color: var(--color-text);
      font-family: inherit;
      outline: none;
    }

    select:focus, input:focus, textarea:focus {
      border-color: var(--color-primary);
    }

    select {
      flex: 1;
      cursor: pointer;
    }

    input {
      width: 100%;
    }

    textarea {
      resize: vertical;
      min-height: 60px;
      width: 100%;
    }

    .divider {
      border: none;
      border-top: 1px solid var(--color-border-light);
    }

    .advanced-toggle {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
    }

    .advanced-toggle:hover {
      color: var(--color-primary);
    }

    .advanced-arrow {
      font-size: 10px;
      transition: transform 0.15s;
    }

    .advanced-arrow.open {
      transform: rotate(90deg);
    }

    .advanced-content {
      display: flex;
      flex-direction: column;
      gap: var(--space-lg);
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

    .btn-start:hover:not(:disabled) {
      background: var(--color-primary-hover);
    }

    .btn-start:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    @media (max-width: 600px) {
      .row { grid-template-columns: 1fr; }
    }
  `;

  /** 打开时自动加载项目列表，并应用预选参数 */
  updated(changed: Map<string, unknown>) {
    if (changed.has("open") && this.open) {
      if (this._projects.length === 0) {
        this._loadProjects();
      }
      // 应用外部预选参数
      if (this.initialAgentId) {
        this._selectedAgent = this.initialAgentId;
        this._selectedProject = "__custom__";
      }
      if (this.initialPath) {
        this._selectedProject = "__custom__";
        this._customPath = this.initialPath;
      }
    }
  }

  private async _loadProjects() {
    this._projectsLoading = true;
    try {
      const [projects, agents] = await Promise.all([
        api.getProjects(),
        api.getAgents().catch(() => [] as AgentInfo[]),
      ]);
      this._projects = projects;
      this._agents = agents.filter(a => a.state === "connected" && a.mode === "daemon");
      if (this._projects.length > 0 && !this._selectedProject) {
        this._selectedProject = this._projects[0].encoded_name;
      }
    } catch (e) {
      console.error("加载项目失败:", e);
    }
    this._projectsLoading = false;
  }

  private _resolveProjectPath(): string {
    if (this._selectedProject === "__custom__") {
      return this._customPath.trim();
    }
    const proj = this._projects.find(p => p.encoded_name === this._selectedProject);
    return proj?.path ?? "";
  }

  private _cancel() {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
  }

  private _start() {
    const projectPath = this._resolveProjectPath();
    if (!projectPath) return;

    const preset = TOOL_PRESETS[this._toolPreset];
    const allowedTools =
      this._toolPreset === 0
        ? []
        : this._customTools.trim()
          ? this._customTools.split(",").map((t) => t.trim()).filter(Boolean)
          : preset.tools;

    const addDirs = this._addDirs.split("\n").map((d) => d.trim()).filter(Boolean);

    const config: NewSessionConfig = {
      projectPath,
      name: this._name.trim(),
      model: this._model,
      permissionMode: this._permissionMode,
      allowedTools,
      maxBudgetUsd: this._maxBudget ? parseFloat(this._maxBudget) : null,
      maxTurns: this._maxTurns ? parseInt(this._maxTurns, 10) : null,
      appendSystemPrompt: this._systemPrompt.trim(),
      addDirs,
      agentId: this._selectedAgent || undefined,
    };
    this.dispatchEvent(
      new CustomEvent("start", { detail: config, bubbles: true, composed: true })
    );
  }

  render() {
    if (!this.open) return nothing;

    const projectPath = this._resolveProjectPath();
    const canStart = !!projectPath;

    return html`
      <div class="overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._cancel(); }}>
        <div class="dialog">
          <div class="dialog-header">
            <span class="dialog-title">新建会话</span>
          </div>
          <div class="dialog-body">

            <!-- 运行位置 -->
            ${this._agents.length > 0 ? html`
              <div class="field">
                <div class="label">运行位置</div>
                <select
                  @change=${(e: Event) => {
                    this._selectedAgent = (e.target as HTMLSelectElement).value;
                    // 选择远程 agent 时强制使用自定义路径
                    if (this._selectedAgent) {
                      this._selectedProject = "__custom__";
                    }
                  }}
                >
                  <option value="" ?selected=${!this._selectedAgent}>本机</option>
                  ${this._agents.map(a => html`
                    <option value=${a.agent_id} ?selected=${this._selectedAgent === a.agent_id}>
                      ${a.hostname}${a.allowed_paths.length > 0 ? ` (${a.allowed_paths.length} 个目录)` : ""}
                    </option>
                  `)}
                </select>
                ${this._selectedAgent ? html`
                  <div class="hint">
                    ${(() => {
                      const agent = this._agents.find(a => a.agent_id === this._selectedAgent);
                      if (!agent) return "";
                      return agent.allowed_paths.length > 0
                        ? `允许目录：${agent.allowed_paths.join("、")}`
                        : "不限制目录";
                    })()}
                  </div>
                ` : nothing}
              </div>
            ` : nothing}

            <!-- 项目选择 -->
            <div class="field">
              <div class="label">选择项目</div>
              <div class="project-select-row">
                <select
                  @change=${(e: Event) => { this._selectedProject = (e.target as HTMLSelectElement).value; }}
                  ?disabled=${this._projectsLoading}
                >
                  ${this._projectsLoading
                    ? html`<option>加载中...</option>`
                    : html`
                        ${this._projects.map(p => html`
                          <option value=${p.encoded_name} ?selected=${this._selectedProject === p.encoded_name}>
                            ${p.name}
                          </option>
                        `)}
                        <option value="__custom__" ?selected=${this._selectedProject === "__custom__"}>
                          自定义路径...
                        </option>
                      `}
                </select>
              </div>
              ${this._selectedProject === "__custom__" ? html`
                <input
                  type="text"
                  placeholder="/home/user/my-project"
                  .value=${this._customPath}
                  @input=${(e: Event) => { this._customPath = (e.target as HTMLInputElement).value; }}
                />
              ` : nothing}
              ${projectPath && this._selectedProject !== "__custom__" ? html`
                <div class="hint">${projectPath}</div>
              ` : nothing}
            </div>

            <!-- 会话名称 -->
            <div class="field">
              <div class="label">会话名称</div>
              <input
                type="text"
                placeholder="留空自动生成，如 swift-fox"
                .value=${this._name}
                @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}
              />
            </div>

            <hr class="divider" />

            <!-- 高级配置折叠面板 -->
            <button class="advanced-toggle" @click=${() => { this._showAdvanced = !this._showAdvanced; }}>
              <span class="advanced-arrow ${this._showAdvanced ? "open" : ""}">▶</span>
              高级配置（可选）
            </button>

            ${this._showAdvanced ? html`
              <div class="advanced-content">
                <!-- 模型 -->
                <div class="field">
                  <div class="label">模型</div>
                  <div class="btn-group">
                    ${MODEL_OPTIONS.map(({ value, label }) => html`
                      <button class="btn-option" ?data-selected=${this._model === value}
                        @click=${() => { this._model = value; }}>${label}</button>
                    `)}
                  </div>
                </div>

                <!-- 权限模式 -->
                <div class="field">
                  <div class="label">权限模式</div>
                  <div class="btn-group">
                    ${PERMISSION_MODES.map(({ value, label }) => html`
                      <button class="btn-option" ?data-selected=${this._permissionMode === value}
                        @click=${() => { this._permissionMode = value; }}>${label}</button>
                    `)}
                  </div>
                </div>

                <!-- 工具权限 -->
                <div class="field">
                  <div class="label">工具权限预设</div>
                  <div class="btn-group">
                    ${TOOL_PRESETS.map(({ label }, i) => html`
                      <button class="btn-option" ?data-selected=${this._toolPreset === i}
                        @click=${() => { this._toolPreset = i; }}>${label}</button>
                    `)}
                    <button class="btn-option" ?data-selected=${this._toolPreset === TOOL_PRESETS.length}
                      @click=${() => { this._toolPreset = TOOL_PRESETS.length; }}>自定义</button>
                  </div>
                  ${this._toolPreset === TOOL_PRESETS.length ? html`
                    <input type="text" placeholder="逗号分隔，如 Read, Bash(git *)"
                      .value=${this._customTools}
                      @input=${(e: Event) => { this._customTools = (e.target as HTMLInputElement).value; }}
                    />
                  ` : nothing}
                </div>

                <!-- 预算 & 轮数 -->
                <div class="row">
                  <div class="field">
                    <div class="label">最大花费 (USD)</div>
                    <input type="number" min="0" step="0.1" placeholder="不限"
                      .value=${this._maxBudget}
                      @input=${(e: Event) => { this._maxBudget = (e.target as HTMLInputElement).value; }}
                    />
                  </div>
                  <div class="field">
                    <div class="label">最大轮数</div>
                    <input type="number" min="1" step="1" placeholder="不限"
                      .value=${this._maxTurns}
                      @input=${(e: Event) => { this._maxTurns = (e.target as HTMLInputElement).value; }}
                    />
                  </div>
                </div>

                <!-- 附加系统提示 -->
                <div class="field">
                  <div class="label">附加系统提示（可选）</div>
                  <textarea placeholder="追加到默认系统提示之后..."
                    .value=${this._systemPrompt}
                    @input=${(e: Event) => { this._systemPrompt = (e.target as HTMLTextAreaElement).value; }}
                  ></textarea>
                </div>

                <!-- 额外可访问目录 -->
                <div class="field">
                  <div class="label">额外可访问目录（--add-dir）</div>
                  <textarea placeholder="每行一个路径"
                    .value=${this._addDirs}
                    @input=${(e: Event) => { this._addDirs = (e.target as HTMLTextAreaElement).value; }}
                  ></textarea>
                  <div class="hint">允许 Claude 访问项目目录以外的路径</div>
                </div>
              </div>
            ` : nothing}

          </div>
          <div class="dialog-actions">
            <button class="btn btn-cancel" @click=${this._cancel}>取消</button>
            <button class="btn btn-start" ?disabled=${!canStart} @click=${this._start}>
              启动
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
