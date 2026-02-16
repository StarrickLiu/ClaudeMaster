// 会话历史浏览页面
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { Project, SessionSummary } from "../api.js";
import "../components/session-card.js";

@customElement("cm-sessions")
export class SessionsPage extends LitElement {
  @state() projects: Project[] = [];
  @state() sessions: SessionSummary[] = [];
  @state() selectedProject = "";
  @state() searchText = "";
  @state() total = 0;
  @state() loading = true;
  @state() loadingMore = false;

  static styles = css`
    :host {
      display: block;
    }

    .filters {
      display: flex;
      gap: var(--space-md);
      margin-bottom: var(--space-lg);
      flex-wrap: wrap;
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

    .title {
      font-size: var(--font-size-xl);
      font-weight: 600;
      margin-bottom: var(--space-lg);
    }
  `;

  connectedCallback() {
    super.connectedCallback();
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
        limit: "20",
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
    this._loadSessions();
  }

  private _onSearchInput(e: Event) {
    this.searchText = (e.target as HTMLInputElement).value;
  }

  private _getFilteredSessions(): SessionSummary[] {
    if (!this.searchText) return this.sessions;
    const q = this.searchText.toLowerCase();
    return this.sessions.filter(s =>
      (s.first_message || "").toLowerCase().includes(q) ||
      s.project_name.toLowerCase().includes(q)
    );
  }

  render() {
    const filtered = this._getFilteredSessions();

    return html`
      <h1 class="title">会话历史</h1>

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
      </div>

      ${this.loading
        ? html`<div class="loading">加载中...</div>`
        : filtered.length > 0
          ? html`
            <div class="session-list">
              ${filtered.map(s => html`<cm-session-card .data=${s}></cm-session-card>`)}
            </div>
            ${this.sessions.length < this.total ? html`
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
}
