// 代码变更视图：提交记录卡片 + 未提交变更（按文件折叠）
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CommitInfo } from "../api.js";
import { api } from "../api.js";

interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  lines: string[];
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (cur) files.push(cur);
      const m = line.match(/diff --git a\/.+ b\/(.+)/);
      cur = { path: m ? m[1] : line, additions: 0, deletions: 0, lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
      if (line.startsWith("+") && !line.startsWith("+++")) cur.additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) cur.deletions++;
    }
  }
  if (cur) files.push(cur);
  return files;
}

@customElement("cm-diff-view")
export class DiffView extends LitElement {
  @property() diff = "";
  @property() stat = "";
  @property() projectPath = "";
  @property({ type: Array }) commits: CommitInfo[] = [];

  // 记录哪些 commit 已展开及其 diff 内容
  @state() private _expandedCommits = new Map<string, string | null>();
  // null = 加载中，string = 内容

  static styles = css`
    :host { display: block; }

    /* ── 区域标题 ── */
    .section-heading {
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--color-text-secondary);
      margin: var(--space-lg) 0 var(--space-sm);
      display: flex;
      align-items: center;
      gap: var(--space-sm);
    }
    .section-heading:first-child { margin-top: 0; }

    .badge-count {
      font-size: 11px;
      background: var(--color-border-light);
      color: var(--color-text-muted);
      border-radius: 10px;
      padding: 1px 7px;
    }

    /* ── 通用卡片 ── */
    .card {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      overflow: hidden;
      margin-bottom: var(--space-sm);
    }

    .card:last-child { margin-bottom: 0; }

    /* ── 提交卡片头 ── */
    .commit-header {
      display: flex;
      align-items: flex-start;
      gap: var(--space-sm);
      padding: var(--space-sm) var(--space-md);
      background: var(--color-surface);
      cursor: pointer;
      user-select: none;
    }

    .commit-header:hover { background: var(--color-border-light); }

    .commit-arrow {
      font-size: 10px;
      color: var(--color-text-muted);
      margin-top: 3px;
      transition: transform 0.15s;
      flex-shrink: 0;
    }
    .commit-arrow.open { transform: rotate(90deg); }

    .commit-meta {
      flex: 1;
      min-width: 0;
    }

    .commit-subject {
      font-size: var(--font-size-sm);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .commit-info {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      display: flex;
      gap: var(--space-md);
      flex-wrap: wrap;
      margin-top: 2px;
    }

    .hash-tag {
      font-family: var(--font-mono);
      background: var(--color-border-light);
      padding: 0 5px;
      border-radius: 3px;
    }

    .commit-stats {
      display: flex;
      gap: var(--space-xs);
      align-items: center;
      flex-shrink: 0;
    }

    /* ── 文件卡片头 ── */
    .file-header {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      padding: var(--space-xs) var(--space-md);
      background: var(--color-surface);
      cursor: pointer;
      user-select: none;
    }

    .file-header:hover { background: var(--color-border-light); }

    .file-path {
      flex: 1;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── +N -M 徽标 ── */
    .add-badge {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--color-diff-add-text, #16a34a);
      font-weight: 600;
    }
    .del-badge {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--color-diff-del-text, #dc2626);
      font-weight: 600;
    }

    /* ── diff 正文 ── */
    .diff-body {
      border-top: 1px solid var(--color-border);
      overflow-x: auto;
    }

    .diff-line {
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      line-height: 1.6;
      padding: 0 var(--space-md);
      white-space: pre;
      min-height: 1.6em;
    }

    .add  { background: var(--color-diff-add-bg);  color: var(--color-diff-add-text); }
    .del  { background: var(--color-diff-del-bg);  color: var(--color-diff-del-text); }
    .hunk {
      background: #eef2ff;
      color: var(--color-diff-hunk, #4338ca);
      font-weight: 500;
      padding-top: 4px;
      padding-bottom: 4px;
    }
    .fhdr {
      background: var(--color-border-light);
      font-weight: 600;
      padding-top: 4px;
      padding-bottom: 4px;
    }

    .loading-diff {
      padding: var(--space-md);
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      text-align: center;
    }

    .empty {
      padding: var(--space-xl);
      text-align: center;
      color: var(--color-text-muted);
      font-size: var(--font-size-sm);
    }
  `;

  /* ── 工具 ── */
  private _lineClass(line: string): string {
    if (line.startsWith("diff ") || line.startsWith("index ") ||
        line.startsWith("--- ") || line.startsWith("+++ ")) return "fhdr";
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("+")) return "add";
    if (line.startsWith("-")) return "del";
    return "";
  }

  private _renderDiffLines(lines: string[]) {
    return lines
      .filter(l => !l.startsWith("diff --git") && !l.startsWith("index ") && l !== "\\ No newline at end of file")
      .map(l => html`<div class="diff-line ${this._lineClass(l)}">${l}</div>`);
  }

  private async _toggleCommit(hash: string) {
    if (this._expandedCommits.has(hash)) {
      // 收起
      const m = new Map(this._expandedCommits);
      m.delete(hash);
      this._expandedCommits = m;
      return;
    }
    // 展开：标记加载中
    this._expandedCommits = new Map(this._expandedCommits).set(hash, null);
    try {
      const result = await api.getCommitDiff(this.projectPath, hash);
      this._expandedCommits = new Map(this._expandedCommits).set(hash, result.diff);
    } catch {
      this._expandedCommits = new Map(this._expandedCommits).set(hash, "（加载失败）");
    }
  }

  private _fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString("zh-CN", {
        month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  }

  /* ── 渲染提交记录 ── */
  private _renderCommits() {
    if (!this.commits.length) return nothing;
    return html`
      <div class="section-heading">
        提交记录
        <span class="badge-count">${this.commits.length}</span>
      </div>
      ${this.commits.map(c => {
        const open = this._expandedCommits.has(c.hash);
        const diffContent = this._expandedCommits.get(c.hash);
        return html`
          <div class="card">
            <div class="commit-header" @click=${() => this._toggleCommit(c.hash)}>
              <span class="commit-arrow ${open ? "open" : ""}">▶</span>
              <div class="commit-meta">
                <div class="commit-subject" title=${c.subject}>${c.subject}</div>
                <div class="commit-info">
                  <span class="hash-tag">${c.short_hash}</span>
                  <span>${c.author}</span>
                  <span>${this._fmtDate(c.date)}</span>
                  <span>${c.files_changed} 文件</span>
                </div>
              </div>
              <div class="commit-stats">
                ${c.insertions ? html`<span class="add-badge">+${c.insertions}</span>` : nothing}
                ${c.deletions  ? html`<span class="del-badge">-${c.deletions}</span>`  : nothing}
              </div>
            </div>
            ${open ? html`
              <div class="diff-body">
                ${diffContent === null
                  ? html`<div class="loading-diff">加载中...</div>`
                  : parseDiff(diffContent!).map(f => this._renderFileCard(f))}
              </div>
            ` : nothing}
          </div>
        `;
      })}
    `;
  }

  /* ── 渲染单个文件折叠卡片 ── */
  private _renderFileCard(f: FileDiff) {
    return html`
      <details>
        <summary class="file-header">
          <span class="commit-arrow">▶</span>
          <span class="file-path" title=${f.path}>${f.path}</span>
          ${f.additions ? html`<span class="add-badge">+${f.additions}</span>` : nothing}
          ${f.deletions  ? html`<span class="del-badge">-${f.deletions}</span>`  : nothing}
        </summary>
        <div class="diff-body">
          ${this._renderDiffLines(f.lines)}
        </div>
      </details>
    `;
  }

  /* ── 渲染未提交变更 ── */
  private _renderUncommitted() {
    const files = parseDiff(this.diff);
    if (!files.length) return nothing;
    return html`
      <div class="section-heading">
        未提交变更
        <span class="badge-count">${files.length} 文件</span>
      </div>
      ${files.map(f => html`<div class="card">${this._renderFileCard(f)}</div>`)}
    `;
  }

  render() {
    const hasCommits = this.commits.length > 0;
    const hasUncommitted = this.diff.trim().length > 0;

    if (!hasCommits && !hasUncommitted) {
      return html`<div class="empty">无提交记录和代码变更</div>`;
    }

    return html`
      ${this._renderCommits()}
      ${this._renderUncommitted()}
    `;
  }
}
