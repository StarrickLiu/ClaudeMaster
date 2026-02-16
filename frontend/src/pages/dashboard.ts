// 工作台首页：所有代理状态一览
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import type { ClaudeProcess, SessionSummary } from "../api.js";
import "../components/session-card.js";
import "../components/process-card.js";

@customElement("cm-dashboard")
export class DashboardPage extends LitElement {
  @state() processes: ClaudeProcess[] = [];
  @state() sessions: SessionSummary[] = [];
  @state() loading = true;

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
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    }

    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .dot-working { background: var(--color-working); }
    .dot-recent { background: var(--color-done); }

    .loading, .empty {
      text-align: center;
      padding: var(--space-2xl);
      color: var(--color-text-muted);
    }

    .refresh-btn {
      padding: var(--space-xs) var(--space-md);
      font-size: var(--font-size-sm);
      color: var(--color-primary);
      border: 1px solid var(--color-primary);
      border-radius: var(--radius-sm);
      cursor: pointer;
      margin-left: auto;
    }

    .refresh-btn:hover {
      background: var(--color-primary);
      color: white;
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
  }

  private async _load() {
    this.loading = true;
    try {
      const [procs, sessData] = await Promise.all([
        api.getProcesses(),
        api.getSessions({ limit: "20" }),
      ]);
      this.processes = procs;

      // 标记活跃会话
      const activeCwds = new Set(procs.map(p => p.cwd));
      this.sessions = sessData.items.map(s => ({
        ...s,
        is_active: activeCwds.has(s.project_path),
      }));
    } catch (e) {
      console.error("加载失败:", e);
    }
    this.loading = false;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">加载中...</div>`;
    }

    const activeSessions = this.sessions.filter(s => s.is_active);
    const recentSessions = this.sessions.filter(s => !s.is_active);

    return html`
      <!-- 运行中的进程 -->
      ${this.processes.length > 0 ? html`
        <div class="section">
          <div class="section-title">
            <span class="status-dot dot-working"></span>
            工作中
            <span class="count">(${this.processes.length})</span>
            <button class="refresh-btn" @click=${this._load}>刷新</button>
          </div>
          <div class="card-grid">
            ${this.processes.map(p => html`<cm-process-card .data=${p}></cm-process-card>`)}
          </div>
          ${activeSessions.length > 0 ? html`
            <div class="card-grid" style="margin-top: var(--space-md)">
              ${activeSessions.map(s => html`<cm-session-card .data=${s}></cm-session-card>`)}
            </div>
          ` : nothing}
        </div>
      ` : nothing}

      <!-- 最近会话 -->
      <div class="section">
        <div class="section-title">
          <span class="status-dot dot-recent"></span>
          最近会话
          <span class="count">(${recentSessions.length})</span>
          ${this.processes.length === 0 ? html`
            <button class="refresh-btn" @click=${this._load}>刷新</button>
          ` : nothing}
        </div>
        ${recentSessions.length > 0
          ? html`<div class="card-grid">${recentSessions.map(s => html`<cm-session-card .data=${s}></cm-session-card>`)}</div>`
          : html`<div class="empty">暂无会话记录</div>`
        }
      </div>
    `;
  }
}
