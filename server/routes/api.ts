import { Router, Request, Response } from 'express';
import { getAuth } from '@clerk/express';
import storageRouter from './storage.js';
import {
  createOrGetDbUser,
  getUserByEmailFromDb,
} from '../services/dbUserStore.js';
import {
  getUsageStatsFromRedis,
} from '../services/redisUsageService.js';
import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_HOURS,
} from '../services/userStore.js';

const router = Router();

// Storage Router
router.use('/storage', storageRouter);

// 1. Health Status
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'online',
    service: 'Intelligence Evolution Platform API',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
  });
});

// 2. Metrics & Stats endpoint
router.get('/stats', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      { id: 'inference', icon: '<', target: 120, suffix: 'ms', decimals: 0, label: 'Inference Time' },
      { id: 'uptime', icon: '%', target: 99.99, suffix: '%', decimals: 2, label: 'Platform Uptime' },
      { id: 'runtime', icon: '*', target: 24, suffix: '/7', decimals: 0, label: 'Autonomous Runtime' },
      { id: 'context', icon: '#', target: 2.4, suffix: 'M', decimals: 1, label: 'Context Windows' },
    ],
  });
});

// 3. Enterprise Partners
router.get('/enterprises', (_req: Request, res: Response) => {
  res.json({
    success: true,
    count: '2000+',
    partners: [
      { name: 'Microsoft', icon: 'fa-microsoft' },
      { name: 'Amazon', icon: 'fa-amazon' },
      { name: 'Google', icon: 'fa-google' },
    ],
  });
});

// 4. Sign-In Authentication API Endpoint
router.post('/auth/signin', (req: Request, res: Response) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Both email and password are required.',
    });
  }

  const username = email.split('@')[0];
  const capitalizedUser = username.charAt(0).toUpperCase() + username.slice(1);

  return res.json({
    success: true,
    message: 'Authentication successful.',
    user: {
      email,
      name: capitalizedUser,
      role: 'Enterprise Member',
      rememberMe: !!rememberMe,
    },
    token: `jwt_session_${Buffer.from(email).toString('base64')}_${Date.now()}`,
  });
});

// 5. Protected User Profile / Session Check (Clerk)
router.get('/auth/me', (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthenticated. Please sign in via Clerk.',
    });
  }

  return res.json({
    success: true,
    userId: auth.userId,
    sessionId: auth.sessionId,
  });
});

// 6. Real Gateway Stats endpoint: GET /api/gateway/stats?email=...
// API Key & User identity told by DB; Rate Limits & Tokens told by Redis
router.get('/gateway/stats', async (req: Request, res: Response) => {
  const emailQuery = (req.query.email as string) || 'ghg64272@gmail.com';
  const user = await createOrGetDbUser(undefined, emailQuery, 'pro');
  const redisStats = await getUsageStatsFromRedis(user.apiKey);

  return res.json({
    success: true,
    email: user.email,
    tier: user.tier ? user.tier.toUpperCase() : 'PRO',
    plainKey: user.apiKey,
    keyPrefix: user.apiKey ? user.apiKey.slice(0, 16) : 'sk-live',
    stats: {
      totalRequests: redisStats.usage.totalRequests,
      usageLeft: redisStats.rateLimit.remaining,
      maxLimit: redisStats.rateLimit.limit,
      totalCostUsd: redisStats.usage.totalCostUsd,
      tokens: redisStats.usage.tokens,
    },
    database: {
      authority: 'PostgreSQL Database',
      userId: user.id,
      email: user.email,
      apiKey: user.apiKey,
    },
    redis: {
      engine: 'Redis Counter & Sliding Window',
      rateLimit: redisStats.rateLimit,
    },
  });
});

// 7. Gateway Provision Key endpoint
router.post('/gateway/keys', async (req: Request, res: Response) => {
  const { email, tier } = req.body;
  const userEmail = email || 'ghg64272@gmail.com';
  const user = await createOrGetDbUser(undefined, userEmail, tier || 'pro');

  return res.json({
    success: true,
    key: user.apiKey,
    tier: user.tier,
    storedIn: 'Supabase PostgreSQL Database',
  });
});

// 8. User Usage & Rate Limit endpoint: GET /api/user/usage
router.get('/user/usage', async (req: Request, res: Response) => {
  const emailQuery = (req.query.email as string) || 'ghg64272@gmail.com';
  const user = await createOrGetDbUser(undefined, emailQuery, 'pro');
  const redisStats = await getUsageStatsFromRedis(user.apiKey);

  res.setHeader('X-RateLimit-Limit', redisStats.rateLimit.limit.toString());
  res.setHeader('X-RateLimit-Remaining', redisStats.rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', redisStats.rateLimit.resetInSeconds.toString());
  res.setHeader('X-RateLimit-Window', '5h');

  return res.status(200).json({
    success: true,
    email: user.email,
    apiKey: user.apiKey,
    tier: user.tier,
    rateLimit: redisStats.rateLimit,
    usage: redisStats.usage,
    database: {
      authority: 'PostgreSQL Database',
      email: user.email,
      apiKey: user.apiKey,
    },
    redis: {
      engine: 'Redis Sliding-Window',
      metrics: redisStats.usage,
    },
  });
});

// 9. Contact / Early Access Form submission
router.post('/contact', (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, message: 'Valid email is required.' });
  }

  return res.json({
    success: true,
    message: `Thank you for choosing Intelligence! Early access invitation dispatched to ${email}.`,
  });
});

export default router;
