// 工作台首页：待审批 + 工作中 + 最近会话 + 用量
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { ClaudeProcess, SessionSummary, UsageResponse, QuotaResponse, ChatSessionInfo, AgentInfo, RemoteProcess } from "../api.js";
import "../components/session-card.js";
import "../components/process-card.js";
import "../components/usage-card.js";
import "../components/new-session-dialog.js";
import type { NewSessionConfig } from "../components/new-session-dialog.js";

@customElement("cm-dashboard")
export class DashboardPage extends LitElement {
  @state() processes: ClaudeProcess[] = [];
  @state() sessions: SessionSummary[] = [];
  @state() chatSessions: ChatSessionInfo[] = [];
  @state() agents: AgentInfo[] = [];
  @state() agentProcesses: Map<string, RemoteProcess[]> = new Map();
  @state() usage: UsageResponse | null = null;
  @state() quota: QuotaResponse | null = null;
  @state() loading = true;
  @state() private _newSessionOpen = false;
  @state() private _newSessionStarting = false;
  @state() private _newSessionError = "";

  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host {
      display: block;
    }

    .section {
      margin-bottom: var(--space-xl);
    }

    .section-title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      margin-bottom: var(--space-md);
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }

    .count {
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
      font-weight: 400;
    }

    .card-grid {
      display: grid;
      gap: var(--space-md);
      grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
    }

    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .dot-working  {
      background: var(--color-working);
      animation: pulse 1.2s infinite;
    }
    .dot-standby  { background: var(--color-standby); }
    .dot-recent   { background: var(--color-done); }
    .dot-pending  {
      background: var(--color-attention);
      animation: pulse 1.2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.6; transform: scale(1.3); }
    }

    .usage-section {
      margin-bottom: var(--space-xl);
    }

    .loading, .empty {
      text-align: center;
      padding: var(--space-2xl);
      color: var(--color-text-muted);
    }

    .page-header {
      display: flex;
      align-items: center;
      margin-bottom: var(--space-xl);
      gap: var(--space-md);
    }

    .page-title {
      font-size: var(--font-size-xl);
      font-weight: 700;
      flex: 1;
      color: var(--color-text);
    }

    .new-session-btn {
      display: flex;
      align-items: center;
      gap: var(--space-xs);
      padding: var(--space-sm) var(--space-md);
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }

    .new-session-btn:hover:not(:disabled) {
      background: var(--color-primary-hover);
    }

    .new-session-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .new-session-plus {
      font-size: var(--font-size-base);
      line-height: 1;
    }

    .refresh-btn {
      padding: var(--space-xs) var(--space-md);
      font-size: var(--font-size-sm);
      color: var(--color-primary);
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm);
      cursor: pointer;
      margin-left: auto;
      background: none;
    }

    .refresh-btn:hover {
      background: var(--color-primary);
      color: white;
    }

    /* 待审批卡片 */
    .pending-card {
      background: var(--color-surface);
      border: 1px solid var(--color-attention);
      border-radius: var(--radius-md);
      padding: var(--space-md);
      cursor: pointer;
      transition: box-shadow 0.15s;
      text-decoration: none;
      color: inherit;
      display: block;
    }

    .pending-card:hover {
      box-shadow: 0 0 0 2px var(--color-attention);
    }

    .pending-card-header {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      margin-bottom: var(--space-xs);
    }

    .pending-badge {
      background: var(--color-attention-bg);
      color: var(--color-attention);
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .pending-project {
      font-weight: 600;
      font-size: var(--font-size-sm);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pending-tool {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      font-family: var(--font-mono);
    }

    .pending-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: var(--space-xs);
    }

    .remote-badge {
      background: var(--color-primary-bg, #dbeafe);
      color: var(--color-primary, #2563eb);
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      white-space: nowrap;
    }

    .disconnected-badge {
      background: var(--color-error-bg, #fee2e2);
      color: var(--color-error, #dc2626);
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
    }

    .stop-btn {
      background: none;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: var(--font-size-xs);
      padding: 2px 6px;
      line-height: 1;
      flex-shrink: 0;
    }

    .stop-btn:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .error-banner {
      background: var(--color-error-bg, #fee2e2);
      color: var(--color-error, #dc2626);
      border: 1px solid var(--color-error-border, #fca5a5);
      border-radius: var(--radius-sm);
      padding: var(--space-sm) var(--space-md);
      font-size: var(--font-size-sm);
      margin-bottom: var(--space-md);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    @media (max-width: 768px) {
      .card-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._load();
    // 有待审批或工作中会话时，每 5 秒轮询一次
    this._pollTimer = setInterval(() => this._pollActive(), 5000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) clearInterval(this._pollTimer);
  }

  private async _load() {
    this.loading = true;
    try {
      await this._fetchAll();
    } catch (e) {
      console.error("加载失败:", e);
    }
    this.loading = false;
  }

  private async _fetchAll() {
    const [procs, sessData, chatSess, agentsData, usageData, quotaData] = await Promise.all([
      api.getProcesses(),
      api.getSessions({ limit: "20" }),
      api.listChatSessions().catch(() => [] as ChatSessionInfo[]),
      api.getAgents().catch(() => [] as AgentInfo[]),
      api.getUsage().catch(() => null),
      api.getQuota().catch(() => null),
    ]);

    this.processes = procs;
    this.chatSessions = chatSess;
    this.agents = agentsData;
    this.usage = usageData;
    this.quota = quotaData;

    // 获取 daemon agent 的远程进程
    const daemonAgents = agentsData.filter(a => a.mode === "daemon" && a.state === "connected");
    if (daemonAgents.length > 0) {
      const processResults = await Promise.all(
        daemonAgents.map(a =>
          api.getAgentProcesses(a.agent_id)
            .then(ps => [a.agent_id, ps] as [string, RemoteProcess[]])
            .catch(() => [a.agent_id, []] as [string, RemoteProcess[]])
        )
      );
      this.agentProcesses = new Map(processResults);
    }

    const activeCwds = new Set(procs.map(p => p.cwd));
    const sessions = sessData.items.map(s => ({
      ...s,
      is_active: activeCwds.has(s.project_path),
    }));

    // 补查：legacy 进程如果不在 top 20 会话里，单独获取其最新会话
    const brokerPaths = new Set(chatSess.map(s => s.project_path));
    const loadedPaths = new Set(sessions.map(s => s.project_path));
    const unmatchedProcs = procs.filter(
      p => !brokerPaths.has(p.cwd) && !loadedPaths.has(p.cwd)
    );
    if (unmatchedProcs.length > 0) {
      const extras = await Promise.all(
        unmatchedProcs.map(p =>
          api.getSessions({
            project: p.cwd.replace(/\//g, "-"),
            limit: "1",
          }).catch(() => ({ items: [] as SessionSummary[], total: 0 }))
        )
      );
      for (const extra of extras) {
        for (const s of extra.items) {
          if (!sessions.some(e => e.session_id === s.session_id)) {
            sessions.push({ ...s, is_active: activeCwds.has(s.project_path) });
          }
        }
      }
    }

    this.sessions = sessions;
  }

  /** 轻量轮询：刷新进程、broker 会话和 agent 状态 */
  private async _pollActive() {
    const hasActive =
      this.processes.length > 0 || this.chatSessions.length > 0 || this.agents.length > 0;
    if (!hasActive) return;
    try {
      const [procs, chatSess, agentsData] = await Promise.all([
        api.getProcesses(),
        api.listChatSessions().catch(() => this.chatSessions),
        api.getAgents().catch(() => this.agents),
      ]);
      this.processes = procs;
      this.chatSessions = chatSess;
      this.agents = agentsData;

      // 刷新 daemon agent 的远程进程
      const daemonAgents = agentsData.filter(a => a.mode === "daemon" && a.state === "connected");
      if (daemonAgents.length > 0) {
        const processResults = await Promise.all(
          daemonAgents.map(a =>
            api.getAgentProcesses(a.agent_id)
              .then(ps => [a.agent_id, ps] as [string, RemoteProcess[]])
              .catch(() => [a.agent_id, []] as [string, RemoteProcess[]])
          )
        );
        this.agentProcesses = new Map(processResults);
      }

      const activeCwds = new Set(procs.map(p => p.cwd));
      this.sessions = this.sessions.map(s => ({
        ...s,
        is_active: activeCwds.has(s.project_path),
      }));
    } catch { /* 静默失败 */ }
  }

  private _navToSession(sessionId: string, projectPath: string) {
    const encoded = projectPath.replace(/\//g, "-");
    location.hash = `#/viewer/${encoded}/${sessionId}`;
  }

  private async _stopSession(sessionId: string) {
    try {
      await api.stopChat(sessionId);
      // 刷新列表
      await this._fetchAll();
    } catch (err) {
      console.error("停止会话失败:", err);
    }
  }

  private async _onNewSession(e: CustomEvent<NewSessionConfig>) {
    const { projectPath, name, agentId, ...launchConfig } = e.detail;
    this._newSessionOpen = false;
    this._newSessionStarting = true;
    try {
      const result = await api.startChat(projectPath, undefined, {
        model: launchConfig.model || undefined,
        allowedTools: launchConfig.allowedTools.length > 0 ? launchConfig.allowedTools : undefined,
        permissionMode: launchConfig.permissionMode !== "default" ? launchConfig.permissionMode : undefined,
        maxBudgetUsd: launchConfig.maxBudgetUsd ?? undefined,
        maxTurns: launchConfig.maxTurns ?? undefined,
        appendSystemPrompt: launchConfig.appendSystemPrompt || undefined,
        addDirs: launchConfig.addDirs.length > 0 ? launchConfig.addDirs : undefined,
        name: name || undefined,
        agentId: agentId || undefined,
      });
      // 将 project_path 存入 sessionStorage，viewer 优先从这里读，
      // 避免依赖 broker 会话在跳转后仍然在线
      sessionStorage.setItem(`cm_new_session:${result.session_id}`, result.project_path);
      sessionStorage.setItem(`cm_new_session_name:${result.session_id}`, result.name);
      // 标记新建会话自动接入（viewer 检测到此标记后自动 attach）
      sessionStorage.setItem(`cm_new_session_autoattach:${result.session_id}`, "1");
      this._navToSession(result.session_id, result.project_path);
    } catch (err) {
      console.error("新建会话失败:", err);
      this._newSessionError = err instanceof Error ? err.message : "启动失败，请检查日志";
      this._newSessionStarting = false;
    }
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">加载中...</div>`;
    }

    // broker 会话分类
    const pendingChatSessions  = this.chatSessions.filter(s => s.state === "waiting_permission");
    const streamingSessions    = this.chatSessions.filter(s => s.state === "streaming" || s.state === "starting");
    const idleSessions         = this.chatSessions.filter(s => s.state === "idle" || s.state === "disconnected");
    const activeChatSessions   = [...streamingSessions, ...idleSessions]; // 用于排除最近会话

    // JSONL 会话分类
    // 工作中：broker 有 session_id 的 JSONL 会话（active/streaming/idle）
    // 同时收集 claude_session_id（真实 JSONL ID），用于匹配新建会话
    const activeBrokerIds = new Set([
      ...activeChatSessions.map(s => s.session_id),
      ...activeChatSessions.map(s => s.claude_session_id).filter((id): id is string => !!id),
    ]);
    const pendingBrokerIds = new Set([
      ...pendingChatSessions.map(s => s.session_id),
      ...pendingChatSessions.map(s => s.claude_session_id).filter((id): id is string => !!id),
    ]);

    // 非 broker 管理的活跃进程（仅凭 cwd 匹配），按 cwd 去重，同项目只保留一个
    const brokerPaths = new Set(this.chatSessions.map(s => s.project_path));
    const legacyProcesses = this.processes
      .filter(p => !brokerPaths.has(p.cwd))
      .filter((p, i, arr) => arr.findIndex(q => q.cwd === p.cwd) === i);

    // 远程独立进程（非 managed）
    const remoteUnmanagedProcesses: { agent: AgentInfo; process: RemoteProcess }[] = [];
    for (const agent of this.agents) {
      const procs = this.agentProcesses.get(agent.agent_id) || [];
      for (const p of procs) {
        if (!p.managed) {
          remoteUnmanagedProcesses.push({ agent, process: p });
        }
      }
    }

    // 每个 legacy 进程只"占用"该项目最新的一条 JSONL 会话（其余历史会话仍出现在最近会话）
    const legacyMatchedIds = new Set(
      legacyProcesses
        .map(p => this.sessions.find(s => s.project_path === p.cwd)?.session_id)
        .filter((id): id is string => id !== undefined)
    );

    // 未被 broker 或 legacy 进程占用的会话，按 24h 拆分
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    const unclaimed = this.sessions.filter(
      s => !legacyMatchedIds.has(s.session_id)
        && !activeBrokerIds.has(s.session_id)
        && !pendingBrokerIds.has(s.session_id)
    );

    // 24h 内结束的会话 → 待命中
    const standbyTimeSessions = unclaimed
      .filter(s => s.end_time && (now - new Date(s.end_time).getTime()) < TWENTY_FOUR_HOURS)
      .map(s => ({ ...s, is_active: false }));

    // 超过 24h 或无结束时间 → 最近会话
    const recentSessions = unclaimed
      .filter(s => !s.end_time || (now - new Date(s.end_time).getTime()) >= TWENTY_FOUR_HOURS)
      .map(s => ({ ...s, is_active: false }));

    const hasRefreshBtn = pendingChatSessions.length === 0 && streamingSessions.length === 0 && legacyProcesses.length === 0;

    return html`
      <!-- 页面标题 + 新建按钮 -->
      <div class="page-header">
        <span class="page-title">工作台</span>
        <button
          class="new-session-btn"
          ?disabled=${this._newSessionStarting}
          @click=${() => { this._newSessionOpen = true; }}
        >
          <span class="new-session-plus">+</span>
          ${this._newSessionStarting ? "启动中..." : "新建会话"}
        </button>
      </div>

      <!-- 新建会话对话框 -->
      <cm-new-session-dialog
        .open=${this._newSessionOpen}
        @cancel=${() => { this._newSessionOpen = false; }}
        @start=${this._onNewSession}
      ></cm-new-session-dialog>

      ${this._newSessionError ? html`
        <div class="error-banner">
          <span>新建会话失败：${this._newSessionError}</span>
          <button style="background:none;border:none;cursor:pointer;font-size:1rem;color:inherit"
            @click=${() => { this._newSessionError = ""; }}>✕</button>
        </div>
      ` : nothing}

      <!-- 今日用量 -->
      ${this.usage ? html`
        <div class="usage-section">
          <div class="section-title">今日用量</div>
          <cm-usage-card .data=${this.usage} .quota=${this.quota}></cm-usage-card>
        </div>
      ` : nothing}

      <!-- 待审批 -->
      ${pendingChatSessions.length > 0 ? html`
        <div class="section">
          <div class="section-title">
            <span class="status-dot dot-pending"></span>
            待审批
            <span class="count">(${pendingChatSessions.length})</span>
          </div>
          <div class="card-grid">
            ${pendingChatSessions.map(cs => {
              // 尝试从 JSONL 会话列表里匹配完整摘要
              const matched = this.sessions.find(s => s.session_id === cs.session_id || (cs.claude_session_id && s.session_id === cs.claude_session_id));
              const projectName = matched?.project_name ?? cs.project_path.split("/").pop() ?? cs.project_path;
              return html`
                <div
                  class="pending-card"
                  role="button"
                  tabindex="0"
                  @click=${() => this._navToSession(cs.session_id, cs.project_path)}
                  @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._navToSession(cs.session_id, cs.project_path)}
                >
                  <div class="pending-card-header">
                    <span class="pending-badge">待审批</span>
                    ${cs.source === "remote" && cs.hostname ? html`<span class="remote-badge">${cs.hostname}</span>` : nothing}
                    ${cs.name ? html`<span style="font-weight:600;font-size:var(--font-size-sm)">${cs.name}</span>` : nothing}
                    <span class="pending-project" title=${cs.project_path}>${projectName}</span>
                  </div>
                  ${cs.pending_tool ? html`
                    <div class="pending-tool">请求使用：${cs.pending_tool}</div>
                  ` : nothing}
                  <div class="pending-hint">点击进入会话进行审批</div>
                </div>
              `;
            })}
          </div>
        </div>
      ` : nothing}

      <!-- 工作中：仅 broker streaming/starting 会话（agent 正在执行命令） -->
      ${streamingSessions.length > 0 ? html`
        <div class="section">
          <div class="section-title">
            <span class="status-dot dot-working"></span>
            工作中
            <span class="count">(${streamingSessions.length})</span>
            <button class="refresh-btn" @click=${this._fetchAll.bind(this)}>刷新</button>
          </div>
          <div class="card-grid">
            ${streamingSessions.map(cs => {
              const matched = this.sessions.find(s => s.session_id === cs.session_id || (cs.claude_session_id && s.session_id === cs.claude_session_id));
              if (matched) return html`<cm-session-card .data=${matched} .brokerName=${cs.name || matched.name || ""}></cm-session-card>`;
              const projectName = cs.project_path.split("/").pop() ?? cs.project_path;
              return html`
                <div
                  class="pending-card"
                  style="border-color: var(--color-working)"
                  role="button"
                  tabindex="0"
                  @click=${() => this._navToSession(cs.session_id, cs.project_path)}
                >
                  <div class="pending-card-header">
                    <span class="pending-badge" style="background:var(--color-working-bg);color:var(--color-working)">工作中</span>
                    ${cs.source === "remote" && cs.hostname ? html`<span class="remote-badge">${cs.hostname}</span>` : nothing}
                    ${cs.name ? html`<span style="font-weight:600;font-size:var(--font-size-sm)">${cs.name}</span>` : nothing}
                    <span class="pending-project">${projectName}</span>
                  </div>
                </div>
              `;
            })}
          </div>
        </div>
      ` : nothing}

      <!-- 待命中：broker idle 会话 + legacy 进程 + 远程独立进程 + 24h 内结束的会话 -->
      ${(idleSessions.length > 0 || legacyProcesses.length > 0 || remoteUnmanagedProcesses.length > 0 || standbyTimeSessions.length > 0) ? html`
        <div class="section">
          <div class="section-title">
            <span class="status-dot dot-standby"></span>
            待命中
            <span class="count">(${idleSessions.length + legacyProcesses.length + remoteUnmanagedProcesses.length + standbyTimeSessions.length})</span>
            <button class="refresh-btn" @click=${this._fetchAll.bind(this)}>刷新</button>
          </div>
          <div class="card-grid">
            ${idleSessions.map(cs => {
              const matched = this.sessions.find(s => s.session_id === cs.session_id || (cs.claude_session_id && s.session_id === cs.claude_session_id));
              if (matched) return html`<cm-session-card .data=${{ ...matched, is_active: false }} .brokerName=${cs.name || matched.name || ""}></cm-session-card>`;
              const projectName = cs.project_path.split("/").pop() ?? cs.project_path;
              return html`
                <div
                  class="pending-card"
                  style="border-color: var(--color-standby)"
                  role="button"
                  tabindex="0"
                  @click=${() => this._navToSession(cs.session_id, cs.project_path)}
                >
                  <div class="pending-card-header">
                    <span class="pending-badge" style="background:var(--color-standby-bg);color:var(--color-standby)">待命中</span>
                    ${cs.source === "remote" && cs.hostname ? html`<span class="remote-badge">${cs.hostname}</span>` : nothing}
                    ${cs.state === "disconnected" ? html`<span class="disconnected-badge">${cs.source === "remote" ? "agent 断线，等待重连…" : "已断开"}</span>` : nothing}
                    ${cs.name ? html`<span style="font-weight:600;font-size:var(--font-size-sm)">${cs.name}</span>` : nothing}
                    <span class="pending-project">${projectName}</span>
                    ${cs.source !== "remote" ? html`
                      <button
                        class="stop-btn"
                        title="停止此会话"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this._stopSession(cs.session_id);
                        }}
                      >✕</button>
                    ` : nothing}
                  </div>
                  <div class="pending-hint">${cs.project_path}</div>
                </div>
              `;
            })}
            ${legacyProcesses.map(p => {
              const matched = this.sessions.find(s => s.project_path === p.cwd);
              if (matched) return html`<cm-session-card .data=${{ ...matched, is_active: false }} .brokerName=${matched.name || ""}></cm-session-card>`;
              return html`<cm-process-card .data=${p}></cm-process-card>`;
            })}
            ${remoteUnmanagedProcesses.map(({ agent, process: p }) => html`
              <div class="pending-card" style="border-color: var(--color-standby)">
                <div class="pending-card-header">
                  <span class="pending-badge" style="background:var(--color-standby-bg);color:var(--color-standby)">待命中</span>
                  <span class="remote-badge">${agent.hostname}</span>
                  <span class="pending-project" title=${p.cwd}>${p.project_name || p.cwd}</span>
                </div>
                <div class="pending-hint">PID ${p.pid} · ${p.cwd}</div>
              </div>
            `)}
            ${standbyTimeSessions.map(s => html`<cm-session-card .data=${s} .brokerName=${s.name || ""}></cm-session-card>`)}
          </div>
        </div>
      ` : nothing}

      <!-- 最近会话 -->
      <div class="section">
        <div class="section-title">
          <span class="status-dot dot-recent"></span>
          最近会话
          <span class="count">(${recentSessions.length})</span>
          ${hasRefreshBtn ? html`
            <button class="refresh-btn" @click=${this._load.bind(this)}>刷新</button>
          ` : nothing}
        </div>
        ${recentSessions.length > 0
          ? html`<div class="card-grid">${recentSessions.map(s => html`<cm-session-card .data=${s} .brokerName=${s.name || ""}></cm-session-card>`)}</div>`
          : html`<div class="empty">暂无会话记录</div>`
        }
      </div>
    `;
  }
}
