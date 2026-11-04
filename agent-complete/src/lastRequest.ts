export interface LastRequestStats {
  elapsedMs: number;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cacheHitTokens?: number;
  /** 1 = 一次成功；2 = 语法检查后重试。 */
  attempts: number;
  mode: string;
  style: string;
}

let lastRequest: LastRequestStats | undefined;

export function setLastRequest(stats: LastRequestStats): void {
  lastRequest = stats;
}

export function getLastRequest(): LastRequestStats | undefined {
  return lastRequest;
}

/** 缓存命中率（0-100）；没有 promptTokens 时返回 undefined。 */
export function cachePercent(
  stats: LastRequestStats | undefined,
): number | undefined {
  if (!stats || !stats.promptTokens || stats.promptTokens <= 0) return undefined;
  const hit = Math.max(0, Math.min(stats.cacheHitTokens ?? 0, stats.promptTokens));
  return Math.round((hit / stats.promptTokens) * 100);
}
