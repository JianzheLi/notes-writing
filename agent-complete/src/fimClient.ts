export interface FimOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  suffix?: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface FimUsage {
  promptTokens?: number;
  completionTokens?: number;
  cacheHitTokens?: number;
}

export interface FimResult {
  text: string;
  usage?: FimUsage;
}

/**
 * 调用 DeepSeek FIM Completion API（/beta/completions，非流式）。
 * 超时或取消时抛错，由调用方决定是否提示用户。
 */
export async function complete(options: FimOptions): Promise<FimResult> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  const url = `${options.baseUrl.replace(/\/+$/, '')}/completions`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        prompt: options.prompt,
        suffix: options.suffix ?? '',
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      throw new Error(`HTTP ${response.status}${body ? ` ${body}` : ''}`);
    }

    const data: any = await response.json();
    const text: string = data?.choices?.[0]?.text ?? '';
    const usage = data?.usage ?? {};

    return {
      text,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        cacheHitTokens:
          usage.prompt_tokens_details?.cached_tokens ??
          usage.prompt_cache_hit_tokens,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      if (options.signal.aborted) throw new Error('已取消');
      throw new Error(`请求超时（>${options.timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abortFromCaller);
  }
}
