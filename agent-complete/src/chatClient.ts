import { postJson } from './httpPost';
import { ChatOptions, ChatResult, ChatUsage, ProxyChoice } from './types';

class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status}${body ? ` ${body}` : ''}`);
  }
}

function buildBody(options: ChatOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    stream: false,
  };

  if (options.reasoningEffort === 'none') {
    body.thinking = { type: 'disabled' };
    body.temperature = options.temperature;
  } else {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = options.reasoningEffort;
    // 思考模式下 temperature 不生效，不发送。
  }

  return body;
}

async function attempt(
  options: ChatOptions,
  proxy?: ProxyChoice,
): Promise<ChatResult> {
  const startedAt = Date.now();
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const response = await postJson({
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(buildBody(options)),
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    proxy: proxy?.url,
  });

  if (response.status < 200 || response.status >= 300) {
    const detail = response.body.slice(0, 300);
    throw new HttpStatusError(response.status, detail);
  }

  const data: any = JSON.parse(response.body);
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  const usageData = data?.usage ?? {};
  const usage: ChatUsage = {
    promptTokens: usageData.prompt_tokens,
    completionTokens: usageData.completion_tokens,
    reasoningTokens: usageData.completion_tokens_details?.reasoning_tokens,
    cacheHitTokens:
      usageData.prompt_tokens_details?.cached_tokens ??
      usageData.prompt_cache_hit_tokens,
  };

  return {
    content,
    usage,
    elapsedMs: Date.now() - startedAt,
    proxyUsed: proxy?.url,
    proxySource: proxy?.source,
  };
}

/**
 * 调用 DeepSeek Chat Completions。
 * 按 extension 解析出的代理候选依次尝试；候选为空时直连（本机无代理配置）。
 * HTTP 错误（key/参数问题）不重试；网络错误才换下一个代理候选。
 */
export async function chatCompletion(options: ChatOptions): Promise<ChatResult> {
  const candidates = options.proxies ?? [];

  if (candidates.length === 0) {
    return attempt(options, undefined);
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await attempt(options, candidate);
    } catch (error) {
      if (options.signal.aborted) throw new Error('已取消');
      if (error instanceof HttpStatusError) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('所有代理候选都失败');
}
