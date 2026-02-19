// 设置页面：暗色模式、访问令牌配置
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

function getTheme(): "light" | "dark" {
  return (localStorage.getItem("cm_theme") as "light" | "dark") || "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "");
  localStorage.setItem("cm_theme", theme);
}

// 初始化主题（在模块加载时执行，避免闪烁）
applyTheme(getTheme());

@customElement("cm-settings")
export class SettingsPage extends LitElement {
  @state() private _theme: "light" | "dark" = getTheme();
  @state() private _tokenSaved = false;
  @state() private _tokenInput = localStorage.getItem("cm_auth_token") || "";

  static styles = css`
    :host {
      display: block;
    }

    .title {
      font-size: var(--font-size-xl);
      font-weight: 600;
      margin-bottom: var(--space-xl);
    }

    .section {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-lg);
      margin-bottom: var(--space-lg);
    }

    .section-title {
      font-size: var(--font-size-base);
      font-weight: 600;
      margin-bottom: var(--space-md);
      color: var(--color-text);
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
    }

    .row-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .row-desc {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: 2px;
    }

    /* 开关 */
    .toggle {
      position: relative;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }

    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }

    .toggle-track {
      position: absolute;
      inset: 0;
      background: var(--color-border);
      border-radius: 12px;
      transition: background 0.2s;
      cursor: pointer;
    }

    .toggle input:checked + .toggle-track {
      background: var(--color-primary);
    }

    .toggle-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 18px;
      height: 18px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
      pointer-events: none;
      box-shadow: var(--shadow-sm);
    }

    .toggle input:checked ~ .toggle-thumb {
      transform: translateX(20px);
    }

    /* 令牌输入区 */
    .token-row {
      display: flex;
      gap: var(--space-sm);
      margin-top: var(--space-md);
    }

    .token-input {
      flex: 1;
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      background: var(--color-bg);
      color: var(--color-text);
      font-family: var(--font-mono);
      outline: none;
    }

    .token-input:focus {
      border-color: var(--color-primary);
    }

    .save-btn {
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

    .save-btn:hover {
      background: var(--color-primary-hover);
    }

    .save-btn.saved {
      background: var(--color-working);
    }

    .clear-btn {
      padding: var(--space-sm) var(--space-md);
      background: none;
      color: var(--color-text-secondary);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }

    .clear-btn:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      margin-top: var(--space-sm);
    }

    .hint code {
      background: var(--color-border-light);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: var(--font-mono);
    }

    .divider {
      border: none;
      border-top: 1px solid var(--color-border);
      margin: var(--space-md) 0;
    }

    .about-row {
      display: flex;
      justify-content: space-between;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      padding: var(--space-xs) 0;
    }

    .about-row span:last-child {
      color: var(--color-text);
      font-family: var(--font-mono);
    }
  `;

  private _toggleTheme(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    this._theme = checked ? "dark" : "light";
    applyTheme(this._theme);
  }

  private _saveToken() {
    if (this._tokenInput.trim()) {
      localStorage.setItem("cm_auth_token", this._tokenInput.trim());
    } else {
      localStorage.removeItem("cm_auth_token");
    }
    this._tokenSaved = true;
    setTimeout(() => { this._tokenSaved = false; }, 1500);
  }

  private _clearToken() {
    localStorage.removeItem("cm_auth_token");
    this._tokenInput = "";
  }

  render() {
    return html`
      <h1 class="title">设置</h1>

      <!-- 外观 -->
      <div class="section">
        <div class="section-title">外观</div>
        <div class="row">
          <div>
            <div class="row-label">暗色模式</div>
            <div class="row-desc">切换深色/浅色主题，设置自动保存</div>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              ?checked=${this._theme === "dark"}
              @change=${this._toggleTheme}
            />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
      </div>

      <!-- 访问控制 -->
      <div class="section">
        <div class="section-title">访问控制</div>
        <div class="row-label">访问令牌</div>
        <div class="row-desc">当后端启用 AUTH_TOKEN 时需要填写，否则留空</div>
        <div class="token-row">
          <input
            class="token-input"
            type="password"
            placeholder="Bearer 令牌..."
            .value=${this._tokenInput}
            @input=${(e: Event) => { this._tokenInput = (e.target as HTMLInputElement).value; }}
          />
          <button
            class="save-btn ${this._tokenSaved ? "saved" : ""}"
            @click=${this._saveToken}
          >
            ${this._tokenSaved ? "已保存 ✓" : "保存"}
          </button>
          <button class="clear-btn" @click=${this._clearToken}>清除</button>
        </div>
        <div class="hint">
          后端通过 <code>AUTH_TOKEN=&lt;token&gt; make dev</code> 启用认证
        </div>
      </div>

      <!-- 关于 -->
      <div class="section">
        <div class="section-title">关于</div>
        <div class="about-row">
          <span>版本</span>
          <span>0.2.0</span>
        </div>
        <hr class="divider" />
        <div class="about-row">
          <span>项目</span>
          <span>ClaudeMaster</span>
        </div>
        <hr class="divider" />
        <div class="about-row">
          <span>后端</span>
          <span>FastAPI + Python 3.11</span>
        </div>
        <hr class="divider" />
        <div class="about-row">
          <span>前端</span>
          <span>Lit + TypeScript + Vite</span>
        </div>
      </div>
    `;
  }
}
