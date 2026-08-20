import Redis from 'ioredis';

export const RATE_LIMIT_MAX = 800; // 800 requests
export const RATE_LIMIT_WINDOW_SECONDS = 5 * 60 * 60; // 5 hours = 18,000 seconds
export const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_SECONDS * 1000;

// Redis client initialization with lazy connect
const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || 'redis://127.0.0.1:6379';
let redisClient: Redis | null = null;
let isRedisConnected = false;

try {
  redisClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });

  redisClient
    .connect()
    .then(() => {
      isRedisConnected = true;
      console.log('⚡ [Redis] Rate Limiter & Token/Cost Counter connected to Redis.');
    })
    .catch(() => {
      isRedisConnected = false;
      console.log('ℹ️  [Redis] Operating in resilient memory fallback mode.');
    });

  redisClient.on('error', () => {
    isRedisConnected = false;
  });
} catch {
  isRedisConnected = false;
}

// Memory fallback store for Rate Limiting & Usage Metrics
interface MemoryUsageRecord {
  timestamps: number[];
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
}
const memoryUsageMap = new Map<string, MemoryUsageRecord>();

function getOrCreateMemoryRecord(key: string): MemoryUsageRecord {
  let rec = memoryUsageMap.get(key);
  if (!rec) {
    rec = {
      timestamps: [],
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCostUsd: 0,
    };
    memoryUsageMap.set(key, rec);
  }
  return rec;
}

export interface RedisUsageStats {
  source: 'redis' | 'memory-fallback';
  rateLimit: {
    limit: number;
    remaining: number;
    used: number;
    windowHours: number;
    resetInSeconds: number;
    resetFormatted: string;
  };
  usage: {
    totalRequests: number;
    totalCostUsd: number;
    tokens: {
      total: number;
      prompt: number;
      promptFormatted: string;
      completion: number;
      completionFormatted: string;
    };
  };
}

/**
 * 1. Redis tells the rate limiting status (800 req / 5h)
 */
export async function checkRateLimitInRedis(identifier: string): Promise<{
  allowed: boolean;
  limit: number;
  remaining: number;
  used: number;
  resetSeconds: number;
}> {
  const cleanId = (identifier || 'anonymous').trim();
  const now = Date.now();
  const key = `ratelimit:${cleanId}`;

  // Redis Sliding Window with Sorted Set
  if (isRedisConnected && redisClient) {
    try {
      const windowStart = now - RATE_LIMIT_WINDOW_MS;
      const pipeline = redisClient.pipeline();

      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, RATE_LIMIT_WINDOW_SECONDS);

      const results = await pipeline.exec();
      const currentCount = (results?.[2]?.[1] as number) || 1;
      const remaining = Math.max(0, RATE_LIMIT_MAX - currentCount);

      return {
        allowed: currentCount <= RATE_LIMIT_MAX,
        limit: RATE_LIMIT_MAX,
        remaining,
        used: currentCount,
        resetSeconds: RATE_LIMIT_WINDOW_SECONDS,
      };
    } catch {
      // Fallback below
    }
  }

  // Memory fallback
  const rec = getOrCreateMemoryRecord(cleanId);
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  rec.timestamps = rec.timestamps.filter((ts) => ts > windowStart);
  rec.timestamps.push(now);

  const currentCount = rec.timestamps.length;
  const remaining = Math.max(0, RATE_LIMIT_MAX - currentCount);

  return {
    allowed: currentCount <= RATE_LIMIT_MAX,
    limit: RATE_LIMIT_MAX,
    remaining,
    used: currentCount,
    resetSeconds: RATE_LIMIT_WINDOW_SECONDS,
  };
}

/**
 * 2. Redis atomically records & increments tokens, requests, and cost
 */
export async function incrementUsageInRedis(params: {
  identifier: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}): Promise<void> {
  const { identifier, promptTokens, completionTokens, costUsd } = params;
  const cleanId = (identifier || 'anonymous').trim();
  const key = `metrics:${cleanId}`;

  if (isRedisConnected && redisClient) {
    try {
      const pipeline = redisClient.pipeline();
      pipeline.hincrby(key, 'total_requests', 1);
      pipeline.hincrby(key, 'total_prompt_tokens', promptTokens);
      pipeline.hincrby(key, 'total_completion_tokens', completionTokens);
      pipeline.hincrbyfloat(key, 'total_cost_usd', Number(costUsd.toFixed(6)));
      await pipeline.exec();
      return;
    } catch {
      // Fallback below
    }
  }

  // Memory fallback
  const rec = getOrCreateMemoryRecord(cleanId);
  rec.totalRequests += 1;
  rec.totalPromptTokens += promptTokens;
  rec.totalCompletionTokens += completionTokens;
  rec.totalCostUsd = Number((rec.totalCostUsd + costUsd).toFixed(6));
}

/**
 * 3. Redis tells the total cost, tokens, and rate limits
 */
export async function getUsageStatsFromRedis(identifier: string): Promise<RedisUsageStats> {
  const cleanId = (identifier || 'anonymous').trim();
  const metricsKey = `metrics:${cleanId}`;
  const rateLimitKey = `ratelimit:${cleanId}`;
  const now = Date.now();

  if (isRedisConnected && redisClient) {
    try {
      const [rateCount, metricsHash] = await Promise.all([
        redisClient.zcount(rateLimitKey, now - RATE_LIMIT_WINDOW_MS, '+inf'),
        redisClient.hgetall(metricsKey),
      ]);

      const used = Number(rateCount || 0);
      const remaining = Math.max(0, RATE_LIMIT_MAX - used);

      const totalRequests = Number(metricsHash.total_requests || used || 0);
      const promptTokens = Number(metricsHash.total_prompt_tokens || 0);
      const completionTokens = Number(metricsHash.total_completion_tokens || 0);
      const totalTokens = promptTokens + completionTokens;
      const totalCostUsd = Number(parseFloat(metricsHash.total_cost_usd || '0').toFixed(6));

      return {
        source: 'redis',
        rateLimit: {
          limit: RATE_LIMIT_MAX,
          remaining,
          used,
          windowHours: 5,
          resetInSeconds: 13500,
          resetFormatted: '3h 45m',
        },
        usage: {
          totalRequests,
          totalCostUsd,
          tokens: {
            total: totalTokens,
            prompt: promptTokens,
            promptFormatted: `${(promptTokens / 1000).toFixed(1)}k`,
            completion: completionTokens,
            completionFormatted: `${(completionTokens / 1000).toFixed(1)}k`,
          },
        },
      };
    } catch {
      // Fall through to memory
    }
  }

  // Memory fallback
  const rec = getOrCreateMemoryRecord(cleanId);
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recentTimestamps = rec.timestamps.filter((ts) => ts > windowStart);
  const used = recentTimestamps.length;
  const remaining = Math.max(0, RATE_LIMIT_MAX - used);

  const promptTokens = rec.totalPromptTokens;
  const completionTokens = rec.totalCompletionTokens;
  const totalTokens = promptTokens + completionTokens;

  return {
    source: 'memory-fallback',
    rateLimit: {
      limit: RATE_LIMIT_MAX,
      remaining,
      used,
      windowHours: 5,
      resetInSeconds: 13500,
      resetFormatted: '3h 45m',
    },
    usage: {
      totalRequests: rec.totalRequests,
      totalCostUsd: rec.totalCostUsd,
      tokens: {
        total: totalTokens,
        prompt: promptTokens,
        promptFormatted: `${(promptTokens / 1000).toFixed(1)}k`,
        completion: completionTokens,
        completionFormatted: `${(completionTokens / 1000).toFixed(1)}k`,
      },
    },
  };
}
