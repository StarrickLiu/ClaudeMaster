// 会话历史浏览页面
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { Project, SessionSummary, SearchResult } from "../api.js";
import { router } from "../router.js";
import "../components/session-card.js";
import "../components/new-session-dialog.js";
import type { NewSessionConfig } from "../components/new-session-dialog.js";

type DateRange = "all" | "today" | "week" | "month";

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function isInRange(isoStr: string | null | undefined, range: DateRange): boolean {
  if (range === "all" || !isoStr) return true;
  const ts = new Date(isoStr).getTime();
  const now = Date.now();
  const today = startOfDay(new Date()).getTime();
  if (range === "today") return ts >= today;
  if (range === "week") return ts >= now - 7 * 86400_000;
  if (range === "month") return ts >= now - 30 * 86400_000;
  return true;
}

@customElement("cm-sessions")
export class SessionsPage extends LitElement {
  @state() projects: Project[] = [];
  @state() sessions: SessionSummary[] = [];
  @state() selectedProject = "";
  @state() searchText = "";
  @state() dateRange: DateRange = "all";
  @state() total = 0;
  @state() loading = true;
  @state() loadingMore = false;

  // 搜索模式
  @state() searchResults: SearchResult[] = [];
  @state() searchLoading = false;
  @state() searchMode = false;   // true = 后端搜索结果

  // 新建会话
  @state() private _newSessionOpen = false;
  @state() private _newSessionStarting = false;
  @state() private _newSessionError = "";

  private _searchDebounce: ReturnType<typeof setTimeout> | null = null;

  static styles = css`
    :host {
      display: block;
    }

    .filters {
      display: flex;
      gap: var(--space-sm);
      margin-bottom: var(--space-lg);
      flex-wrap: wrap;
      align-items: center;
    }

    select, input {
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      background: var(--color-surface);
      color: var(--color-text);
      outline: none;
    }

    select:focus, input:focus {
      border-color: var(--color-primary);
    }

    input {
      flex: 1;
      min-width: 200px;
    }

    .date-tabs {
      display: flex;
      gap: 2px;
      background: var(--color-border-light);
      border-radius: var(--radius-sm);
      padding: 2px;
      flex-shrink: 0;
    }

    .date-tab {
      padding: 4px 10px;
      font-size: var(--font-size-xs);
      border-radius: 4px;
      cursor: pointer;
      color: var(--color-text-secondary);
      transition: all 0.15s;
      border: none;
      background: none;
    }

    .date-tab.active {
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-sm);
    }

    .session-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-md);
    }

    .load-more {
      display: flex;
      justify-content: center;
      padding: var(--space-lg);
    }

    .load-more-btn {
      padding: var(--space-sm) var(--space-xl);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      background: var(--color-surface);
    }

    .load-more-btn:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .loading, .empty {
      text-align: center;
      padding: var(--space-2xl);
      color: var(--color-text-muted);
    }

    .title-row {
      display: flex;
      align-items: center;
      margin-bottom: var(--space-lg);
    }

    .title {
      font-size: var(--font-size-xl);
      font-weight: 600;
      flex: 1;
    }

    .new-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: var(--space-xs) var(--space-md);
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
    }

    .new-btn:hover {
      background: var(--color-primary-hover);
    }

    .search-count {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      padding: 0 var(--space-xs);
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

    /* 搜索结果卡片：显示高亮片段 */
    .search-result {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .snippet-list {
      padding: var(--space-sm) var(--space-md);
      border-top: 1px solid var(--color-border-light);
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }

    .snippet {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .snippet mark {
      background: var(--color-mark-bg, #fef08a);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    // 从 URL query string 读取初始项目筛选（如 #/sessions?project=xxx）
    const query = router.getQuery();
    if (query.project) {
      this.selectedProject = query.project;
    }
    this._loadProjects();
    this._loadSessions();
  }

  private async _loadProjects() {
    try {
      this.projects = await api.getProjects();
    } catch (e) {
      console.error("加载项目失败:", e);
    }
  }

  private async _loadSessions(append = false) {
    if (append) {
      this.loadingMore = true;
    } else {
      this.loading = true;
      this.sessions = [];
    }

    try {
      const params: Record<string, string> = {
        limit: "40",
        offset: append ? String(this.sessions.length) : "0",
      };
      if (this.selectedProject) {
        params["project"] = this.selectedProject;
      }
      const data = await api.getSessions(params);
      this.sessions = append ? [...this.sessions, ...data.items] : data.items;
      this.total = data.total;
    } catch (e) {
      console.error("加载会话失败:", e);
    }

    this.loading = false;
    this.loadingMore = false;
  }

  private _onProjectChange(e: Event) {
    this.selectedProject = (e.target as HTMLSelectElement).value;
    this.searchText = "";
    this.searchMode = false;
    this._loadSessions();
  }

  private _onSearchInput(e: Event) {
    const q = (e.target as HTMLInputElement).value;
    this.searchText = q;

    if (this._searchDebounce) clearTimeout(this._searchDebounce);

    if (!q.trim()) {
      this.searchMode = false;
      return;
    }

    // 300ms debounce → 后端搜索
    this._searchDebounce = setTimeout(() => {
      this._runSearch(q.trim());
    }, 300);
  }

  private async _runSearch(q: string) {
    this.searchLoading = true;
    this.searchMode = true;
    try {
      const data = await api.searchSessions(q, this.selectedProject || undefined);
      this.searchResults = data.items;
    } catch (e) {
      console.error("搜索失败:", e);
      this.searchResults = [];
    }
    this.searchLoading = false;
  }

  private _setDateRange(r: DateRange) {
    this.dateRange = r;
  }

  private _getFilteredSessions(): SessionSummary[] {
    return this.sessions.filter(s => isInRange(s.end_time, this.dateRange));
  }

  private async _onNewSession(e: CustomEvent<NewSessionConfig>) {
    const { projectPath, ...launchConfig } = e.detail;
    this._newSessionOpen = false;
    this._newSessionStarting = true;
    this._newSessionError = "";
    try {
      const result = await api.startChat(projectPath, undefined, {
        model: launchConfig.model || undefined,
        allowedTools: launchConfig.allowedTools.length > 0 ? launchConfig.allowedTools : undefined,
        permissionMode: launchConfig.permissionMode !== "default" ? launchConfig.permissionMode : undefined,
        maxBudgetUsd: launchConfig.maxBudgetUsd ?? undefined,
        maxTurns: launchConfig.maxTurns ?? undefined,
        appendSystemPrompt: launchConfig.appendSystemPrompt || undefined,
        addDirs: launchConfig.addDirs.length > 0 ? launchConfig.addDirs : undefined,
      });
      sessionStorage.setItem(`cm_new_session:${result.session_id}`, result.project_path);
      const encoded = result.project_path.replace(/\//g, "-");
      location.hash = `#/viewer/${encoded}/${result.session_id}`;
    } catch (err) {
      console.error("新建会话失败:", err);
      this._newSessionError = err instanceof Error ? err.message : "启动失败，请检查日志";
    }
    this._newSessionStarting = false;
  }

  private _highlightSnippet(snippet: string): string {
    const q = this.searchText.trim();
    // 先转义 HTML 特殊字符，再插入 <mark>
    const escaped_html = snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (!q) return escaped_html;
    const escaped_q = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped_html.replace(new RegExp(`(${escaped_q})`, "gi"), "<mark>$1</mark>");
  }

  render() {
    if (this.searchMode) {
      return this._renderSearch();
    }

    const filtered = this._getFilteredSessions();
    const hasMore = this.sessions.length < this.total;

    return html`
      <div class="title-row">
        <h1 class="title">会话历史</h1>
        <button class="new-btn" ?disabled=${this._newSessionStarting}
          @click=${() => { this._newSessionOpen = true; }}>
          ${this._newSessionStarting ? "启动中..." : "+ 新建"}
        </button>
      </div>

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

      <div class="filters">
        <select @change=${this._onProjectChange}>
          <option value="">所有项目</option>
          ${this.projects.map(p => html`
            <option value=${p.encoded_name}>${p.name} (${p.session_count})</option>
          `)}
        </select>

        <input
          type="search"
          placeholder="搜索会话内容..."
          .value=${this.searchText}
          @input=${this._onSearchInput}
        />

        <div class="date-tabs">
          ${(["all", "today", "week", "month"] as DateRange[]).map(r => html`
            <button
              class="date-tab ${this.dateRange === r ? "active" : ""}"
              @click=${() => this._setDateRange(r)}
            >${{ all: "全部", today: "今天", week: "7天", month: "30天" }[r]}</button>
          `)}
        </div>
      </div>

      ${this.loading
        ? html`<div class="loading">加载中...</div>`
        : filtered.length > 0
          ? html`
            <div class="session-list">
              ${filtered.map(s => html`<cm-session-card .data=${s}></cm-session-card>`)}
            </div>
            ${hasMore && this.dateRange === "all" ? html`
              <div class="load-more">
                <button class="load-more-btn" @click=${() => this._loadSessions(true)}
                  ?disabled=${this.loadingMore}>
                  ${this.loadingMore ? "加载中..." : `加载更多（${this.total - this.sessions.length} 剩余）`}
                </button>
              </div>
            ` : nothing}
          `
          : html`<div class="empty">暂无匹配的会话</div>`
      }
    `;
  }

  private _renderSearch() {
    return html`
      <div class="title-row">
        <h1 class="title">会话历史</h1>
        <button class="new-btn" ?disabled=${this._newSessionStarting}
          @click=${() => { this._newSessionOpen = true; }}>
          ${this._newSessionStarting ? "启动中..." : "+ 新建"}
        </button>
      </div>

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

      <div class="filters">
        <select @change=${this._onProjectChange}>
          <option value="">所有项目</option>
          ${this.projects.map(p => html`
            <option value=${p.encoded_name}>${p.name} (${p.session_count})</option>
          `)}
        </select>

        <input
          type="search"
          placeholder="搜索会话内容..."
          .value=${this.searchText}
          @input=${this._onSearchInput}
        />

        ${this.searchLoading
          ? html`<span class="search-count">搜索中...</span>`
          : html`<span class="search-count">${this.searchResults.length} 条结果</span>`}
      </div>

      ${this.searchLoading
        ? html`<div class="loading">搜索中...</div>`
        : this.searchResults.length > 0
          ? html`
            <div class="session-list">
              ${this.searchResults.map(r => html`
                <div class="search-result">
                  <cm-session-card .data=${r.summary}></cm-session-card>
                  ${r.snippets.length > 0 ? html`
                    <div class="snippet-list">
                      ${r.snippets.map(s => html`
                        <div class="snippet" .innerHTML=${this._highlightSnippet(s)}></div>
                      `)}
                    </div>
                  ` : nothing}
                </div>
              `)}
            </div>
          `
          : html`<div class="empty">未找到包含"${this.searchText}"的会话</div>`
      }
    `;
  }
}
