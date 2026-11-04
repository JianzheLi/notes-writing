import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { ProxyChoice } from './types';

/** 用户在设置里显式配置的代理（agentComplete.proxy）。 */
export function getExplicitProxy(): ProxyChoice | undefined {
  const setting = vscode.workspace
    .getConfiguration('agentComplete')
    .get<string>('proxy', '')
    .trim();
  return setting ? { url: setting, source: 'agentComplete.proxy' } : undefined;
}

/** VS Code 自己的代理设置（http.proxy）。 */
export function getVsCodeProxy(): ProxyChoice | undefined {
  const setting = vscode.workspace
    .getConfiguration('http')
    .get<string>('proxy', '')
    .trim();
  return setting ? { url: setting, source: 'http.proxy' } : undefined;
}

/** 扩展宿主环境变量里的代理。 */
export function getEnvProxy(): ProxyChoice | undefined {
  const value =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  return value ? { url: value, source: 'env' } : undefined;
}

/** macOS 系统代理（System Settings → Network → Proxies）。 */
export function getSystemProxy(): Promise<ProxyChoice | undefined> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve(undefined);
      return;
    }

    // 用 encoding: 'buffer' 自己解码：VS Code 1.144 扩展宿主里 execFile 默认的
    // StringDecoder 会抛 "StringDecoder is not a constructor"（Copilot 也中招）。
    try {
      execFile(
        'scutil',
        ['--proxy'],
        { timeout: 1500, encoding: 'buffer' },
        (error, stdout) => {
          const text = stdout ? stdout.toString('utf8') : '';
          if (error || !text) {
            resolve(undefined);
            return;
          }

          const socks = /SOCKSEnable\s*:\s*1[\s\S]*?SOCKSProxy\s*:\s*(\S+)[\s\S]*?SOCKSPort\s*:\s*(\d+)/.exec(text);
          if (socks) {
            resolve({ url: `socks5://${socks[1]}:${socks[2]}`, source: 'system' });
            return;
          }

          const httpsProxy =
            /HTTPSEnable\s*:\s*1[\s\S]*?HTTPSProxy\s*:\s*(\S+)[\s\S]*?HTTPSPort\s*:\s*(\d+)/.exec(text);
          if (httpsProxy) {
            resolve({ url: `http://${httpsProxy[1]}:${httpsProxy[2]}`, source: 'system' });
            return;
          }

          const httpProxy =
            /HTTPEnable\s*:\s*1[\s\S]*?HTTPProxy\s*:\s*(\S+)[\s\S]*?HTTPPort\s*:\s*(\d+)/.exec(text);
          if (httpProxy) {
            resolve({ url: `http://${httpProxy[1]}:${httpProxy[2]}`, source: 'system' });
            return;
          }

          resolve(undefined);
        },
      );
    } catch {
      // 扩展宿主不允许子进程等情况下，按没有系统代理处理。
      resolve(undefined);
    }
  });
}

/**
 * 按顺序返回代理候选：显式设置 → http.proxy → 环境变量 → 系统代理。
 * 空数组表示本机没有任何代理配置，此时直连（与其它程序行为一致）。
 */
export async function resolveProxyCandidates(): Promise<ProxyChoice[]> {
  const candidates: ProxyChoice[] = [];
  const add = (candidate?: ProxyChoice) => {
    if (!candidate || !candidate.url.trim()) return;
    if (candidates.some((existing) => existing.url === candidate.url)) return;
    candidates.push(candidate);
  };

  add(getExplicitProxy());
  add(getVsCodeProxy());
  add(getEnvProxy());
  add(await getSystemProxy());
  return candidates;
}
