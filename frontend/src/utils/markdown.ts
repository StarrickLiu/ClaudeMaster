// Markdown → HTML 转换，使用 marked 库
import { marked, type MarkedOptions } from "marked";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const options: MarkedOptions = {
  // 不使用 gfm 异步渲染
  async: false,
};

marked.setOptions(options);

// 转义原始 HTML 块，防止 XSS 和用户消息中的 HTML 被意外渲染
// 仅影响直接书写的 HTML，不影响 Markdown 生成的标签（如 <p>、<code>）
marked.use({
  renderer: {
    html({ text }: { text: string }): string {
      return escapeHtml(text);
    },
  },
});

export function renderMarkdown(text: string): string {
  if (!text) return "";
  // marked.parse 同步模式返回 string
  return marked.parse(text, { async: false }) as string;
}
