// 用量仪表卡片：今日 token + 费用 + 配额余量 + 可切换时间跨度的柱状图
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { UsageResponse, QuotaResponse, DailyUsage } from "../api.js";
import { api } from "../api.js";

const SPAN_OPTIONS = [
  { label: "7天", days: 7 },
  { label: "14天", days: 14 },
  { label: "30天", days: 30 },
];

@customElement("cm-usage-card")
export class UsageCard extends LitElement {
  @property({ type: Object }) data!: UsageResponse;
  @property({ type: Object }) quota: QuotaResponse | null = null;

  @state() private _chartDays = 7;
  @state() private _chartData: DailyUsage[] | null = null;
  @state() private _chartLoading = false;

  connectedCallback() {
    super.connectedCallback();
    this._loadChart(this._chartDays);
  }

  private async _loadChart(days: number) {
    this._chartLoading = true;
    try {
      this._chartData = await api.getUsageChart(days);
    } catch (e) {
      console.error("加载图表数据失败:", e);
      this._chartData = this.data.daily; // fallback
    } finally {
      this._chartLoading = false;
    }
  }

  private _setSpan(days: number) {
    if (days === this._chartDays) return;
    this._chartDays = days;
    this._loadChart(days);
  }

  static styles = css`
    :host { display: block; }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: var(--space-md) var(--space-lg);
    }

    /* ── 顶部统计 ── */
    .stats-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--space-lg);
      margin-bottom: var(--space-md);
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .stat-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .stat-value {
      font-size: var(--font-size-xl);
      font-weight: 700;
      color: var(--color-text);
      font-variant-numeric: tabular-nums;
    }

    .stat-sub {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    /* ── 配额进度条 ── */
    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--color-border-light);
      border-radius: 3px;
      overflow: hidden;
      margin-top: var(--space-xs);
    }

    .progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    .fill-low  { background: var(--color-working); }
    .fill-mid  { background: var(--color-attention); }
    .fill-high { background: var(--color-error); }

    .quota-section {
      border-top: 1px solid var(--color-border-light);
      padding-top: var(--space-sm);
      margin-top: var(--space-sm);
    }

    .quota-row {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
      margin-bottom: var(--space-sm);
    }

    .quota-row:last-child { margin-bottom: 0; }

    .quota-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }

    .quota-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    .quota-pct {
      font-size: var(--font-size-sm);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .quota-reset {
      font-size: 10px;
      color: var(--color-text-muted);
    }

    .quota-error {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      padding-top: var(--space-xs);
    }

    /* ── 柱状图区域 ── */
    .chart-section {
      border-top: 1px solid var(--color-border-light);
      padding-top: var(--space-md);
      margin-top: var(--space-sm);
    }

    /* 顶部工具栏：标题 + 时间跨度选择器 */
    .chart-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-sm);
    }

    .chart-title {
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .span-tabs {
      display: flex;
      gap: 2px;
      background: var(--color-border-light);
      border-radius: var(--radius-sm);
      padding: 2px;
    }

    .span-tab {
      padding: 2px 10px;
      font-size: 11px;
      border-radius: calc(var(--radius-sm) - 1px);
      border: none;
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .span-tab[data-active] {
      background: var(--color-surface);
      color: var(--color-text);
      box-shadow: var(--shadow-sm);
    }

    .span-tab:hover:not([data-active]) {
      color: var(--color-text-secondary);
    }

    /* Y 轴参考值 */
    .chart-yaxis {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: flex-end;
      width: 32px;
      flex-shrink: 0;
      height: 100%;
      padding-bottom: 4px;
    }

    .y-label {
      font-size: 9px;
      color: var(--color-text-muted);
      line-height: 1;
    }

    /* 图表主体 */
    .chart-body {
      display: flex;
      gap: 6px;
      align-items: stretch;
    }

    .chart-bars-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    /* 参考线背景 */
    .chart-grid-bg {
      flex: 1;
      position: relative;
      display: flex;
      align-items: flex-end;
    }

    .chart-grid-bg::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(to bottom,
          transparent calc(0% - 0.5px),   transparent calc(0%),
          var(--color-border-light) calc(0%),   var(--color-border-light) calc(0% + 1px),
          transparent calc(0% + 1px),
          transparent calc(25% - 0.5px), var(--color-border-light) calc(25%), var(--color-border-light) calc(25% + 1px), transparent calc(25% + 1px),
          transparent calc(50% - 0.5px), var(--color-border-light) calc(50%), var(--color-border-light) calc(50% + 1px), transparent calc(50% + 1px),
          transparent calc(75% - 0.5px), var(--color-border-light) calc(75%), var(--color-border-light) calc(75% + 1px), transparent calc(75% + 1px),
          transparent calc(100% - 1px),  var(--color-border-light) 100%
        );
      pointer-events: none;
    }

    .bars-row {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      width: 100%;
      height: 100%;
    }

    /* 单列：值标签 + 柱体 + 日期 */
    .bar-col {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      height: 100%;
      gap: 2px;
    }

    .bar-val {
      font-size: 9px;
      font-variant-numeric: tabular-nums;
      color: var(--color-text-secondary);
      white-space: nowrap;
      line-height: 1;
      transition: opacity 0.15s;
      overflow: hidden;
      text-overflow: clip;
      max-width: 100%;
      text-align: center;
    }

    .bar-val.is-today { color: var(--color-primary); font-weight: 700; }
    .bar-val.is-zero  { opacity: 0; }

    .bar-body {
      width: 75%;
      min-height: 2px;
      border-radius: 3px 3px 0 0;
      background: var(--color-primary);
      opacity: 0.45;
      transition: height 0.3s ease, opacity 0.15s;
      position: relative;
      cursor: default;
    }

    .bar-body.is-today {
      opacity: 0.9;
    }

    .bar-body.is-zero {
      background: var(--color-border);
      opacity: 0.3;
    }

    .bar-body:not(.is-zero):hover {
      opacity: 1;
    }

    /* tooltip on hover */
    .bar-body[data-tip]::after {
      content: attr(data-tip);
      position: absolute;
      bottom: calc(100% + 5px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-text);
      color: var(--color-surface);
      font-size: 10px;
      line-height: 1.4;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 20;
    }

    .bar-body:hover[data-tip]::after { opacity: 1; }

    .bar-date {
      font-size: 9px;
      color: var(--color-text-muted);
      white-space: nowrap;
      line-height: 1;
      text-align: center;
      overflow: hidden;
    }

    .bar-date.is-today {
      color: var(--color-primary);
      font-weight: 700;
    }

    .bar-date.is-hidden { visibility: hidden; }

    /* 图表加载占位 */
    .chart-placeholder {
      height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }

    @media (max-width: 768px) {
      .stats-row { grid-template-columns: 1fr; gap: var(--space-sm); }
    }
  `;

  /* ── 格式化工具 ── */

  private _fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000)      return `${(n / 1000).toFixed(1)}K`;
    return `${n}`;
  }

  private _fmtShort(n: number): string {
    // 更紧凑的格式，用于柱体上方标签
    if (n === 0) return "";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1000)      return `${Math.round(n / 1000)}K`;
    return `${n}`;
  }

  private _fmtCost(n: number): string {
    if (n >= 1)    return `$${n.toFixed(2)}`;
    if (n >= 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(4)}`;
  }

  private _fillClass(pct: number): string {
    return pct < 60 ? "fill-low" : pct < 85 ? "fill-mid" : "fill-high";
  }

  private _quotaColor(u: number): string {
    if (u >= 85) return "var(--color-error)";
    if (u >= 60) return "var(--color-attention)";
    return "var(--color-working)";
  }

  private _formatReset(resets_at: string | null): string {
    if (!resets_at) return "";
    try {
      const diff = new Date(resets_at).getTime() - Date.now();
      if (diff <= 0) return "即将重置";
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      return h > 0 ? `${h}h ${m}m 后重置` : `${m}m 后重置`;
    } catch { return ""; }
  }

  /* ── 子渲染 ── */

  private _renderQuotaRow(label: string, w: { utilization: number; remaining: number; resets_at: string | null }) {
    return html`
      <div class="quota-row">
        <div class="quota-header">
          <span class="quota-label">${label}</span>
          <span class="quota-pct" style="color:${this._quotaColor(w.utilization)}">
            剩余 ${w.remaining}%
          </span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${this._fillClass(w.utilization)}" style="width:${w.utilization}%"></div>
        </div>
        <span class="quota-reset">${this._formatReset(w.resets_at)}</span>
      </div>
    `;
  }

  private _renderQuota() {
    const q = this.quota;
    if (!q) return nothing;
    if (q.error) return html`<div class="quota-error">配额查询失败：${q.error}</div>`;
    const hasAny = q.five_hour || q.seven_day || q.seven_day_sonnet || q.seven_day_opus;
    if (!hasAny) return nothing;
    return html`
      <div class="quota-section">
        ${q.five_hour        ? this._renderQuotaRow("5小时配额",        q.five_hour)        : nothing}
        ${q.seven_day        ? this._renderQuotaRow("7天配额",           q.seven_day)        : nothing}
        ${q.seven_day_sonnet ? this._renderQuotaRow("7天 Sonnet 配额",   q.seven_day_sonnet) : nothing}
        ${q.seven_day_opus   ? this._renderQuotaRow("7天 Opus 配额",     q.seven_day_opus)   : nothing}
      </div>
    `;
  }

  private _renderChart() {
    const daily = this._chartData;
    const loading = this._chartLoading;
    const days = this._chartDays;

    // Y 轴最大值
    const maxTokens = daily ? Math.max(0, ...daily.map(d => d.total_tokens)) : 0;
    const yLabels = maxTokens > 0
      ? [this._fmt(maxTokens), this._fmt(maxTokens * 0.75), this._fmt(maxTokens * 0.5), this._fmt(maxTokens * 0.25), "0"]
      : ["", "", "", "", ""];

    // 日期标签显示策略
    const today = new Date().toISOString().slice(0, 10);
    const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : 5;

    const CHART_HEIGHT = 100; // px

    return html`
      <div class="chart-section">
        <div class="chart-toolbar">
          <span class="chart-title">每日用量</span>
          <div class="span-tabs">
            ${SPAN_OPTIONS.map(({ label, days: d }) => html`
              <button
                class="span-tab"
                ?data-active=${this._chartDays === d}
                @click=${() => this._setSpan(d)}
              >${label}</button>
            `)}
          </div>
        </div>

        ${loading && !daily ? html`<div class="chart-placeholder">加载中...</div>` : html`
          <div class="chart-body">
            <!-- Y 轴标签 -->
            <div class="chart-yaxis" style="height:${CHART_HEIGHT}px">
              ${yLabels.map(l => html`<span class="y-label">${l}</span>`)}
            </div>

            <!-- 柱体区域 -->
            <div class="chart-bars-area">
              <div class="chart-grid-bg" style="height:${CHART_HEIGHT}px">
                <div class="bars-row">
                  ${(daily ?? []).map((day, idx) => {
                    const isToday = day.date === today;
                    const isZero = day.total_tokens === 0;
                    const heightPx = maxTokens > 0 && !isZero
                      ? Math.max(3, Math.round((day.total_tokens / maxTokens) * CHART_HEIGHT))
                      : 3;
                    const showLabel = !loading && !isZero;
                    // 仅在应显示的间隔或今日显示日期
                    const showDate = isToday || idx % labelEvery === 0;
                    const tip = isZero
                      ? `${day.date}\n无数据`
                      : `${day.date}\n${this._fmt(day.total_tokens)} tokens\n${this._fmtCost(day.cost_usd)} · ${day.message_count}条消息`;

                    return html`
                      <div class="bar-col">
                        <div class="bar-val ${isToday ? "is-today" : ""} ${isZero ? "is-zero" : ""}">
                          ${showLabel ? this._fmtShort(day.total_tokens) : ""}
                        </div>
                        <div
                          class="bar-body ${isToday ? "is-today" : ""} ${isZero ? "is-zero" : ""}"
                          style="height:${heightPx}px"
                          data-tip=${tip}
                        ></div>
                      </div>
                    `;
                  })}
                </div>
              </div>
              <!-- 日期行 -->
              <div style="display:flex; gap:3px; margin-top:4px; padding-left:0">
                ${(daily ?? []).map((day, idx) => {
                  const isToday = day.date === today;
                  const showDate = isToday || idx % labelEvery === 0;
                  const md = day.date.slice(5);
                  return html`
                    <div class="bar-date ${isToday ? "is-today" : ""} ${!showDate ? "is-hidden" : ""}"
                      style="flex:1; min-width:0">
                      ${isToday ? "今日" : md}
                    </div>
                  `;
                })}
              </div>
            </div>
          </div>
        `}
      </div>
    `;
  }

  render() {
    const d = this.data;
    const today = d.today;

    return html`
      <div class="card">
        <div class="stats-row">
          <div class="stat-item">
            <span class="stat-label">今日 Tokens</span>
            <span class="stat-value">${this._fmt(today.total_tokens)}</span>
            <span class="stat-sub">
              入 ${this._fmt(today.input_tokens)}
              · 出 ${this._fmt(today.output_tokens)}
              · 缓 ${this._fmt(today.cache_read_tokens + today.cache_creation_tokens)}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">估算费用</span>
            <span class="stat-value">${this._fmtCost(today.cost_usd)}</span>
            <span class="stat-sub">${today.message_count} 条消息</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">5h 窗口 (output)</span>
            <span class="stat-value">${this._fmt(d.window_5h.output_tokens)}</span>
            <span class="stat-sub">
              ${this._fmt(d.window_5h.total_tokens)} 总 tokens
            </span>
          </div>
        </div>

        ${this._renderQuota()}
        ${this._renderChart()}
      </div>
    `;
  }
}
