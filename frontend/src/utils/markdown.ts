// Markdown → HTML 转换，使用 marked 库
import { marked, type MarkedOptions } from "marked";

const options: MarkedOptions = {
  // 不使用 gfm 异步渲染
  async: false,
};

marked.setOptions(options);

export function renderMarkdown(text: string): string {
  if (!text) return "";
  // marked.parse 同步模式返回 string
  return marked.parse(text, { async: false }) as string;
}
