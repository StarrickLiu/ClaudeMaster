// 产品文档页面：多页导航 + 三栏布局（左侧导航 + 主内容 + 右侧目录）
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { renderMarkdown } from "../utils/markdown.js";

// ─── 导航结构 ───

interface NavItem {
  slug: string;
  title: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "开始",
    items: [{ slug: "overview", title: "产品概述" }],
  },
  {
    label: "功能",
    items: [
      { slug: "dashboard", title: "工作台" },
      { slug: "pages", title: "页面结构" },
      { slug: "chat", title: "交互式会话" },
    ],
  },
  {
    label: "技术",
    items: [
      { slug: "architecture", title: "技术架构" },
      { slug: "development", title: "开发指南" },
    ],
  },
];

const ALL_PAGES = NAV.flatMap((g) => g.items);

// ─── 工具函数 ───

interface HeadingItem {
  level: number;
  text: string;
  id: string;
}

function extractHeadings(md: string): HeadingItem[] {
  const result: HeadingItem[] = [];
  const re = /^(#{2,3})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  const used = new Set<string>();
  while ((m = re.exec(md)) !== null) {
    const text = m[2].trim();
    let id = slugify(text);
    if (used.has(id)) {
      let i = 2;
      while (used.has(`${id}-${i}`)) i++;
      id = `${id}-${i}`;
    }
    used.add(id);
    result.push({ level: m[1].length, text, id });
  }
  return result;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[（(]/g, "-")
    .replace(/[）)]/g, "")
    .replace(/[^\w\u4e00-\u9fff-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function injectHeadingIds(htmlStr: string, headings: HeadingItem[]): string {
  let result = htmlStr;
  for (const h of headings) {
    const tag = `h${h.level}`;
    const escaped = h.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<${tag}>\\s*(${escaped})\\s*</${tag}>`, "i");
    result = result.replace(re, `<${tag} id="${h.id}">$1</${tag}>`);
  }
  return result;
}

// ─── 组件 ───

@customElement("cm-docs")
export class DocsPage extends LitElement {
  @property() page = "overview";

  @state() private _html = "";
  @state() private _headings: HeadingItem[] = [];
  @state() private _activeId = "";
  @state() private _sidebarOpen = false;
  @state() private _loading = true;
  @state() private _error = "";

  private _observer: IntersectionObserver | null = null;
  private _loadedSlug = "";

  static styles = css`
    :host {
      display: block;
      width: 100vw;
      margin-left: calc(-1 * (100vw - 100%) / 2);
      max-width: 100vw;
      box-sizing: border-box;
    }

    .loading, .error {
      text-align: center;
      padding: var(--space-2xl);
      color: var(--color-text-muted);
    }
    .error { color: var(--color-error); }

    /* ─── 三栏布局 ─── */
    .docs-layout {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr) 180px;
      max-width: 1400px;
      margin: 0 auto;
      min-height: calc(100vh - 72px);
    }

    /* ─── 左侧导航 ─── */
    .sidebar {
      position: sticky;
      top: 72px;
      height: calc(100vh - 72px);
      overflow-y: auto;
      padding: var(--space-lg) 0 var(--space-lg) var(--space-lg);
      border-right: 1px solid var(--color-border);
      scrollbar-width: thin;
    }

    .nav-group {
      margin-bottom: var(--space-lg);
    }

    .nav-group-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      padding: 0 var(--space-sm);
      margin-bottom: var(--space-xs);
    }

    .nav-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .nav-item {
      margin: 0;
    }

    .nav-link {
      display: block;
      padding: 6px var(--space-sm);
      margin: 1px 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      text-decoration: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.12s;
      line-height: 1.5;
      border-left: 2px solid transparent;
    }

    .nav-link:hover {
      color: var(--color-text);
      background: var(--color-border-light);
    }

    .nav-link.active {
      color: var(--color-primary);
      background: var(--color-border-light);
      border-left-color: var(--color-primary);
      font-weight: 500;
    }

    /* ─── 主内容 ─── */
    .doc-content {
      padding: var(--space-lg) var(--space-xl) var(--space-2xl);
      max-width: 780px;
      color: var(--color-text);
      line-height: 1.75;
      font-size: var(--font-size-base);
    }

    .doc-content h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin: 0 0 var(--space-md);
      line-height: 1.3;
    }

    .doc-content h2 {
      font-size: 1.35rem;
      font-weight: 700;
      margin: var(--space-2xl) 0 var(--space-md);
      padding-bottom: var(--space-xs);
      border-bottom: 1px solid var(--color-border);
      line-height: 1.3;
      scroll-margin-top: 80px;
    }

    .doc-content h3 {
      font-size: 1.1rem;
      font-weight: 600;
      margin: var(--space-xl) 0 var(--space-sm);
      line-height: 1.4;
      scroll-margin-top: 80px;
    }

    .doc-content p { margin: var(--space-sm) 0; }

    .doc-content blockquote {
      margin: var(--space-md) 0;
      padding: var(--space-sm) var(--space-md);
      border-left: 4px solid var(--color-primary);
      background: var(--color-border-light);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }

    .doc-content blockquote p { margin: var(--space-xs) 0; }

    .doc-content code {
      font-family: var(--font-mono);
      font-size: 0.88em;
      background: var(--color-border-light);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .doc-content pre {
      background: #1e1e2e;
      color: #cdd6f4;
      padding: var(--space-md);
      border-radius: var(--radius-md);
      overflow-x: auto;
      font-size: var(--font-size-sm);
      line-height: 1.6;
      margin: var(--space-md) 0;
    }

    .doc-content pre code {
      background: none;
      padding: 0;
      color: inherit;
      font-size: inherit;
    }

    .doc-content table {
      width: 100%;
      border-collapse: collapse;
      margin: var(--space-md) 0;
      font-size: var(--font-size-sm);
    }

    .doc-content th,
    .doc-content td {
      border: 1px solid var(--color-border);
      padding: var(--space-sm) var(--space-md);
      text-align: left;
    }

    .doc-content th {
      background: var(--color-border-light);
      font-weight: 600;
    }

    .doc-content hr {
      border: none;
      border-top: 1px solid var(--color-border);
      margin: var(--space-xl) 0;
    }

    .doc-content ul,
    .doc-content ol {
      padding-left: var(--space-lg);
      margin: var(--space-sm) 0;
    }

    .doc-content li { margin: var(--space-xs) 0; }
    .doc-content li + li { margin-top: 4px; }
    .doc-content strong { font-weight: 600; }

    .doc-content a {
      color: var(--color-primary);
      text-decoration: none;
    }
    .doc-content a:hover { text-decoration: underline; }

    /* 上下页导航 */
    .page-nav {
      display: flex;
      justify-content: space-between;
      margin-top: var(--space-2xl);
      padding-top: var(--space-lg);
      border-top: 1px solid var(--color-border);
      gap: var(--space-md);
    }

    .page-nav-link {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--space-sm) var(--space-md);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      text-decoration: none;
      color: var(--color-text);
      cursor: pointer;
      transition: all 0.12s;
      min-width: 0;
      max-width: 48%;
    }

    .page-nav-link:hover {
      border-color: var(--color-primary);
      background: var(--color-border-light);
    }

    .page-nav-link.next { margin-left: auto; text-align: right; }

    .page-nav-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .page-nav-title {
      font-size: var(--font-size-sm);
      font-weight: 500;
      color: var(--color-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ─── 右侧目录 ─── */
    .toc {
      position: sticky;
      top: 72px;
      height: calc(100vh - 72px);
      overflow-y: auto;
      padding: var(--space-lg) var(--space-md) var(--space-lg) var(--space-md);
      border-left: 1px solid var(--color-border);
      scrollbar-width: thin;
    }

    .toc-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin-bottom: var(--space-sm);
    }

    .toc-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .toc-link {
      display: block;
      padding: 3px 0;
      font-size: 12px;
      color: var(--color-text-muted);
      text-decoration: none;
      cursor: pointer;
      transition: color 0.12s;
      line-height: 1.5;
    }

    .toc-link:hover { color: var(--color-text); }
    .toc-link.active { color: var(--color-primary); font-weight: 500; }
    .toc-link.sub { padding-left: 12px; }

    /* ─── 移动端 ─── */
    .mobile-menu-btn {
      display: none;
      position: fixed;
      bottom: 72px;
      right: var(--space-md);
      z-index: 200;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--color-primary);
      color: white;
      border: none;
      box-shadow: var(--shadow-lg);
      cursor: pointer;
      font-size: 20px;
      align-items: center;
      justify-content: center;
    }

    .sidebar-backdrop { display: none; }

    @media (max-width: 1080px) {
      .docs-layout { grid-template-columns: 240px minmax(0, 1fr); }
      .toc { display: none; }
    }

    @media (max-width: 768px) {
      :host { margin-left: 0; width: 100%; }
      .docs-layout { grid-template-columns: 1fr; }
      .toc { display: none; }

      .sidebar {
        display: none;
        position: fixed;
        top: 0; left: 0; bottom: 0;
        width: 280px;
        z-index: 300;
        background: var(--color-surface);
        box-shadow: var(--shadow-lg);
        padding-top: var(--space-xl);
      }

      .sidebar.open { display: block; }

      .sidebar-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.4);
        z-index: 299;
      }

      .sidebar-backdrop.open { display: block; }
      .mobile-menu-btn { display: flex; }

      .doc-content { padding: var(--space-md); }

      .doc-content table { font-size: var(--font-size-xs); }
      .doc-content th, .doc-content td { padding: var(--space-xs) var(--space-sm); }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._loadPage(this.page);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._observer?.disconnect();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("page") && this.page !== this._loadedSlug) {
      this._loadPage(this.page);
    }
  }

  private async _loadPage(slug: string) {
    this._loading = true;
    this._error = "";
    this._observer?.disconnect();

    try {
      const res = await fetch(`/docs/${slug}.md`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const md = await res.text();
      this._headings = extractHeadings(md);
      this._html = injectHeadingIds(renderMarkdown(md), this._headings);
      this._activeId = this._headings.length > 0 ? this._headings[0].id : "";
      this._loadedSlug = slug;
    } catch (e) {
      this._error = e instanceof Error ? e.message : "加载失败";
    }

    this._loading = false;
    this._sidebarOpen = false;

    await this.updateComplete;
    this._setupScrollSpy();

    // 滚动到顶部
    const content = this.shadowRoot?.querySelector(".doc-content");
    content?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }

  private _setupScrollSpy() {
    const content = this.shadowRoot?.querySelector(".doc-content");
    if (!content) return;
    const els = content.querySelectorAll("h2[id], h3[id]");
    if (els.length === 0) return;

    this._observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this._activeId = entry.target.id;
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );

    els.forEach((el) => this._observer!.observe(el));
  }

  private _scrollTo(id: string) {
    const el = this.shadowRoot?.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      this._activeId = id;
    }
    this._sidebarOpen = false;
  }

  private _navigate(slug: string) {
    location.hash = `#/docs/${slug}`;
    this._sidebarOpen = false;
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">加载文档中...</div>`;
    }
    if (this._error) {
      return html`<div class="error">文档加载失败：${this._error}</div>`;
    }

    // 上下页
    const idx = ALL_PAGES.findIndex((p) => p.slug === this.page);
    const prev = idx > 0 ? ALL_PAGES[idx - 1] : null;
    const next = idx < ALL_PAGES.length - 1 ? ALL_PAGES[idx + 1] : null;

    return html`
      <div
        class="sidebar-backdrop ${this._sidebarOpen ? "open" : ""}"
        @click=${() => { this._sidebarOpen = false; }}
      ></div>

      <button
        class="mobile-menu-btn"
        @click=${() => { this._sidebarOpen = !this._sidebarOpen; }}
      >${this._sidebarOpen ? "\u2715" : "\u2630"}</button>

      <div class="docs-layout">
        <!-- 左侧导航 -->
        <nav class="sidebar ${this._sidebarOpen ? "open" : ""}">
          ${NAV.map(
            (group) => html`
              <div class="nav-group">
                <div class="nav-group-label">${group.label}</div>
                <ul class="nav-list">
                  ${group.items.map(
                    (item) => html`
                      <li class="nav-item">
                        <a
                          class="nav-link ${this.page === item.slug ? "active" : ""}"
                          @click=${() => this._navigate(item.slug)}
                        >${item.title}</a>
                      </li>
                    `
                  )}
                </ul>
              </div>
            `
          )}
        </nav>

        <!-- 主内容 -->
        <article class="doc-content">
          ${unsafeHTML(this._html)}

          <!-- 上下页导航 -->
          <div class="page-nav">
            ${prev
              ? html`
                  <a class="page-nav-link prev" @click=${() => this._navigate(prev.slug)}>
                    <span class="page-nav-hint">\u2190 上一篇</span>
                    <span class="page-nav-title">${prev.title}</span>
                  </a>
                `
              : html`<span></span>`}
            ${next
              ? html`
                  <a class="page-nav-link next" @click=${() => this._navigate(next.slug)}>
                    <span class="page-nav-hint">下一篇 \u2192</span>
                    <span class="page-nav-title">${next.title}</span>
                  </a>
                `
              : nothing}
          </div>
        </article>

        <!-- 右侧目录 -->
        <aside class="toc">
          ${this._headings.length > 0
            ? html`
                <div class="toc-title">本页目录</div>
                <ul class="toc-list">
                  ${this._headings.map(
                    (h) => html`
                      <li>
                        <a
                          class="toc-link ${h.level === 3 ? "sub" : ""} ${this._activeId === h.id ? "active" : ""}"
                          @click=${() => this._scrollTo(h.id)}
                        >${h.text}</a>
                      </li>
                    `
                  )}
                </ul>
              `
            : nothing}
        </aside>
      </div>
    `;
  }
}
