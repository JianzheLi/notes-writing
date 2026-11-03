import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type { Agent } from 'http';

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal: AbortSignal;
  proxy?: string;
}

export interface HttpRequestResult {
  status: number;
  body: string;
}

/**
 * 用 Node 原生 http/https 发请求。
 *
 * 不用全局 fetch：VS Code 扩展宿主可能给 fetch 启用了系统代理，
 * 代理不可用时会直接 "fetch failed"；https.request 的行为更可控，
 * 并且我们显式把本机代理作为 Agent 传入，保证流量走代理。
 */
export async function httpRequest(
  options: HttpRequestOptions,
): Promise<HttpRequestResult> {
  const target = new URL(options.url);
  const agent = await buildAgent(options.proxy);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise<HttpRequestResult>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? Number(target.port) : isHttps ? 443 : 80,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'POST',
        headers: options.body
          ? {
              ...options.headers,
              'Content-Length': Buffer.byteLength(options.body),
            }
          : options.headers,
        agent,
        timeout: options.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`请求超时（>${options.timeoutMs}ms）`));
    });
    request.on('error', (error) => reject(error));

    const onAbort = () => request.destroy(new Error('已取消'));
    options.signal.addEventListener('abort', onAbort, { once: true });
    request.on('close', () => {
      options.signal.removeEventListener('abort', onAbort);
    });

    if (options.body) request.write(options.body);
    request.end();
  });
}

export async function postJson(
  options: Omit<HttpRequestOptions, 'method'>,
): Promise<HttpRequestResult> {
  return httpRequest({ ...options, method: 'POST' });
}

async function buildAgent(proxy?: string): Promise<Agent | undefined> {
  if (!proxy) return undefined;
  // socks5 用本地 DNS 解析，部分系统代理下会慢或偶发 HostUnreachable；
  // 统一用 socks5h 让代理解析域名（和 curl --socks5-hostname 一致，也更快）。
  const normalized = proxy
    .replace(/^socks5:\/\//i, 'socks5h://')
    .replace(/^socks:\/\//i, 'socks5h://');
  if (/^socks/i.test(normalized)) {
    const mod = await import('socks-proxy-agent');
    return new mod.SocksProxyAgent(normalized);
  }
  const mod = await import('https-proxy-agent');
  return new mod.HttpsProxyAgent(normalized);
}
