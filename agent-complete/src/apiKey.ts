import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const SECRET_KEY = 'agentComplete.deepseekApiKey';
const ENV_KEY = 'DEEPSEEK_API_KEY';

export interface ApiKeyInfo {
  key?: string;
  /** 只用于日志/诊断，例如 `file:api.txt` / `env:DEEPSEEK_API_KEY`；不包含 key 本身。 */
  source?: string;
}

/**
 * 按顺序取 API key：
 * 1. `agentComplete.apiKeyFile` 指向的文件（默认 `api.txt`）
 * 2. 默认配置下自动读 `.env`（只认 `DEEPSEEK_API_KEY=`，不会把其它变量当 key）
 * 3. 环境变量 `DEEPSEEK_API_KEY`
 * 4. VS Code SecretStorage（命令「设置 DeepSeek API Key」保存的位置）
 *
 * 文件路径查找：绝对路径 → 各工作区根目录及其上一级 → 扩展目录 → 扩展目录上一级（仓库根）。
 */
export async function resolveApiKey(
  context: vscode.ExtensionContext,
): Promise<ApiKeyInfo> {
  const config = vscode.workspace.getConfiguration('agentComplete');
  const fileSetting = config.get<string>('apiKeyFile', 'api.txt').trim();
  const directories = apiKeyDirectories(context);

  if (fileSetting) {
    const paths = path.isAbsolute(fileSetting)
      ? [fileSetting]
      : directories.map((directory) => path.join(directory, fileSetting));
    for (const candidate of paths) {
      const key = await readKeyFile(candidate, false);
      if (key) return { key, source: `file:${path.basename(candidate)}` };
    }
  }

  // .env 只读取 DEEPSEEK_API_KEY，避免把 .env 里别的变量误当成 key。
  if (!fileSetting || fileSetting === 'api.txt') {
    for (const directory of directories) {
      const key = await readKeyFile(path.join(directory, '.env'), true);
      if (key) return { key, source: 'file:.env' };
    }
  }

  const envKey = process.env[ENV_KEY]?.trim();
  if (envKey) return { key: envKey, source: `env:${ENV_KEY}` };

  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return { key: stored, source: 'SecretStorage' };
  return {};
}

function apiKeyDirectories(context: vscode.ExtensionContext): string[] {
  const directories: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    directories.push(folder.uri.fsPath);
    // 工作区是 agent-complete/ 时，仓库根目录的文件在上一级。
    directories.push(path.join(folder.uri.fsPath, '..'));
  }
  directories.push(context.extensionPath);
  directories.push(path.join(context.extensionPath, '..'));
  return [...new Set(directories)];
}

async function readKeyFile(
  filePath: string,
  requireEnvName: boolean,
): Promise<string> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return parseApiKey(content, { requireEnvName });
  } catch {
    return '';
  }
}

/**
 * 支持：
 * - 纯 key：`sk-...`
 * - `.env` / shell 风格：`DEEPSEEK_API_KEY=sk-...`、`export DEEPSEEK_API_KEY="sk-..."`
 * - `Bearer sk-...`
 * 忽略空行和 # 注释。
 */
export function parseApiKey(
  content: string,
  options: { requireEnvName?: boolean } = {},
): string {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const envLine = lines.find((raw) =>
    /^(?:export\s+)?DEEPSEEK_API_KEY\s*=/i.test(raw.trim()),
  );
  if (envLine) return cleanKeyValue(envLine);

  if (options.requireEnvName) return '';

  for (const raw of lines) {
    const key = cleanKeyValue(raw);
    if (key) return key;
  }
  return '';
}

function cleanKeyValue(raw: string): string {
  let line = raw.trim();
  if (!line || line.startsWith('#')) return '';

  line = line.replace(/^export\s+/i, '');
  const equals = line.indexOf('=');
  if (equals >= 0) line = line.slice(equals + 1);

  return line
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}
