/** 清理模型输出：去 markdown 围栏、首尾空行、行尾空白，限制最大行数。 */
export function postProcess(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n');

  text = text.replace(/^\s*```[a-zA-Z0-9_+-]*\s*\n/, '');
  text = text.replace(/\n```\s*$/, '');
  text = text.replace(/^\n+/, '');
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n+$/, '');

  const lines = text.split('\n');
  if (lines.length > 12) {
    text = lines.slice(0, 12).join('\n');
  }

  return text.trim() ? text : '';
}
