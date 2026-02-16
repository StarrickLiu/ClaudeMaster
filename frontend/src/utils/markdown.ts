// 极简 Markdown → HTML 转换

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMarkdown(text: string): string {
  if (!text) return "";

  // 先提取代码块，避免内部被处理
  const codeBlocks: string[] = [];
  let result = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre class="code-block"><code class="lang-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`
    );
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // 转义 HTML
  result = escapeHtml(result);

  // 还原代码块占位符
  result = result.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx)]);

  // 行内代码
  result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // 标题（# ~ ###）
  result = result.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  result = result.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  result = result.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // 粗体
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 斜体
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 无序列表
  result = result.replace(/^- (.+)$/gm, '<li>$1</li>');
  result = result.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // 换行
  result = result.replace(/\n/g, '<br>');

  // 清理多余 <br>
  result = result.replace(/<br><\/?(ul|li|h[234]|pre)/g, '</$1'.startsWith('</') ? '<br><$1' : '<$1');

  return result;
}
