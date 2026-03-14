// 机器管理页面：列表 + 详情 + 改名 + 添加引导
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { AgentInfo } from "../api.js";
import { timeAgo } from "../utils/time.js";
import { formatUptime } from "../utils/format.js";

/** 统一进程类型：兼容本机 ClaudeProcess 和远程 RemoteProcess */
interface AgentProcess {
  pid: number;
  cwd: string;
  uptime_seconds: number;
  project_name: string | null;
  managed?: boolean;
  session_id?: string | null;
  git_branch?: string | null;
}

@customElement("cm-agents")
export class AgentsPage extends LitElement {
  @state() agents: AgentInfo[] = [];
  @state() loading = true;
  @state() private _selectedAgentId = "";
  @state() private _agentProcesses: AgentProcess[] = [];
  @state() private _editingName = false;
  @state() private _editNameValue = "";
  @state() private _showAddDialog = false;

  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host { display: block; }

    .page-header {
      display: flex; align-items: center; margin-bottom: var(--space-xl); gap: var(--space-md);
    }
    .page-title { font-size: var(--font-size-xl); font-weight: 700; flex: 1; color: var(--color-text); }
    .add-btn {
      padding: var(--space-sm) var(--space-md); background: var(--color-primary); color: white;
      border: none; border-radius: var(--radius-sm); font-size: var(--font-size-sm);
      font-weight: 500; cursor: pointer; white-space: nowrap;
    }
    .add-btn:hover { background: var(--color-primary-hover); }

    .loading, .empty { text-align: center; padding: var(--space-2xl); color: var(--color-text-muted); }

    /* Agent 列表 */
    .agent-list { display: flex; flex-direction: column; gap: var(--space-sm); }
    .agent-item {
      background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: var(--radius-md); padding: var(--space-md) var(--space-lg);
      cursor: pointer; transition: box-shadow 0.15s; display: flex; align-items: center; gap: var(--space-md);
    }
    .agent-item:hover { box-shadow: 0 0 0 2px var(--color-primary); }
    .agent-item[data-active] { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary); }

    .agent-dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    }
    .agent-dot.online { background: var(--color-standby); }
    .agent-dot.offline { background: var(--color-text-muted); opacity: 0.4; }

    .agent-info { flex: 1; min-width: 0; }
    .agent-name { font-weight: 600; font-size: var(--font-size-base); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-hostname {
      font-size: var(--font-size-xs); color: var(--color-text-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px;
    }
    .agent-meta {
      font-size: var(--font-size-xs); color: var(--color-text-muted);
      white-space: nowrap; text-align: right;
    }

    .local-tag {
      background: var(--color-border-light); color: var(--color-text-muted);
      font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: var(--radius-sm);
    }
    .remote-tag {
      background: var(--color-primary-bg, #dbeafe); color: var(--color-primary, #2563eb);
      font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: var(--radius-sm);
    }
    .latency-tag {
      font-size: var(--font-size-xs); color: var(--color-text-muted);
    }

    /* 无远程 agent 引导 */
    .guide-banner {
      background: var(--color-surface); border: 1px dashed var(--color-border);
      border-radius: var(--radius-md); padding: var(--space-lg);
      text-align: center; color: var(--color-text-muted); font-size: var(--font-size-sm);
      margin-top: var(--space-md); line-height: 1.6;
    }
    .guide-banner a { color: var(--color-primary); cursor: pointer; text-decoration: underline; }

    /* 详情面板 */
    .detail-panel {
      background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: var(--radius-md); padding: var(--space-lg); margin-top: var(--space-md);
    }
    .detail-header {
      display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-lg);
    }
    .back-btn {
      background: none; border: none; cursor: pointer; font-size: var(--font-size-base);
      color: var(--color-text-muted); padding: var(--space-xs);
    }
    .back-btn:hover { color: var(--color-text); }
    .detail-name { font-size: var(--font-size-lg); font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .edit-name-btn {
      background: none; border: none; cursor: pointer; font-size: var(--font-size-sm);
      color: var(--color-text-muted); padding: var(--space-xs); flex-shrink: 0;
    }
    .edit-name-btn:hover { color: var(--color-primary); }
    .edit-name-input {
      font-size: var(--font-size-lg); font-weight: 700; border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm); padding: 2px var(--space-sm); flex: 1;
      background: var(--color-bg); color: var(--color-text);
    }
    .edit-name-actions { display: flex; gap: var(--space-xs); }
    .edit-save-btn, .edit-cancel-btn {
      padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-sm);
      font-size: var(--font-size-xs); cursor: pointer; border: 1px solid var(--color-border);
      background: none; color: var(--color-text);
    }
    .edit-save-btn { background: var(--color-primary); color: white; border-color: var(--color-primary); }

    .info-grid {
      display: grid; grid-template-columns: auto 1fr; gap: var(--space-xs) var(--space-lg);
      font-size: var(--font-size-sm); margin-bottom: var(--space-lg);
    }
    .info-label { color: var(--color-text-muted); }
    .info-value { color: var(--color-text); word-break: break-all; }

    .section-label {
      font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text);
      margin-bottom: var(--space-sm); padding-bottom: var(--space-xs);
      border-bottom: 1px solid var(--color-border);
    }

    .process-list { margin-bottom: var(--space-lg); }
    .process-row {
      display: flex; align-items: center; gap: var(--space-md);
      padding: var(--space-sm) 0; font-size: var(--font-size-sm);
    }
    .process-row:not(:last-child) { border-bottom: 1px solid var(--color-border-subtle, rgba(0,0,0,0.06)); }
    .process-name { font-weight: 500; min-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .process-cwd { flex: 1; font-size: var(--font-size-xs); color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .process-meta { color: var(--color-text-muted); font-size: var(--font-size-xs); white-space: nowrap; }
    .branch-tag {
      background: var(--color-border-light); padding: 1px 6px; border-radius: var(--radius-sm);
      font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--color-text-muted);
      white-space: nowrap; max-width: 100px; overflow: hidden; text-overflow: ellipsis;
    }

    /* 添加机器对话框 */
    .dialog-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200;
      display: flex; align-items: center; justify-content: center; padding: var(--space-lg);
    }
    .dialog {
      background: var(--color-surface); border-radius: var(--radius-lg);
      padding: var(--space-xl); max-width: 520px; width: 100%;
      box-shadow: var(--shadow-lg);
    }
    .dialog-title { font-size: var(--font-size-lg); font-weight: 700; margin-bottom: var(--space-md); }
    .dialog-text { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--space-md); line-height: 1.6; }
    .code-block {
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); padding: var(--space-md);
      font-family: var(--font-mono); font-size: var(--font-size-xs);
      white-space: pre-wrap; word-break: break-all; line-height: 1.6;
      margin-bottom: var(--space-md);
    }
    .dialog-close {
      padding: var(--space-sm) var(--space-lg); background: none; border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm);
      color: var(--color-text);
    }
    .dialog-close:hover { background: var(--color-border-light); }

    .empty-processes { font-size: var(--font-size-sm); color: var(--color-text-muted); padding: var(--space-md) 0; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._pollTimer = setInterval(() => this._poll(), 10000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) clearInterval(this._pollTimer);
  }

  private async _poll() {
    try {
      this.agents = await api.getAgents();
      if (this._selectedAgentId) {
        this._agentProcesses = await api.getAgentProcesses(this._selectedAgentId).catch(() => []);
      }
    } catch { /* 静默 */ }
  }

  private async _load() {
    this.loading = true;
    try {
      this.agents = await api.getAgents();
    } catch (e) {
      console.error("加载 Agent 列表失败:", e);
    }
    this.loading = false;
  }

  private async _selectAgent(agentId: string) {
    this._selectedAgentId = agentId;
    this._editingName = false;
    try {
      this._agentProcesses = await api.getAgentProcesses(agentId);
    } catch {
      this._agentProcesses = [];
    }
  }

  private _startEditName(current: string) {
    this._editNameValue = current;
    this._editingName = true;
  }

  private async _saveName(agentId: string) {
    const newName = this._editNameValue.trim();
    if (!newName) return;
    try {
      await api.updateAgent(agentId, { display_name: newName });
      this._editingName = false;
      await this._load();
    } catch (e) {
      console.error("改名失败:", e);
    }
  }

  private _getServerUrl(): string {
    return `wss://${window.location.host}`;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">加载中...</div>`;
    }

    const selectedAgent = this.agents.find(a => a.agent_id === this._selectedAgentId);
    const hasRemote = this.agents.some(a => a.type !== "local");

    return html`
      <div class="page-header">
        <span class="page-title">机器管理</span>
        <button class="add-btn" @click=${() => { this._showAddDialog = true; }}>+ 添加机器</button>
      </div>

      ${this._showAddDialog ? this._renderAddDialog() : nothing}

      <div class="agent-list">
        ${this.agents.map(agent => this._renderAgentItem(agent))}
      </div>

      ${!hasRemote ? html`
        <div class="guide-banner">
          目前只有本机一台机器。<a @click=${() => { this._showAddDialog = true; }}>添加远程机器</a>，即可在此统一管理所有 Claude Code 会话。
        </div>
      ` : nothing}

      ${selectedAgent ? this._renderDetail(selectedAgent) : nothing}
    `;
  }

  private _renderAgentItem(agent: AgentInfo) {
    const isOnline = agent.state === "online" || agent.state === "connected";
    const isLocal = agent.type === "local";
    const isSelected = agent.agent_id === this._selectedAgentId;

    return html`
      <div class="agent-item" ?data-active=${isSelected}
           @click=${() => this._selectAgent(agent.agent_id)}>
        <span class="agent-dot ${isOnline ? 'online' : 'offline'}"></span>
        <div class="agent-info">
          <div class="agent-name" title=${agent.display_name || agent.hostname}>${agent.display_name || agent.hostname}</div>
          ${agent.display_name && agent.display_name !== agent.hostname
            ? html`<div class="agent-hostname" title=${agent.hostname}>${agent.hostname}</div>`
            : nothing}
        </div>
        ${isLocal ? html`<span class="local-tag">本机</span>` : html`<span class="remote-tag">远程</span>`}
        ${!isLocal && isOnline && agent.latency_ms > 0
          ? html`<span class="latency-tag">${Math.round(agent.latency_ms)}ms</span>`
          : nothing}
        <div class="agent-meta">
          ${agent.process_count > 0 ? html`${agent.process_count} 个进程` : nothing}
          ${agent.session_count > 0 ? html`<br>${agent.session_count} 个会话` : nothing}
          ${!isOnline && !isLocal ? html`离线` : nothing}
        </div>
      </div>
    `;
  }

  private _renderDetail(agent: AgentInfo) {
    const isOnline = agent.state === "online" || agent.state === "connected";
    const isLocal = agent.type === "local";
    const validProcesses = this._agentProcesses.filter(
      p => p.cwd || p.project_name
    );

    return html`
      <div class="detail-panel">
        <div class="detail-header">
          <button class="back-btn" @click=${() => { this._selectedAgentId = ""; }}>←</button>
          ${this._editingName ? html`
            <input class="edit-name-input"
              .value=${this._editNameValue}
              @input=${(e: InputEvent) => { this._editNameValue = (e.target as HTMLInputElement).value; }}
              @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") this._saveName(agent.agent_id); if (e.key === "Escape") { this._editingName = false; } }}
            />
            <div class="edit-name-actions">
              <button class="edit-save-btn" @click=${() => this._saveName(agent.agent_id)}>保存</button>
              <button class="edit-cancel-btn" @click=${() => { this._editingName = false; }}>取消</button>
            </div>
          ` : html`
            <span class="detail-name" title=${agent.display_name || agent.hostname}>${agent.display_name || agent.hostname}</span>
            <button class="edit-name-btn" title="编辑名称"
              @click=${() => this._startEditName(agent.display_name || agent.hostname)}>
              ✎
            </button>
          `}
        </div>

        <div class="info-grid">
          <span class="info-label">状态</span>
          <span class="info-value">
            <span class="agent-dot ${isOnline ? 'online' : 'offline'}" style="display:inline-block;vertical-align:middle;margin-right:4px"></span>
            ${isOnline ? "在线" : "离线"}
            ${!isLocal && isOnline && agent.latency_ms > 0 ? html` · 延迟 ${Math.round(agent.latency_ms)}ms` : nothing}
          </span>
          <span class="info-label">hostname</span>
          <span class="info-value">${agent.hostname}</span>
          <span class="info-label">类型</span>
          <span class="info-value">${isLocal ? "本机" : "远程"}</span>
          ${agent.agent_version ? html`
            <span class="info-label">版本</span>
            <span class="info-value">${agent.agent_version}</span>
          ` : nothing}
          ${agent.connected_at ? html`
            <span class="info-label">${isLocal ? "启动于" : "连接于"}</span>
            <span class="info-value">${timeAgo(agent.connected_at)}</span>
          ` : nothing}
          ${agent.last_heartbeat ? html`
            <span class="info-label">最后心跳</span>
            <span class="info-value">${timeAgo(agent.last_heartbeat)}</span>
          ` : nothing}
          ${agent.allowed_paths.length > 0 ? html`
            <span class="info-label">允许目录</span>
            <span class="info-value">${agent.allowed_paths.join(", ")}</span>
          ` : nothing}
        </div>

        <div class="section-label">当前进程 (${validProcesses.length})</div>
        <div class="process-list">
          ${validProcesses.length > 0 ? validProcesses.map(p => html`
            <div class="process-row">
              <span class="process-name">${p.project_name || p.cwd?.split("/").pop() || "unknown"}</span>
              ${p.git_branch ? html`<span class="branch-tag" title=${p.git_branch}>${p.git_branch}</span>` : nothing}
              <span class="process-cwd" title=${p.cwd}>${p.cwd}</span>
              <span class="process-meta">PID ${p.pid}</span>
              <span class="process-meta">${formatUptime(p.uptime_seconds)}</span>
            </div>
          `) : html`<div class="empty-processes">暂无进程</div>`}
        </div>
      </div>
    `;
  }

  private _renderAddDialog() {
    const serverUrl = this._getServerUrl();
    return html`
      <div class="dialog-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this._showAddDialog = false; }}>
        <div class="dialog">
          <div class="dialog-title">添加远程机器</div>
          <div class="dialog-text">在远程机器上运行以下命令，即可将其连接到 ClaudeMaster：</div>
          <div class="code-block">pip install claudemaster-agent
cm-agent --server ${serverUrl} --token YOUR_TOKEN</div>
          <div class="dialog-text">或设置环境变量后运行：</div>
          <div class="code-block">export CM_AUTH_TOKEN=YOUR_TOKEN
cm-agent --server ${serverUrl}</div>
          <button class="dialog-close" @click=${() => { this._showAddDialog = false; }}>关闭</button>
        </div>
      </div>
    `;
  }
}
