// 工作台首页：统一视图 — 待审批 + 工作中 + 待命中 + 最近项目 + 用量
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { ClaudeProcess, SessionSummary, UsageResponse, QuotaResponse, ChatSessionInfo, AgentInfo, RemoteProcess } from "../api.js";
import { timeAgo } from "../utils/time.js";
import "../components/session-card.js";
import "../components/process-card.js";
import "../components/usage-card.js";
import "../components/new-session-dialog.js";
import type { NewSessionConfig } from "../components/new-session-dialog.js";

/** 最近项目分组 */
interface ProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: SessionSummary[];
  latestEndTime: string;
  hasActiveProcess: boolean;
}

@customElement("cm-dashboard")
export class DashboardPage extends LitElement {
  @state() processes: ClaudeProcess[] = [];
  @state() sessions: SessionSummary[] = [];
  @state() chatSessions: ChatSessionInfo[] = [];
  @state() agents: AgentInfo[] = [];
  @state() agentProcesses: Map<string, RemoteProcess[]> = new Map();
  @state() agentSessions: Map<string, SessionSummary[]> = new Map();
  @state() usage: UsageResponse | null = null;
  @state() quota: QuotaResponse | null = null;
  @state() loading = true;
  @state() private _newSessionOpen = false;
  @state() private _newSessionStarting = false;
  @state() private _newSessionError = "";
  @state() private _newSessionAgentId = "";
  @state() private _newSessionPath = "";
  @state() private _expandedProjects: Set<string> = new Set();

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

    /* 待审批/工作中/待命中 通用卡片 */
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

    /* 最近项目分组 */
    .project-list { display: flex; flex-direction: column; gap: var(--space-sm); }
    .project-group { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
    .project-group-header { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-md); cursor: pointer; }
    .project-group-header:hover { background: var(--color-hover, rgba(0,0,0,0.03)); }
    .expand-arrow { font-size: 10px; color: var(--color-text-muted); transition: transform 0.15s; width: 12px; flex-shrink: 0; }
    .expand-arrow.open { transform: rotate(90deg); }
    .project-group-name { font-weight: 600; font-size: var(--font-size-sm); color: var(--color-primary); white-space: nowrap; }
    .project-group-meta { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-left: auto; white-space: nowrap; }
    .project-group-summary { padding: 0 var(--space-md) var(--space-md) calc(var(--space-md) + 12px + var(--space-sm)); font-size: var(--font-size-xs); color: var(--color-text-muted); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .project-group-sessions { border-top: 1px solid var(--color-border); }

    .session-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); font-size: var(--font-size-sm); cursor: pointer; }
    .session-row:hover { background: var(--color-hover, rgba(0,0,0,0.03)); }
    .session-row:not(:last-child) { border-bottom: 1px solid var(--color-border-subtle, rgba(0,0,0,0.06)); }
    .session-row-name { font-weight: 500; white-space: nowrap; min-width: 72px; }
    .branch-tag { background: var(--color-border-light); padding: 1px 6px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px; }
    .session-row-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); font-size: var(--font-size-xs); }
    .session-row-time { font-size: var(--font-size-xs); color: var(--color-text-muted); white-space: nowrap; }

    .active-badge-sm {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 1px 6px; border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      background: var(--color-working-bg); color: var(--color-working);
    }
    .active-dot-sm {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--color-working);
      animation: pulse 2s infinite;
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

    // 获取 daemon agent 的远程进程和会话
    const daemonAgents = agentsData.filter(a => a.mode === "daemon" && a.state === "connected");
    if (daemonAgents.length > 0) {
      const [processResults, sessionResults] = await Promise.all([
        Promise.all(
          daemonAgents.map(a =>
            api.getAgentProcesses(a.agent_id)
              .then(ps => [a.agent_id, ps] as [string, RemoteProcess[]])
              .catch(() => [a.agent_id, []] as [string, RemoteProcess[]])
          )
        ),
        Promise.all(
          daemonAgents.map(a =>
            api.getAgentSessions(a.agent_id)
              .then(ss => [a.agent_id, ss] as [string, SessionSummary[]])
              .catch(() => [a.agent_id, []] as [string, SessionSummary[]])
          )
        ),
      ]);
      this.agentProcesses = new Map(processResults);
      this.agentSessions = new Map(sessionResults);
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

      // 刷新 daemon agent 的远程进程和会话
      const daemonAgents = agentsData.filter(a => a.mode === "daemon" && a.state === "connected");
      if (daemonAgents.length > 0) {
        const [processResults, sessionResults] = await Promise.all([
          Promise.all(
            daemonAgents.map(a =>
              api.getAgentProcesses(a.agent_id)
                .then(ps => [a.agent_id, ps] as [string, RemoteProcess[]])
                .catch(() => [a.agent_id, []] as [string, RemoteProcess[]])
            )
          ),
          Promise.all(
            daemonAgents.map(a =>
              api.getAgentSessions(a.agent_id)
                .then(ss => [a.agent_id, ss] as [string, SessionSummary[]])
                .catch(() => [a.agent_id, []] as [string, SessionSummary[]])
            )
          ),
        ]);
        this.agentProcesses = new Map(processResults);
        this.agentSessions = new Map(sessionResults);
      }

      const activeCwds = new Set(procs.map(p => p.cwd));
      this.sessions = this.sessions.map(s => ({
        ...s,
        is_active: activeCwds.has(s.project_path),
      }));
    } catch { /* 静默失败 */ }
  }

  private _navToSession(sessionId: string, projectPath: string, agentId?: string) {
    const encoded = projectPath.replace(/\//g, "-");
    const suffix = agentId ? `?agent=${agentId}` : "";
    location.hash = `#/viewer/${encoded}/${sessionId}${suffix}`;
  }

  private async _killRemoteProcesses(agentId: string, pids: number[]) {
    try {
      await api.killAgentProcesses(agentId, pids);
      await this._fetchAll();
    } catch (err) {
      console.error("清理进程失败:", err);
    }
  }

  private async _stopSession(sessionId: string) {
    try {
      await api.stopChat(sessionId);
      await this._fetchAll();
    } catch (err) {
      console.error("停止会话失败:", err);
    }
  }

  private async _onNewSession(e: CustomEvent<NewSessionConfig>) {
    const { projectPath, name, agentId, ...launchConfig } = e.detail;
    this._newSessionOpen = false;
    this._newSessionAgentId = "";
    this._newSessionPath = "";
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
      sessionStorage.setItem(`cm_new_session:${result.session_id}`, result.project_path);
      sessionStorage.setItem(`cm_new_session_name:${result.session_id}`, result.name);
      sessionStorage.setItem(`cm_new_session_autoattach:${result.session_id}`, "1");
      this._navToSession(result.session_id, result.project_path, agentId || undefined);
    } catch (err) {
      console.error("新建会话失败:", err);
      this._newSessionError = err instanceof Error ? err.message : "启动失败，请检查日志";
      this._newSessionStarting = false;
    }
  }

  private _formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
  }

  private _toggleProject(projectPath: string) {
    const next = new Set(this._expandedProjects);
    if (next.has(projectPath)) next.delete(projectPath);
    else next.add(projectPath);
    this._expandedProjects = next;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">加载中...</div>`;
    }

    // ── broker 会话分类 ──
    const pendingChatSessions  = this.chatSessions.filter(s => s.state === "waiting_permission");
    const streamingSessions    = this.chatSessions.filter(s => s.state === "streaming" || s.state === "starting");
    const idleSessions         = this.chatSessions.filter(s => s.state === "idle" || s.state === "disconnected");
    const activeChatSessions   = [...streamingSessions, ...idleSessions];

    const activeBrokerIds = new Set([
      ...activeChatSessions.map(s => s.session_id),
      ...activeChatSessions.map(s => s.claude_session_id).filter((id): id is string => !!id),
    ]);
    const pendingBrokerIds = new Set([
      ...pendingChatSessions.map(s => s.session_id),
      ...pendingChatSessions.map(s => s.claude_session_id).filter((id): id is string => !!id),
    ]);

    // ── legacy 进程（本地非 broker 管理的） ──
    const brokerPaths = new Set(this.chatSessions.map(s => s.project_path));
    const legacyProcesses = this.processes
      .filter(p => !brokerPaths.has(p.cwd))
      .filter((p, i, arr) => arr.findIndex(q => q.cwd === p.cwd) === i);

    // ── 远程非托管进程（按 agent+cwd 分组合并） ──
    interface RemoteProcessGroup {
      agent: AgentInfo;
      cwd: string;
      projectName: string;
      pids: number[];
      session: SessionSummary | null;
      totalUptime: number;
    }
    const remoteStandbyGroups: RemoteProcessGroup[] = [];
    for (const agent of this.agents) {
      if (agent.state !== "connected") continue;
      const procs = this.agentProcesses.get(agent.agent_id) || [];
      const sessions = this.agentSessions.get(agent.agent_id) || [];
      const sessionByPath = new Map<string, SessionSummary>();
      for (const s of sessions) {
        sessionByPath.set(s.project_path, s);
      }
      // 按 cwd 分组
      const cwdMap = new Map<string, RemoteProcessGroup>();
      for (const p of procs) {
        if (!p.managed) {
          const key = p.cwd || p.project_name || `_orphan_${agent.agent_id}`;
          let group = cwdMap.get(key);
          if (!group) {
            group = {
              agent,
              cwd: p.cwd,
              projectName: p.project_name || "",
              pids: [],
              session: sessionByPath.get(p.cwd) || null,
              totalUptime: 0,
            };
            cwdMap.set(key, group);
          }
          group.pids.push(p.pid);
          group.totalUptime = Math.max(group.totalUptime, p.uptime_seconds);
        }
      }
      remoteStandbyGroups.push(...cwdMap.values());
    }

    // ── legacy 进程按 24h 分流 ──
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    const legacyStandby: ClaudeProcess[] = [];
    const legacyRecent: ClaudeProcess[] = [];
    const legacyStandbyMatchedIds = new Set<string>();

    for (const p of legacyProcesses) {
      const matched = this.sessions.find(s => s.project_path === p.cwd);
      if (!matched) {
        legacyStandby.push(p);
        continue;
      }
      const endMs = matched.end_time ? new Date(matched.end_time).getTime() : 0;
      if (endMs && (now - endMs) < TWENTY_FOUR_HOURS) {
        legacyStandby.push(p);
        legacyStandbyMatchedIds.add(matched.session_id);
      } else {
        legacyRecent.push(p);
        // 不排除这些会话，让它们进入最近项目（带 is_active）
      }
    }

    // ── JSONL 会话分流 ──
    const unclaimed = this.sessions.filter(
      s => !legacyStandbyMatchedIds.has(s.session_id)
        && !activeBrokerIds.has(s.session_id)
        && !pendingBrokerIds.has(s.session_id)
    );

    // 所有 unclaimed JSONL 会话 → 最近项目（不再区分 24h）
    const recentSessions = unclaimed
      .map(s => ({ ...s, is_active: false }));

    // legacyRecent 匹配的会话需要标记 is_active
    const legacyRecentPaths = new Set(legacyRecent.map(p => p.cwd));
    const allRecentSessions = recentSessions.map(s => ({
      ...s,
      is_active: s.is_active || legacyRecentPaths.has(s.project_path),
    }));

    // ── 最近项目分组 ──
    const projectMap = new Map<string, ProjectGroup>();
    for (const s of allRecentSessions) {
      let group = projectMap.get(s.project_path);
      if (!group) {
        group = {
          projectPath: s.project_path,
          projectName: s.project_name,
          sessions: [],
          latestEndTime: s.end_time || "",
          hasActiveProcess: s.is_active,
        };
        projectMap.set(s.project_path, group);
      }
      group.sessions.push(s);
      if (s.end_time && s.end_time > group.latestEndTime) {
        group.latestEndTime = s.end_time;
      }
      if (s.is_active) group.hasActiveProcess = true;
    }
    const projectGroups = [...projectMap.values()]
      .sort((a, b) => b.latestEndTime.localeCompare(a.latestEndTime));

    // ── 待命中总数 ──
    const standbyCount = idleSessions.length + legacyStandby.length
      + remoteStandbyGroups.length;

    // ── 是否显示机器 badge（>= 2 个 agent 时显示） ──
    const showMachineBadge = this.agents.length >= 2;
    const agentNameMap = new Map<string, string>();
    for (const a of this.agents) {
      agentNameMap.set(a.agent_id, a.display_name || a.hostname);
    }

    const hasRefreshBtn = pendingChatSessions.length === 0
      && streamingSessions.length === 0 && legacyStandby.length === 0;

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
        .initialAgentId=${this._newSessionAgentId}
        .initialPath=${this._newSessionPath}
        @cancel=${() => { this._newSessionOpen = false; this._newSessionAgentId = ""; this._newSessionPath = ""; }}
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
                    ${showMachineBadge && cs.source === "remote" && cs.hostname ? html`<span class="remote-badge">${agentNameMap.get(cs.agent_id || "") || cs.hostname}</span>` : nothing}
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

      <!-- 工作中 -->
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
                    ${showMachineBadge && cs.source === "remote" && cs.hostname ? html`<span class="remote-badge">${agentNameMap.get(cs.agent_id || "") || cs.hostname}</span>` : nothing}
                    ${cs.name ? html`<span style="font-weight:600;font-size:var(--font-size-sm)">${cs.name}</span>` : nothing}
                    <span class="pending-project">${projectName}</span>
                  </div>
                </div>
              `;
            })}
          </div>
        </div>
      ` : nothing}

      <!-- 待命中：broker idle + legacyStandby + remoteStandby + 24h 内 JSONL 会话 -->
      ${standbyCount > 0 ? html`
        <div class="section">
          <div class="section-title">
            <span class="status-dot dot-standby"></span>
            待命中
            <span class="count">(${standbyCount})</span>
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
                    ${showMachineBadge && cs.source === "remote" && cs.hostname ? html`<span class="remote-badge">${agentNameMap.get(cs.agent_id || "") || cs.hostname}</span>` : nothing}
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
            ${legacyStandby.map(p => {
              const matched = this.sessions.find(s => s.project_path === p.cwd);
              if (matched) return html`<cm-session-card .data=${{ ...matched, is_active: false }} .brokerName=${matched.name || ""}></cm-session-card>`;
              return html`<cm-process-card .data=${p}></cm-process-card>`;
            })}
            ${remoteStandbyGroups.map((group) => {
              const machine = agentNameMap.get(group.agent.agent_id) || group.agent.hostname;
              if (group.session && group.pids.length === 1) {
                // 单个进程有匹配 JSONL 会话 → session-card
                return html`<cm-session-card
                  .data=${{ ...group.session, is_active: true }}
                  .brokerName=${machine}
                  @click=${(e: Event) => { e.preventDefault(); this._navToSession(group.session!.session_id, group.session!.project_path, group.agent.agent_id); }}
                ></cm-session-card>`;
              }
              // 多进程或无会话 → 合并卡片
              const projectName = group.projectName || (group.cwd ? group.cwd.split("/").pop() : "") || "未知路径";
              return html`
                <div class="pending-card" style="border-color: var(--color-standby)">
                  <div class="pending-card-header">
                    <span class="pending-badge" style="background:var(--color-standby-bg);color:var(--color-standby)">待命中</span>
                    ${machine ? html`<span class="remote-badge">${machine}</span>` : nothing}
                    <span class="pending-project">${projectName}</span>
                    ${group.pids.length > 1 ? html`<span class="count">${group.pids.length} 个孤儿进程</span>` : nothing}
                    <button
                      class="stop-btn"
                      title="清理${group.pids.length > 1 ? `这 ${group.pids.length} 个` : "此"}孤儿进程"
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this._killRemoteProcesses(group.agent.agent_id, group.pids);
                      }}
                    >清理</button>
                  </div>
                  <div class="pending-hint">${group.cwd || "路径不可读"} · 运行 ${this._formatUptime(Math.round(group.totalUptime))}</div>
                </div>
              `;
            })}
          </div>
        </div>
      ` : nothing}

      <!-- 最近项目 -->
      <div class="section">
        <div class="section-title">
          <span class="status-dot dot-recent"></span>
          最近项目
          <span class="count">(${projectGroups.length})</span>
          ${hasRefreshBtn ? html`
            <button class="refresh-btn" @click=${this._load.bind(this)}>刷新</button>
          ` : nothing}
        </div>
        ${projectGroups.length > 0 ? html`
          <div class="project-list">
            ${projectGroups.map(group => {
              const expanded = this._expandedProjects.has(group.projectPath);
              const latest = group.sessions[0];
              return html`
                <div class="project-group">
                  <div class="project-group-header" @click=${() => this._toggleProject(group.projectPath)}>
                    <span class="expand-arrow ${expanded ? 'open' : ''}">▶</span>
                    <span class="project-group-name">${group.projectName}</span>
                    ${group.hasActiveProcess ? html`<span class="active-badge-sm"><span class="active-dot-sm"></span>运行中</span>` : nothing}
                    <span class="project-group-meta">
                      ${group.sessions.length} 个会话 · ${group.latestEndTime ? timeAgo(group.latestEndTime) : ""}
                    </span>
                  </div>
                  ${!expanded ? html`
                    <div class="project-group-summary">${latest?.first_message || ""}</div>
                  ` : nothing}
                  ${expanded ? html`
                    <div class="project-group-sessions">
                      ${group.sessions.map(s => html`
                        <div class="session-row" @click=${() => this._navToSession(s.session_id, s.project_path)}>
                          <span class="session-row-name">${s.name || ""}</span>
                          ${s.git_branch ? html`<span class="branch-tag">${s.git_branch}</span>` : nothing}
                          <span class="session-row-msg">${s.first_message || ""}</span>
                          <span class="session-row-time">${s.end_time ? timeAgo(s.end_time) : ""}</span>
                          ${s.is_active ? html`<span class="active-badge-sm"><span class="active-dot-sm"></span></span>` : nothing}
                        </div>
                      `)}
                    </div>
                  ` : nothing}
                </div>
              `;
            })}
          </div>
        ` : html`<div class="empty">暂无会话记录</div>`}
      </div>
    `;
  }
}
