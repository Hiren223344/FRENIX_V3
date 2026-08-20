import { Request, Response, NextFunction } from 'express';
import {
  checkRateLimitInRedis,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
} from '../services/redisUsageService.js';

export { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS };

export interface RateLimitResult {
  allowed: boolean;
  totalLimit: number;
  remaining: number;
  resetSeconds: number;
  currentCount: number;
}

/**
 * Check and increment rate limit for an identifier (API key / user email / IP) via Redis
 */
export async function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  const res = await checkRateLimitInRedis(identifier);
  return {
    allowed: res.allowed,
    totalLimit: res.limit,
    remaining: res.remaining,
    resetSeconds: res.resetSeconds,
    currentCount: res.used,
  };
}

/**
 * Express Middleware for 800 requests / 5 hours rate limit via Redis
 */
export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // Extract identifier: API key > Authorization Bearer > Client IP
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';

  let identifier = ip;
  if (apiKeyHeader) {
    identifier = apiKeyHeader.trim();
  } else if (authHeader?.startsWith('Bearer ')) {
    identifier = authHeader.substring(7).trim();
  }

  const result = await checkRateLimit(identifier);

  // Set standard rate limit headers (Redis tells the rate limit)
  res.setHeader('X-RateLimit-Limit', result.totalLimit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + result.resetSeconds);
  res.setHeader('X-RateLimit-Window-Hours', 5);

  (req as unknown as { rateLimitInfo: RateLimitResult }).rateLimitInfo = result;

  if (!result.allowed) {
    return res.status(429).json({
      error: {
        message: `Rate limit exceeded: You have reached the maximum allowed limit of ${RATE_LIMIT_MAX} requests per 5 hours. Please retry later.`,
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
        limit: RATE_LIMIT_MAX,
        window_hours: 5,
        remaining: 0,
        retry_after_seconds: result.resetSeconds,
      },
    });
  }

  next();
};

export default rateLimitMiddleware;
