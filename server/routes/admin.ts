import { Router, Request, Response, NextFunction } from 'express';
import {
  getAllUsersFromDb,
  updateUserTierInDb,
  createOrGetDbUser,
  assignProviderKeyToUser,
} from '../services/dbUserStore.js';
import { getAllUsers } from '../services/userStore.js';
import { getUsageStatsFromRedis } from '../services/redisUsageService.js';
import type { UserTier, UserAccount } from '../types/user.js';

const adminRouter = Router();

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin@frenix2026';
const ADMIN_TOKEN_SECRET = 'frenix_admin_auth_token_99x';

// Simple session token tracker
const activeAdminTokens = new Set<string>();

async function getMergedAllUsers(): Promise<UserAccount[]> {
  const dbUsers = await getAllUsersFromDb();
  const memUsers = getAllUsers();
  const map = new Map<string, UserAccount>();

  for (const u of dbUsers) {
    map.set(u.email.toLowerCase(), u);
  }
  for (const u of memUsers) {
    if (!map.has(u.email.toLowerCase())) {
      map.set(u.email.toLowerCase(), u);
    }
  }

  return Array.from(map.values());
}

/**
 * Admin Authentication Middleware
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-admin-token'] as string || req.headers.authorization?.replace(/^Bearer\s+/, '');
  if (!token || !activeAdminTokens.has(token)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid Admin Token required.',
    });
  }
  next();
}

/**
 * 1. POST /api/admin/login
 */
adminRouter.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password || password !== DEFAULT_ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Invalid Admin Password.',
    });
  }

  const token = `adm_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  activeAdminTokens.add(token);

  return res.json({
    success: true,
    message: 'Admin Authentication Successful.',
    token,
    role: 'Administrator',
  });
});

/**
 * 2. GET /api/admin/stats
 */
adminRouter.get('/stats', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const allUsers = await getMergedAllUsers();

    let totalRequests = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    let proCount = 0;
    let freeCount = 0;
    let dedicatedKeysCount = 0;

    for (const u of allUsers) {
      if (u.tier === 'pro' || u.tier === 'enterprise') proCount++;
      else freeCount++;

      if (u.assignedProviderKey) dedicatedKeysCount++;

      const rStats = await getUsageStatsFromRedis(u.apiKey);
      totalRequests += rStats.usage.totalRequests;
      totalTokens += rStats.usage.tokens.total;
      totalCostUsd += rStats.usage.totalCostUsd;
    }

    return res.json({
      success: true,
      stats: {
        totalUsers: allUsers.length,
        proUsers: proCount,
        freeUsers: freeCount,
        totalRequests,
        totalTokens,
        totalCostUsd: Number(totalCostUsd.toFixed(4)),
        dedicatedKeysCount,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error fetching admin stats';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 3. GET /api/admin/users
 */
adminRouter.get('/users', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const allUsers = await getMergedAllUsers();
    const enrichedUsers = await Promise.all(
      allUsers.map(async (u) => {
        const rStats = await getUsageStatsFromRedis(u.apiKey);
        return {
          id: u.id,
          email: u.email,
          apiKey: u.apiKey,
          maskedKey: `${u.apiKey.slice(0, 7)}...${u.apiKey.slice(-6)}`,
          tier: u.tier,
          assignedProviderKey: u.assignedProviderKey || null,
          maskedAssignedKey: u.assignedProviderKey
            ? `${u.assignedProviderKey.slice(0, 7)}...${u.assignedProviderKey.slice(-6)}`
            : null,
          createdAt: u.createdAt,
          rateLimit: rStats.rateLimit,
          usage: rStats.usage,
        };
      })
    );

    return res.json({
      success: true,
      users: enrichedUsers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error fetching users list';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 4. POST /api/admin/users/assign-key — Assign or unassign a dedicated OpenCode upstream key to a PRO user
 */
adminRouter.post('/users/assign-key', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { emailOrKey, providerKey } = req.body;
    if (!emailOrKey) {
      return res.status(400).json({
        success: false,
        error: "Missing parameter: 'emailOrKey' is required.",
      });
    }

    const updated = await assignProviderKeyToUser(emailOrKey, providerKey || '');
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: `User '${emailOrKey}' not found.`,
      });
    }

    return res.json({
      success: true,
      message: providerKey
        ? `Dedicated OpenCode key '${providerKey.slice(0, 7)}...${providerKey.slice(-6)}' assigned to ${updated.email}.`
        : `Dedicated key removed. User ${updated.email} reverted to default server key.`,
      user: {
        id: updated.id,
        email: updated.email,
        apiKey: updated.apiKey,
        tier: updated.tier,
        assignedProviderKey: updated.assignedProviderKey,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error assigning dedicated key';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 5. POST /api/admin/users/tier — Change user tier to 'pro', 'free', 'enterprise'
 */
adminRouter.post('/users/tier', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { emailOrKey, tier } = req.body;
    if (!emailOrKey || !tier) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters: 'emailOrKey' and 'tier' are required.",
      });
    }

    const targetTier: UserTier = tier.toLowerCase() === 'pro' || tier.toLowerCase() === 'enterprise' ? tier.toLowerCase() : 'free';
    const updated = await updateUserTierInDb(emailOrKey, targetTier);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: `User '${emailOrKey}' not found.`,
      });
    }

    return res.json({
      success: true,
      message: `User '${updated.email}' tier successfully changed to '${updated.tier}'.`,
      user: {
        id: updated.id,
        email: updated.email,
        apiKey: updated.apiKey,
        tier: updated.tier,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error updating user tier';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 6. POST /api/admin/users/create — Create user with custom tier
 */
adminRouter.post('/users/create', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { email, tier, preferredApiKey } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const assignedTier: UserTier = tier === 'enterprise' || tier === 'pro' ? tier : 'free';
    const user = await createOrGetDbUser(preferredApiKey, email, assignedTier);

    return res.status(201).json({
      success: true,
      message: `User '${user.email}' created with tier '${user.tier}'.`,
      user,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error creating user';
    return res.status(500).json({ success: false, error: message });
  }
});

export default adminRouter;
