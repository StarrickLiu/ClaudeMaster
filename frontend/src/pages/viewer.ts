// 对话查看器页面：消息流 + 代码变更 + 交互式聊天
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { SessionDetail, Message, ContentBlock, ChatSessionInfo, CommitInfo } from "../api.js";
import type { ToolResult } from "../components/tool-call.js";
import {
  ChatClient,
  type ChatState,
  type PermissionRequest,
  type ResultStats,
  type ToolActivity,
} from "../services/chat-client.js";
import type { LaunchConfig } from "../components/launch-config-dialog.js";
import "../components/message-bubble.js";
import "../components/tool-call.js";
import "../components/thinking-block.js";
import "../components/diff-view.js";
import "../components/chat-input.js";
import "../components/permission-dialog.js";
import "../components/session-header.js";
import "../components/session-summary.js";

/** 每次加载的原始消息数（含 tool_result 等隐藏消息） */
const BATCH_SIZE = 30;

/** 生成 UUID，兼容非安全上下文（纯 HTTP） */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 回退：用 crypto.getRandomValues 手动拼接
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

@customElement("cm-viewer")
export class ViewerPage extends LitElement {
  @property() sessionId = "";
  @property() project = "";

  @state() data: SessionDetail | null = null;
  @state() loading = true;
  @state() activeTab: "conversation" | "diff" = "conversation";
  @state() diffContent = "";
  @state() diffStat = "";
  @state() diffLoading = false;
  @state() commits: CommitInfo[] = [];
  @state() commitsLoading = false;
  @state() showOnlyChat = false;
  /** 从末尾显示多少条原始消息，0 = 全部折叠 */
  @state() visibleCount = 0;

  /** 新会话时 JSONL 尚未创建，从 broker 获取的项目路径，用于启动聊天 */
  @state() private _newSessionProjectPath = "";
  @state() private _sessionName = "";

  // 聊天模式状态
  @state() chatMode = false;
  @state() chatConnecting = false;
  @state() chatState: ChatState = "closed";
  @state() private _activeBrokerSession: ChatSessionInfo | null = null;
  @state() streamingText = "";
  @state() streamingThinking = "";
  @state() pendingPermission: PermissionRequest | null = null;
  @state() sessionStats: ResultStats | null = null;
  @state() toolActivities: ToolActivity[] = [];
  @state() private _promptTooLong = false;
  @state() private _compacting = false;

  private chatClient: ChatClient | null = null;
  /** 本次会话中用户选择"始终允许"的工具集合，自动通过同名工具请求 */
  private _autoApproveTools = new Set<string>();
  // 实际的 broker session id（可能因 init 事件被更新）
  private brokerSessionId = "";
  private toolResultMap = new Map<string, ToolResult>();

  static styles = css`
    :host {
      display: block;
      padding-bottom: 80px;
    }

    /* 标签页 */
    .tabs {
      display: flex;
      gap: 2px;
      background: var(--color-border-light);
      border-radius: var(--radius-sm);
      padding: 2px;
      margin-bottom: var(--space-lg);
      width: fit-content;
    }

    .tab {
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      transition: all 0.15s;
      background: none;
      border: none;
      cursor: pointer;
    }

    .tab[data-active] {
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-sm);
    }

    /* 工具栏 */
    .toolbar {
      display: flex;
      gap: var(--space-sm);
      margin-bottom: var(--space-md);
    }

    .toolbar-btn {
      padding: var(--space-xs) var(--space-sm);
      font-size: var(--font-size-xs);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      color: var(--color-text-secondary);
      background: none;
      cursor: pointer;
    }

    .toolbar-btn:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .toolbar-btn[data-active] {
      background: var(--color-primary);
      color: white;
      border-color: var(--color-primary);
    }

    /* 消息流 */
    .messages {
      display: flex;
      flex-direction: column;
    }

    .loading,
    .empty {
      text-align: center;
      padding: var(--space-2xl);
      color: var(--color-text-muted);
    }

.activity-log {
      margin-top: var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }

    .activity-log-header {
      padding: 4px var(--space-sm);
      background: var(--color-border-light);
      font-size: 10px;
      font-weight: 600;
      color: var(--color-text-muted);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: var(--space-xs);
    }

    .activity-log-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-working, #22c55e);
      animation: pulse-dot 1.2s infinite;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .activity-items {
      max-height: 240px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .activity-item {
      display: flex;
      align-items: baseline;
      gap: var(--space-sm);
      padding: 3px var(--space-sm);
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
      line-height: 1.6;
      border-bottom: 1px solid var(--color-border-light);
    }

    .activity-item:last-child { border-bottom: none; }

    .activity-item.pending {
      background: rgba(99, 102, 241, 0.04);
    }

    .activity-icon {
      flex-shrink: 0;
      font-style: normal;
    }

    .activity-tool {
      color: var(--color-primary);
      font-weight: 600;
      flex-shrink: 0;
    }

    .activity-desc {
      color: var(--color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .activity-ts {
      color: var(--color-text-muted);
      font-size: 10px;
      flex-shrink: 0;
    }

    .activity-pending-dot {
      display: inline-block;
      animation: blink 0.8s infinite;
    }

    .streaming-thinking {
      margin-top: var(--space-sm);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .streaming-thinking summary {
      padding: var(--space-xs) var(--space-sm);
      cursor: pointer;
      user-select: none;
    }

    .thinking-pre {
      padding: var(--space-sm);
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 200px;
      overflow-y: auto;
      font-family: var(--font-mono);
    }

    /* 悬浮按钮：跳到底部 */
    .scroll-bottom {
      position: fixed;
      bottom: 120px;
      right: 20px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--color-primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--shadow-lg);
      font-size: 18px;
      z-index: 50;
      cursor: pointer;
      border: none;
    }

    .scroll-bottom:hover {
      background: var(--color-primary-hover);
    }

    /* 后台任务通知条 */
    .task-notif {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-xs) var(--space-md);
      margin-bottom: var(--space-sm);
      border-left: 3px solid var(--color-border);
      background: var(--color-border-light);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }
    .task-notif-icon { flex-shrink: 0; }
    .task-notif-id {
      font-family: var(--font-mono, monospace);
      background: var(--color-border);
      padding: 1px 5px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .task-notif-summary {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 展开/折叠消息区 */
    .expand-toggle {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-sm) 0;
      margin-bottom: var(--space-md);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
    }

    .expand-toggle:hover {
      color: var(--color-primary);
    }

    .expand-arrow {
      display: inline-block;
      transition: transform 0.2s;
      font-size: 12px;
    }

    .expand-arrow[data-expanded] {
      transform: rotate(90deg);
    }

    /* 加载更早消息按钮 */
    .load-more {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      margin-bottom: var(--space-md);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      background: var(--color-border-light);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius-sm);
      width: 100%;
      text-align: center;
    }

    .load-more:hover {
      color: var(--color-primary);
      border-color: var(--color-primary);
      background: var(--color-surface);
    }

    .token-stats {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      padding: var(--space-sm) 0;
    }

    .welcome {
      text-align: center;
      padding: var(--space-2xl) var(--space-lg);
      color: var(--color-text-secondary);
    }

    .welcome-icon {
      font-size: 48px;
      margin-bottom: var(--space-md);
      opacity: 0.6;
    }

    .welcome-title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: var(--space-sm);
    }

    .welcome-project {
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
      color: var(--color-primary);
      margin-bottom: var(--space-lg);
    }

    .welcome-hint {
      font-size: var(--font-size-sm);
      line-height: 1.8;
    }

    .welcome-connecting {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      margin-top: var(--space-lg);
      font-size: var(--font-size-sm);
      color: var(--color-working);
    }

    .welcome-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-working);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .compacting-notice {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      padding: var(--space-md);
      margin: var(--space-md) 0;
      background: rgba(99, 102, 241, 0.06);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      color: var(--color-primary);
    }

    .prompt-too-long {
      margin: var(--space-md) 0;
      padding: var(--space-md);
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: var(--radius-sm);
      text-align: center;
    }

    .prompt-too-long-title {
      font-weight: 600;
      color: var(--color-error, #ef4444);
      margin-bottom: var(--space-xs);
    }

    .prompt-too-long-desc {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-bottom: var(--space-md);
    }

    .compact-btn {
      padding: var(--space-sm) var(--space-lg);
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: var(--font-size-sm);
    }

    .compact-btn:hover {
      background: var(--color-primary-hover);
    }

    @media (max-width: 768px) {
      .scroll-bottom {
        bottom: 110px;
        right: 12px;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._disconnectChat();
    document.body.classList.remove("chat-active");
  }

  // ===== 数据加载 =====

  /** 首次加载（显示 loading 占位）；同时检测 broker 活跃会话，自动接入 */
  private async _load() {
    this.loading = true;

    // 优先检查 sessionStorage（新建会话时 dashboard 会提前写入）
    const storedPath = sessionStorage.getItem(`cm_new_session:${this.sessionId}`);
    if (storedPath) {
      this._newSessionProjectPath = storedPath;
      sessionStorage.removeItem(`cm_new_session:${this.sessionId}`);
    }
    const storedName = sessionStorage.getItem(`cm_new_session_name:${this.sessionId}`);
    if (storedName) {
      this._sessionName = storedName;
      sessionStorage.removeItem(`cm_new_session_name:${this.sessionId}`);
    }

    try {
      // 先拿 broker 会话列表，确定正确的 JSONL session_id，避免用错误 ID 产生 404
      const chatSessions = await api.listChatSessions().catch(() => [] as ChatSessionInfo[]);
      const activeBroker = chatSessions.find(
        (cs) => cs.session_id === this.sessionId && cs.state !== "closed"
      );

      if (activeBroker) {
        if (activeBroker.name && !this._sessionName) {
          this._sessionName = activeBroker.name;
        }
        this._activeBrokerSession = activeBroker;
        // 优先用真实 claude_session_id 查 JSONL，避免 initial_id 不匹配导致 404
        if (activeBroker.claude_session_id) {
          this.brokerSessionId = activeBroker.claude_session_id;
        }
      }

      // 用最佳 ID 加载 JSONL（brokerSessionId > URL sessionId）
      const jsonlId = this.brokerSessionId || this.sessionId;
      const session = await api.getSession(jsonlId, this.project).catch(() => null);

      if (session) {
        this.data = session;
        this._buildToolResultMap();
        if (!this._sessionName && session.summary.name) {
          this._sessionName = session.summary.name;
        }
      }

      if (activeBroker && !this.data) {
        this._newSessionProjectPath = activeBroker.project_path;
      }

      // 特例：dashboard 新建会话跳转过来时仍自动接入
      const autoAttachKey = `cm_new_session_autoattach:${this.sessionId}`;
      if (sessionStorage.getItem(autoAttachKey)) {
        sessionStorage.removeItem(autoAttachKey);
        if (activeBroker) {
          this._attachToBroker(activeBroker.session_id);
        } else if (this._newSessionProjectPath) {
          this._attachToBroker(this.sessionId);
        }
      }
    } catch (e) {
      console.error("加载会话失败:", e);
    }
    this.loading = false;
  }

  /** 解析当前最佳 session_id：优先用 brokerSessionId（真实 Claude ID），其次 activeBroker 的 claude_session_id，最后 URL 中的 ID */
  private _resolveSessionId(): string {
    return this.brokerSessionId || this._activeBrokerSession?.claude_session_id || this.sessionId;
  }

  /** 静默刷新（不闪 loading，保留当前消息） */
  private async _reload() {
    const sid = this._resolveSessionId();
    try {
      const fresh = await api.getSession(sid, this.project);
      this.data = fresh;
      this._buildToolResultMap();
    } catch (e) {
      console.error("刷新会话失败:", e);
    }
  }

  private _buildToolResultMap() {
    this.toolResultMap.clear();
    if (!this.data) return;

    for (const msg of this.data.messages) {
      if (msg.type !== "user" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          this.toolResultMap.set(block.tool_use_id, {
            content: block.content,
            isError: block.is_error,
          });
        }
      }
    }
  }

  private _isToolResultMessage(msg: Message): boolean {
    if (msg.type !== "user" || !Array.isArray(msg.content)) return false;
    return msg.content.every((b) => b.type === "tool_result");
  }

  /** 检测 Claude Code 后台任务通知（<task-notification> XML 或纯文本格式） */
  private _parseTaskNotification(text: string): { taskId: string; status: string; summary: string } | null {
    // XML 格式：<task-notification>...</task-notification>
    const xmlId     = /<task-id>([^<]+)<\/task-id>/i.exec(text);
    const xmlStatus = /<status>([^<]+)<\/status>/i.exec(text);
    const xmlSummary = /<summary>([\s\S]*?)<\/summary>/i.exec(text);
    if (xmlId && xmlStatus) {
      return {
        taskId: xmlId[1].trim(),
        status: xmlStatus[1].trim(),
        summary: xmlSummary ? xmlSummary[1].trim() : "",
      };
    }
    // 纯文本：任务启动通知
    const bgMatch = /Command running in background with ID:\s*(\w+)/i.exec(text);
    if (bgMatch) {
      return { taskId: bgMatch[1], status: "running", summary: "后台任务已启动" };
    }
    // 任务输出内容（<retrieval_status> 格式）
    if (text.trimStart().startsWith("<retrieval_status>")) {
      return { taskId: "", status: "output", summary: "任务输出已读取" };
    }
    return null;
  }

  private _getTextContent(msg: Message): string {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("\n");
    }
    return "";
  }

  private async _loadDiff() {
    if (!this.data) return;
    const projectPath = this.data.summary.project_path;
    this.diffLoading = true;
    this.commitsLoading = true;
    try {
      const [result, commits] = await Promise.all([
        api.getDiff(projectPath),
        api.getCommits(projectPath, 30),
      ]);
      this.diffContent = result.diff;
      this.diffStat = result.stat;
      this.commits = commits;
    } catch (e) {
      console.error("加载 diff 失败:", e);
      this.diffContent = "";
      this.diffStat = "加载失败";
    }
    this.diffLoading = false;
    this.commitsLoading = false;
  }

  private _switchTab(tab: "conversation" | "diff") {
    this.activeTab = tab;
    if (tab === "diff" && !this.diffLoading && !this.commitsLoading) {
      this._loadDiff();
    }
  }

  private _scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  // ===== 聊天模式 =====

  /** 直接连接已存在的 broker 会话（不调用 startChat API） */
  private _attachToBroker(sessionId: string) {
    if (this.chatClient) {
      this.chatClient.disconnect();
      this.chatClient = null;
    }
    this.brokerSessionId = sessionId;
    this.chatClient = new ChatClient(sessionId);
    this._setupChatListeners();
    this.chatClient.connect();
    this.chatMode = true;
    this.visibleCount = BATCH_SIZE;
    document.body.classList.add("chat-active");
  }

  private async _startChat(e?: CustomEvent<LaunchConfig>) {
    const projectPath = this.data?.summary.project_path ?? this._newSessionProjectPath;
    if (!projectPath || this.chatConnecting) return;
    const config = e?.detail;
    this.chatConnecting = true;

    // 先断开旧连接，避免旧 chatClient 的事件监听器继续触发 viewer 状态更新
    if (this.chatClient) {
      this.chatClient.disconnect();
      this.chatClient = null;
    }
    this.pendingPermission = null;
    this.toolActivities = [];
    this._promptTooLong = false;

    // resumeId：
    // - broker 已有进程时 → attach 到已有进程（avoid 重复启动）
    // - broker 没有时 → claude --resume sessionId 从 JSONL 恢复
    //   新建会话在 init 事件后 Claude 已写入 JSONL，--resume 仍然有效
    const resumeId = this.sessionId;

    try {
      const result = await api.startChat(
        projectPath,
        resumeId,
        config ? {
          model: config.model || undefined,
          allowedTools: config.allowedTools.length > 0 ? config.allowedTools : undefined,
          permissionMode: config.permissionMode !== "default" ? config.permissionMode : undefined,
          maxBudgetUsd: config.maxBudgetUsd ?? undefined,
          maxTurns: config.maxTurns ?? undefined,
          appendSystemPrompt: config.appendSystemPrompt || undefined,
          addDirs: config.addDirs.length > 0 ? config.addDirs : undefined,
        } : undefined
      );
      // 优先用真实 Claude session_id（与 JSONL 一致），否则用 initial_id
      this.brokerSessionId = result.claude_session_id || result.session_id;
      this._activeBrokerSession = result;
      if (result.name && !this._sessionName) {
        this._sessionName = result.name;
      }
      this.chatClient = new ChatClient(result.session_id);
      this._setupChatListeners();
      this.chatClient.connect();
      this.chatMode = true;
      this.visibleCount = BATCH_SIZE;
      document.body.classList.add("chat-active");
    } catch (e) {
      console.error("启动会话失败:", e);
    } finally {
      this.chatConnecting = false;
    }
  }

  private _setupChatListeners() {
    const c = this.chatClient!;

    c.on("state-change", (s) => {
      this.chatState = s;
      // streaming 状态到来时若有 pending 审批 → Claude 已自动批准，关闭弹窗
      if (s === "streaming" && this.pendingPermission) {
        this.pendingPermission = null;
      }
    });

    c.on("text-delta", (text) => {
      this.streamingText += text;
      requestAnimationFrame(() => this._scrollToBottom());
    });

    c.on("thinking-delta", (text) => {
      this.streamingThinking += text;
    });

    c.on("tool-activity", (activity) => {
      if (!activity.complete) {
        // 初始事件：追加新条目（input 尚未完整，仅显示工具名）
        this.toolActivities = [...this.toolActivities.slice(-29), activity];
      } else {
        // 完整事件：用完整 input 更新最后一条同名 activity
        const list = [...this.toolActivities];
        const lastIdx = list.map(a => a.toolName).lastIndexOf(activity.toolName);
        if (lastIdx !== -1 && !list[lastIdx].complete) {
          list[lastIdx] = activity;
          this.toolActivities = list;
        } else {
          this.toolActivities = [...list.slice(-29), activity];
        }
      }
    });

    c.on("assistant-message", () => {
      // 完整消息到达，清除流式文本，等 result 后统一静默刷新
    });

    c.on("session-id", (id) => {
      this.brokerSessionId = id;
    });

    c.on("permission-request", (req) => {
      // 始终允许列表：直接自动 approve，不弹框
      if (this._autoApproveTools.has(req.toolName)) {
        c.approvePermission(req.requestId, req.input);
        return;
      }
      this.pendingPermission = req;
      // 用户不在当前 tab 时推送桌面通知
      if (document.hidden) {
        this._notify("Claude 正在等待您的授权", req.toolName);
      }
    });

    c.on("status", (status) => {
      this._compacting = status === "compacting";
    });

    c.on("result", async (evt) => {
      this.pendingPermission = null;
      this.toolActivities = [];

      // 检测 "Prompt is too long" 错误
      const isError = !!(evt as Record<string, unknown>)["is_error"];
      const resultText = String((evt as Record<string, unknown>)["result"] ?? "");
      if (isError && resultText.includes("Prompt is too long") || this.streamingText.includes("Prompt is too long")) {
        this._promptTooLong = true;
      }

      // 保存流式内容，防止 _reload 失败后消息丢失
      const pendingText = this.streamingText;
      // 等 JSONL 写入后再刷新，刷新完成后再清除流式文字，避免"空窗期"
      await new Promise(r => setTimeout(r, 400));
      await this._reload();
      // 如果 _reload 未能获取到助手消息（JSONL 查找失败），合成一条保底
      if (pendingText && this.data) {
        const lastMsg = this.data.messages[this.data.messages.length - 1];
        if (!lastMsg || lastMsg.type !== "assistant") {
          this.data = {
            ...this.data,
            messages: [...this.data.messages, {
              uuid: generateUUID(),
              parent_uuid: null,
              type: "assistant",
              timestamp: new Date().toISOString(),
              session_id: this.sessionId,
              is_sidechain: false,
              cwd: null,
              git_branch: null,
              version: null,
              agent_id: null,
              request_id: null,
              role: "assistant",
              content: pendingText,
              model_name: null,
              usage: null,
            }],
          };
        }
      }
      this.streamingText = "";
      this.streamingThinking = "";
      if (document.hidden) {
        this._notify("Claude 已完成任务");
      }
    });

    c.on("result-stats", (stats) => {
      this.sessionStats = stats;
    });

    c.on("error", (msg) => {
      console.error("聊天错误:", msg);
    });

    c.on("closed", () => {
      if (this.streamingText) {
        this.streamingText = "";
      }
      this.streamingThinking = "";
      // 进程结束，静默刷新最终数据
      this._reload();
    });
  }

  private _disconnectChat() {
    if (this.chatClient) {
      this.chatClient.disconnect();
      this.chatClient = null;
    }
    this.chatMode = false;
    this.chatState = "closed";
    this.streamingText = "";
    this.streamingThinking = "";
    this.pendingPermission = null;
    this.toolActivities = [];
    document.body.classList.remove("chat-active");
    // 断开后刷新拿最新数据
    if (this.data) {
      this._reload();
    }
  }

  private _notify(title: string, body?: string) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") new Notification(title, { body, icon: "/favicon.ico" });
      });
    }
  }

  private async _onSendMessage(e: CustomEvent<string>) {
    const text = e.detail;

    // 先乐观展示用户消息（不等待重连），确保立即可见
    const userMsg: Message = {
      uuid: generateUUID(),
      parent_uuid: null,
      type: "user",
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      is_sidechain: false,
      cwd: null,
      git_branch: null,
      version: null,
      agent_id: null,
      request_id: null,
      role: "user",
      content: text,
      model_name: null,
      usage: null,
    };
    if (this.data) {
      this.data = {
        ...this.data,
        messages: [...this.data.messages, userMsg],
      };
    } else {
      // 新建会话：首条消息时初始化 data stub
      const projectPath = this._newSessionProjectPath;
      this.data = {
        summary: {
          session_id: this.sessionId,
          resume_session_id: null,
          project_path: projectPath,
          project_name: projectPath.split("/").pop() ?? "新会话",
          first_message: text,
          last_assistant_text: null,
          user_turns: 1,
          tool_use_count: 0,
          message_count: 1,
          start_time: new Date().toISOString(),
          end_time: null,
          git_branch: null,
          is_active: true,
          total_input_tokens: 0,
          total_output_tokens: 0,
          name: this._sessionName,
        },
        messages: [userMsg],
      };
    }
    // 等待 DOM 更新后再滚动，确保消息已渲染
    this.updateComplete.then(() => this._scrollToBottom());

    // 会话已断开（进程退出）时自动重连
    if (!this.chatClient || this.chatState === "closed") {
      try {
        await this._startChat();
      } catch (err) {
        console.error("重连失败:", err);
      }
    }
    if (!this.chatClient) return;
    this.chatClient.sendMessage(text);
  }

  private _onDismissPromptTooLong() {
    this._promptTooLong = false;
  }

  private _onInterrupt() {
    this.chatClient?.interrupt();
  }

  private _onAttach() {
    if (this._activeBrokerSession) {
      this._attachToBroker(this._activeBrokerSession.session_id);
    }
  }

  private async _onRename(e: CustomEvent<string>) {
    this._sessionName = e.detail;
    const sid = this.brokerSessionId || this._activeBrokerSession?.session_id;
    if (sid) {
      try {
        await api.updateChatSession(sid, { name: e.detail });
      } catch (err) {
        console.error("重命名失败:", err);
      }
    }
    // 双写：同步更新通用 name store（基于 JSONL session_id）
    const jsonlId = this._resolveSessionId();
    try { await api.updateSessionName(jsonlId, e.detail); } catch { /* 静默 */ }
  }

  private _onApprove(e: CustomEvent<{ requestId: string; input: Record<string, unknown>; always?: boolean; toolName?: string }>) {
    this.chatClient?.approvePermission(e.detail.requestId, e.detail.input);
    if (e.detail.always && e.detail.toolName) {
      this._autoApproveTools.add(e.detail.toolName);
    }
    this.pendingPermission = null;
  }

  private _onDeny(e: CustomEvent<string>) {
    this.chatClient?.denyPermission(e.detail);
    this.pendingPermission = null;
  }

  private _onAnswer(e: CustomEvent<{ requestId: string; updatedInput: Record<string, unknown> }>) {
    this.chatClient?.answerQuestion(e.detail.requestId, e.detail.updatedInput);
    this.pendingPermission = null;
  }

  // ===== 渲染 =====

  /** 根据工具名返回 emoji 图标 */
  private _toolIcon(name: string): string {
    const icons: Record<string, string> = {
      Bash: "⚡", Read: "📖", Write: "✏️", Edit: "✏️", MultiEdit: "✏️",
      Glob: "🔍", Grep: "🔍", WebFetch: "🌐", WebSearch: "🔎",
      Task: "🤖", TodoWrite: "📋", TodoRead: "📋",
      NotebookEdit: "📓", NotebookRead: "📓",
      LS: "📂", AskUserQuestion: "❓", ExitPlanMode: "✅",
    };
    return icons[name] ?? "🔧";
  }

  /** 从工具 input 提取简短描述 */
  private _toolDesc(name: string, input: Record<string, unknown>): string {
    const s = (v: unknown) => String(v ?? "").slice(0, 80);
    switch (name) {
      case "Bash":        return s(input["command"]);
      case "Read":        return s(input["file_path"]);
      case "Write":       return s(input["file_path"]);
      case "Edit":        return s(input["file_path"]);
      case "MultiEdit":   return s(input["file_path"]);
      case "NotebookEdit":return s(input["notebook_path"]);
      case "NotebookRead":return s(input["notebook_path"]);
      case "Glob":        return s(input["pattern"]);
      case "Grep":        return `"${s(input["pattern"])}"${input["path"] ? ` in ${s(input["path"])}` : ""}`;
      case "WebFetch":    return s(input["url"]);
      case "WebSearch":   return s(input["query"]);
      case "Task":        return s(input["description"]);
      case "LS":          return s(input["path"]);
      default:            return "";
    }
  }

  private _renderConversation(s: SessionDetail["summary"]) {
    const allMessages = this.data!.messages;
    const total = allMessages.length;

    // 折叠状态：只显示展开按钮
    if (this.visibleCount === 0) {
      return html`
        <button
          class="expand-toggle"
          @click=${() => { this.visibleCount = BATCH_SIZE; }}
        >
          <span class="expand-arrow">▶</span>
          查看完整对话（${s.message_count} 条消息，${s.user_turns} 轮）
        </button>
      `;
    }

    // 计算显示范围：从末尾取 visibleCount 条
    const startIdx = Math.max(0, total - this.visibleCount);
    const visibleMessages = allMessages.slice(startIdx);
    const hiddenCount = startIdx;

    return html`
      <div class="toolbar">
        <button
          class="toolbar-btn"
          ?data-active=${this.showOnlyChat}
          @click=${() => { this.showOnlyChat = !this.showOnlyChat; }}
        >
          ${this.showOnlyChat ? "显示全部" : "只看对话"}
        </button>
        ${this.visibleCount < total
          ? html`<button
              class="toolbar-btn"
              @click=${() => { this.visibleCount = total; }}
            >
              显示全部 ${total} 条
            </button>`
          : nothing}
        ${!this.chatMode
          ? html`<button
              class="toolbar-btn"
              @click=${() => { this.visibleCount = 0; }}
            >
              收起对话
            </button>`
          : nothing}
      </div>

      <div class="messages">
        ${hiddenCount > 0
          ? html`<button
              class="load-more"
              @click=${() => {
                this.visibleCount = Math.min(
                  this.visibleCount + BATCH_SIZE,
                  total
                );
              }}
            >
              ↑ 加载更早的消息（还有 ${hiddenCount} 条）
            </button>`
          : nothing}
        ${visibleMessages.map((m) => this._renderMessage(m))}
        ${this.toolActivities.length > 0
          ? html`<div class="activity-log">
              <div class="activity-log-header">
                <span class="activity-log-dot"></span>
                实时活动
              </div>
              <div class="activity-items">
                ${this.toolActivities.map((a) => {
                  const icon = this._toolIcon(a.toolName);
                  const desc = this._toolDesc(a.toolName, a.input);
                  const ts = new Date(a.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return html`
                    <div class="activity-item ${a.complete ? "" : "pending"}">
                      <span class="activity-icon">${icon}</span>
                      <span class="activity-tool">${a.toolName}</span>
                      ${desc ? html`<span class="activity-desc" title=${desc}>${desc}</span>` : nothing}
                      ${!a.complete ? html`<span class="activity-pending-dot">...</span>` : nothing}
                      <span class="activity-ts">${ts}</span>
                    </div>
                  `;
                })}
              </div>
            </div>`
          : nothing}
        ${this.streamingThinking
          ? html`<details class="streaming-thinking">
              <summary>思考中...</summary>
              <pre class="thinking-pre">${this.streamingThinking}</pre>
            </details>`
          : nothing}
        ${this.streamingText
          ? html`<cm-message-bubble
              role="assistant"
              .text=${this.streamingText}
              ?streaming=${true}
            ></cm-message-bubble>`
          : nothing}
        ${this._compacting
          ? html`<div class="compacting-notice">
              <span class="welcome-spinner"></span>
              正在压缩对话历史...
            </div>`
          : nothing}
        ${this._promptTooLong
          ? html`<div class="prompt-too-long">
              <div class="prompt-too-long-title">上下文过长</div>
              <div class="prompt-too-long-desc">对话历史超出模型上下文限制，自动压缩也无法处理。请在工作台新建会话继续。</div>
              <button class="compact-btn" @click=${this._onDismissPromptTooLong}>知道了</button>
            </div>`
          : nothing}
      </div>

      <div class="token-stats">
        输入 ${(s.total_input_tokens / 1000).toFixed(0)}K · 输出
        ${(s.total_output_tokens / 1000).toFixed(0)}K tokens
        ${this.sessionStats ? html`
          · 本次 ${this.sessionStats.input_tokens + this.sessionStats.output_tokens} tokens
          ${this.sessionStats.cost_usd !== null
            ? html`· $${this.sessionStats.cost_usd.toFixed(4)}`
            : nothing}
        ` : nothing}
      </div>
    `;
  }

  private _renderMessage(msg: Message) {
    if (this._isToolResultMessage(msg)) return nothing;

    if (msg.type === "user") {
      const text = this._getTextContent(msg);
      if (!text) return nothing;

      // 后台任务通知：不作为用户消息渲染，改用系统通知样式
      const taskNotif = this._parseTaskNotification(text);
      if (taskNotif) {
        if (taskNotif.status === "output") return nothing; // 任务输出详情直接隐藏
        const icon = taskNotif.status === "running" ? "⏳"
          : taskNotif.status === "completed" ? "✅"
          : taskNotif.status === "failed" ? "❌" : "📋";
        const color = taskNotif.status === "completed" ? "var(--color-working)"
          : taskNotif.status === "failed" ? "var(--color-error)"
          : "var(--color-text-muted)";
        return html`
          <div class="task-notif" style="border-color:${color}">
            <span class="task-notif-icon">${icon}</span>
            <span class="task-notif-id">${taskNotif.taskId ? taskNotif.taskId.slice(0, 7) : "任务"}</span>
            <span class="task-notif-summary">${taskNotif.summary || taskNotif.status}</span>
          </div>`;
      }

      return html`<cm-message-bubble
        role="user"
        .text=${text}
      ></cm-message-bubble>`;
    }

    if (msg.type === "assistant" && Array.isArray(msg.content)) {
      const blocks = msg.content as ContentBlock[];
      return html`
        ${blocks.map((block) => {
          switch (block.type) {
            case "text":
              return block.text
                ? html`<cm-message-bubble
                    role="assistant"
                    .text=${block.text}
                  ></cm-message-bubble>`
                : nothing;

            case "thinking":
              return this.showOnlyChat
                ? nothing
                : html`<cm-thinking-block
                    .content=${block.thinking || ""}
                  ></cm-thinking-block>`;

            case "tool_use":
              if (this.showOnlyChat) return nothing;
              const result = block.id
                ? this.toolResultMap.get(block.id) ?? null
                : null;
              return html`<cm-tool-call
                .toolUse=${block}
                .result=${result}
              ></cm-tool-call>`;

            default:
              return nothing;
          }
        })}
      `;
    }

    if (msg.type === "assistant" && typeof msg.content === "string") {
      return msg.content
        ? html`<cm-message-bubble
            role="assistant"
            .text=${msg.content}
          ></cm-message-bubble>`
        : nothing;
    }

    return nothing;
  }

  private _renderWelcome(s: { project_path: string; project_name: string }) {
    return html`
      <div class="welcome">
        <div class="welcome-icon">&#10043;</div>
        <div class="welcome-title">${this._sessionName || "新会话已就绪"}</div>
        <div class="welcome-project">${s.project_path}</div>
        <div class="welcome-hint">
          在下方输入框发送消息开始对话<br/>
          Claude 将在 <strong>${s.project_name}</strong> 项目目录中工作
        </div>
        ${this.chatState === "closed" && this.chatMode
          ? html`<div class="welcome-connecting">
              <span class="welcome-spinner"></span>
              正在连接...
            </div>`
          : nothing}
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">加载中...</div>`;
    }

    if (!this.data && !this._newSessionProjectPath) {
      return html`<div class="empty">会话不存在</div>`;
    }

    // 新建会话时 data 还为 null，构造最小摘要用于渲染页头
    const projectPath = this.data?.summary.project_path ?? this._newSessionProjectPath;
    const s = this.data?.summary ?? {
      session_id: this.sessionId,
      resume_session_id: null,
      project_path: projectPath,
      project_name: projectPath.split("/").pop() ?? "新会话",
      first_message: null,
      last_assistant_text: null,
      user_turns: 0,
      tool_use_count: 0,
      message_count: 0,
      start_time: null,
      end_time: null,
      git_branch: null,
      is_active: true,
      total_input_tokens: 0,
      total_output_tokens: 0,
      name: this._sessionName || "",
    };

    return html`
      <cm-session-header
        .summary=${s}
        .sessionName=${this._sessionName}
        .chatMode=${this.chatMode}
        .chatConnecting=${this.chatConnecting}
        .hasActiveBroker=${!!this._activeBrokerSession}
        .launchConfig=${this._activeBrokerSession?.launch_config ?? null}
        .source=${this._activeBrokerSession?.source ?? "local"}
        .hostname=${this._activeBrokerSession?.hostname ?? ""}
        @resume=${this._startChat}
        @attach=${this._onAttach}
        @disconnect=${this._disconnectChat}
        @rename=${this._onRename}
      ></cm-session-header>

      <div class="tabs">
        <button
          class="tab"
          ?data-active=${this.activeTab === "conversation"}
          @click=${() => this._switchTab("conversation")}
        >
          对话
        </button>
        <button
          class="tab"
          ?data-active=${this.activeTab === "diff"}
          @click=${() => this._switchTab("diff")}
        >
          代码变更
        </button>
      </div>

      ${this.activeTab === "conversation"
        ? html`
            ${this.data ? html`<cm-session-summary .summary=${s}></cm-session-summary>` : nothing}
            ${this.data ? this._renderConversation(s) : this._renderWelcome(s)}

            ${this.chatMode
              ? html`<cm-chat-input
                  .chatState=${this.chatState}
                  @send-message=${this._onSendMessage}
                  @interrupt=${this._onInterrupt}
                ></cm-chat-input>`
              : nothing}
            <button class="scroll-bottom" @click=${this._scrollToBottom}>
              ↓
            </button>
          `
        : html`
            ${this.diffLoading || this.commitsLoading
              ? html`<div class="loading">加载中...</div>`
              : html`<cm-diff-view
                  .diff=${this.diffContent}
                  .stat=${this.diffStat}
                  .commits=${this.commits}
                  .projectPath=${s.project_path}
                ></cm-diff-view>`}
          `}
      ${this.pendingPermission
        ? html`<cm-permission-dialog
            .request=${this.pendingPermission}
            @approve=${this._onApprove}
            @deny=${this._onDeny}
            @answer=${this._onAnswer}
          ></cm-permission-dialog>`
        : nothing}
    `;
  }
}
