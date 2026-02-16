// 顶部/底部导航栏组件
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("cm-nav-bar")
export class NavBar extends LitElement {
  @property() active = "dashboard";

  static styles = css`
    :host {
      display: block;
    }

    /* 桌面端顶部导航 */
    .desktop-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--space-lg);
      height: 56px;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      box-shadow: var(--shadow-sm);
    }

    .logo {
      font-size: var(--font-size-xl);
      font-weight: 700;
      color: var(--color-primary);
      letter-spacing: -0.5px;
    }

    .nav-links {
      display: flex;
      gap: var(--space-xs);
    }

    .nav-link {
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      transition: all 0.15s;
    }

    .nav-link:hover {
      background: var(--color-border-light);
      color: var(--color-text);
    }

    .nav-link[data-active] {
      background: var(--color-primary);
      color: white;
    }

    /* 移动端底部导航 */
    .mobile-nav {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 56px;
      background: var(--color-surface);
      border-top: 1px solid var(--color-border);
      z-index: 100;
    }

    .mobile-tabs {
      display: flex;
      height: 100%;
    }

    .mobile-tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      font-size: 10px;
      color: var(--color-text-secondary);
      transition: color 0.15s;
    }

    .mobile-tab[data-active] {
      color: var(--color-primary);
    }

    .mobile-tab svg {
      width: 22px;
      height: 22px;
    }

    @media (max-width: 768px) {
      .desktop-nav { display: none; }
      .mobile-nav { display: block; }
    }

    @media (min-width: 769px) {
      .desktop-nav { display: flex; }
      .mobile-nav { display: none; }
    }
  `;

  render() {
    return html`
      <nav class="desktop-nav">
        <span class="logo">ClaudeMaster</span>
        <div class="nav-links">
          <a class="nav-link" href="#/dashboard" ?data-active=${this.active === "dashboard"}>工作台</a>
          <a class="nav-link" href="#/sessions" ?data-active=${this.active === "sessions"}>会话历史</a>
        </div>
      </nav>
      <nav class="mobile-nav">
        <div class="mobile-tabs">
          <a class="mobile-tab" href="#/dashboard" ?data-active=${this.active === "dashboard"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            工作台
          </a>
          <a class="mobile-tab" href="#/sessions" ?data-active=${this.active === "sessions"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            历史
          </a>
        </div>
      </nav>
    `;
  }
}
