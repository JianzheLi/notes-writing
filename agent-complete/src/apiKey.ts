import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const SECRET_KEY = 'agentComplete.deepseekApiKey';

export interface ApiKeyInfo {
  key?: string;
  /** 只用于日志/诊断，例如 `file:api.txt` / `SecretStorage`；不包含 key 本身。 */
  source?: string;
}

/**
 * 按顺序取 API key：
 * 1. `agentComplete.apiKeyFile` 指向的本地文件（默认 `api.txt`）
 *    查找位置：绝对路径 → 各工作区根目录 → 扩展目录 → 扩展目录的上一级（仓库根）
 * 2. VS Code SecretStorage（命令「设置 DeepSeek API Key」保存的位置）
 *
 * 文件方式优先，这样把 key 放在 `api.txt` 里即可自动载入，不用每次输入。
 */
export async function resolveApiKey(
  context: vscode.ExtensionContext,
): Promise<ApiKeyInfo> {
  const config = vscode.workspace.getConfiguration('agentComplete');
  const fileSetting = config.get<string>('apiKeyFile', 'api.txt').trim();

  if (fileSetting) {
    for (const candidate of apiKeyFileCandidates(context, fileSetting)) {
      const key = await readKeyFile(candidate);
      if (key) {
        return { key, source: `file:${path.basename(candidate)}` };
      }
    }
  }

  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return { key: stored, source: 'SecretStorage' };
  return {};
}

function apiKeyFileCandidates(
  context: vscode.ExtensionContext,
  setting: string,
): string[] {
  if (path.isAbsolute(setting)) return [setting];

  const candidates: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(path.join(folder.uri.fsPath, setting));
    // 工作区是 agent-complete/ 时，仓库根目录的 api.txt 在上一级。
    candidates.push(path.join(folder.uri.fsPath, '..', setting));
  }
  candidates.push(path.join(context.extensionPath, setting));
  candidates.push(path.join(context.extensionPath, '..', setting));
  return [...new Set(candidates)];
}

async function readKeyFile(filePath: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return parseApiKey(content);
  } catch {
    return '';
  }
}

/** 支持纯 key、`DEEPSEEK_API_KEY=sk-...`、`Bearer sk-...`，忽略空行和 # 注释。 */
export function parseApiKey(content: string): string {
  const withoutBom = content.replace(/^\uFEFF/, '');
  for (const rawLine of withoutBom.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equals = line.indexOf('=');
    if (equals >= 0) line = line.slice(equals + 1).trim();

    line = line
      .replace(/^["']|["']$/g, '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (line) return line;
  }
  return '';
}
