import crypto from 'crypto';
import type { UserAccount, UserTier, UsageLog, ModelPricing } from '../types/user.js';

export const RATE_LIMIT_MAX_REQUESTS = 800;
export const RATE_LIMIT_WINDOW_HOURS = 5;
export const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000; // 18,000,000 ms

// Pricing & Access Tier Table
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'intelligence-evolution-v1': {
    model: 'intelligence-evolution-v1',
    requiredTier: 'pro',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  'gpt-4o': {
    model: 'gpt-4o',
    requiredTier: 'pro',
    inputCostPer1kTokens: 0.005,
    outputCostPer1kTokens: 0.015,
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    requiredTier: 'free',
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
  },
  'gpt-4-turbo': {
    model: 'gpt-4-turbo',
    requiredTier: 'pro',
    inputCostPer1kTokens: 0.01,
    outputCostPer1kTokens: 0.03,
  },
  'claude-3-5-sonnet-20241022': {
    model: 'claude-3-5-sonnet-20241022',
    requiredTier: 'pro',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  'claude-3-5-sonnet': {
    model: 'claude-3-5-sonnet',
    requiredTier: 'pro',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  'claude-3-7-sonnet-20250219': {
    model: 'claude-3-7-sonnet-20250219',
    requiredTier: 'pro',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  'claude-3-5-haiku-20241022': {
    model: 'claude-3-5-haiku-20241022',
    requiredTier: 'free',
    inputCostPer1kTokens: 0.001,
    outputCostPer1kTokens: 0.005,
  },
  // claude-opus-5 is strictly a PRO model
  'claude-opus-5': {
    model: 'claude-opus-5',
    requiredTier: 'pro',
    inputCostPer1kTokens: 0.000,
    outputCostPer1kTokens: 0.000,
  },
  'deepseek-v4-flash-free': {
    model: 'deepseek-v4-flash-free',
    requiredTier: 'free',
    inputCostPer1kTokens: 0.000,
    outputCostPer1kTokens: 0.000,
  },
  'mimo-v2.5-free': {
    model: 'mimo-v2.5-free',
    requiredTier: 'free',
    inputCostPer1kTokens: 0.000,
    outputCostPer1kTokens: 0.000,
  },
};

// Default fallback pricing for custom / unspecified models
export const DEFAULT_MODEL_PRICING: ModelPricing = {
  model: 'custom-model',
  requiredTier: 'pro',
  inputCostPer1kTokens: 0.003,
  outputCostPer1kTokens: 0.015,
};

// In-memory User Database (keyed by email and apiKey)
const usersByEmail = new Map<string, UserAccount>();
const usersByApiKey = new Map<string, UserAccount>();

/**
 * Generate a cryptographically secure randomhex API key: sk-<48 hex chars>
 */
export function generateRandomHexKey(): string {
  const randomHex = crypto.randomBytes(24).toString('hex'); // 48 chars
  return `sk-${randomHex}`;
}

/**
 * Create or retrieve user under email row (Default Tier = free)
 */
export function createUserAccount(email: string, tier: UserTier = 'free', preferredApiKey?: string): UserAccount {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = usersByEmail.get(normalizedEmail);
  if (existing) {
    if (preferredApiKey && !usersByApiKey.has(preferredApiKey)) {
      usersByApiKey.set(preferredApiKey, existing);
      existing.apiKey = preferredApiKey;
    }
    return existing;
  }

  const apiKey = preferredApiKey || generateRandomHexKey();
  const now = new Date().toISOString();

  const user: UserAccount = {
    id: `usr_${crypto.randomBytes(12).toString('hex')}`,
    email: normalizedEmail,
    apiKey,
    tier,
    createdAt: now,
    updatedAt: now,
    usage: {
      totalRequests: 0,
      totalCost: 0,
      totalRequestsLeft: RATE_LIMIT_MAX_REQUESTS,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      rateLimitWindowHours: RATE_LIMIT_WINDOW_HOURS,
      rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
    },
    usageLogs: [],
  };

  usersByEmail.set(normalizedEmail, user);
  usersByApiKey.set(apiKey, user);

  return user;
}

/**
 * Get or register user by API key and/or email (Default Tier = free)
 */
export function getOrCreateUser(apiKey?: string, email?: string, tier: UserTier = 'free'): UserAccount {
  const cleanKey = apiKey?.trim();
  if (cleanKey) {
    const existingByKey = usersByApiKey.get(cleanKey);
    if (existingByKey) {
      if (email && !usersByEmail.has(email.trim().toLowerCase())) {
        usersByEmail.set(email.trim().toLowerCase(), existingByKey);
        existingByKey.email = email.trim().toLowerCase();
      }
      return existingByKey;
    }
  }

  const cleanEmail = email?.trim().toLowerCase();
  if (cleanEmail) {
    const existingByEmail = usersByEmail.get(cleanEmail);
    if (existingByEmail) {
      if (cleanKey && !usersByApiKey.has(cleanKey)) {
        usersByApiKey.set(cleanKey, existingByEmail);
        existingByEmail.apiKey = cleanKey;
      }
      return existingByEmail;
    }
  }

  const targetKey = cleanKey || generateRandomHexKey();
  const targetEmail = cleanEmail || (cleanKey ? `user_${cleanKey.substring(3, 11)}@platform.ai` : 'user@intelligence-evolution.ai');
  const now = new Date().toISOString();

  const user: UserAccount = {
    id: `usr_${crypto.randomBytes(12).toString('hex')}`,
    email: targetEmail,
    apiKey: targetKey,
    tier,
    createdAt: now,
    updatedAt: now,
    usage: {
      totalRequests: 0,
      totalCost: 0,
      totalRequestsLeft: RATE_LIMIT_MAX_REQUESTS,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      rateLimitWindowHours: RATE_LIMIT_WINDOW_HOURS,
      rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
    },
    usageLogs: [],
  };

  usersByEmail.set(targetEmail, user);
  usersByApiKey.set(targetKey, user);

  return user;
}

export function updateUserTier(emailOrKey: string, tier: UserTier): UserAccount | null {
  const clean = emailOrKey.trim().toLowerCase();
  const user = usersByEmail.get(clean) || usersByApiKey.get(emailOrKey.trim());
  if (user) {
    user.tier = tier;
    user.updatedAt = new Date().toISOString();
    return user;
  }
  return null;
}

export function getAllUsers(): UserAccount[] {
  return Array.from(usersByEmail.values());
}

export function getUserByEmail(email: string): UserAccount | undefined {
  return usersByEmail.get(email.trim().toLowerCase());
}

export function getUserByApiKey(apiKey: string): UserAccount | undefined {
  return usersByApiKey.get(apiKey.trim());
}

export function getModelPricing(modelName: string): ModelPricing {
  return MODEL_PRICING[modelName] || DEFAULT_MODEL_PRICING;
}

/**
 * Check tier access: claude-opus-5 requires Pro tier!
 */
export function canAccessModel(user: UserAccount, modelName: string): { allowed: boolean; reason?: string } {
  const pricing = getModelPricing(modelName);

  if (pricing.requiredTier === 'pro' && user.tier === 'free') {
    return {
      allowed: false,
      reason: `Model '${modelName}' requires 'pro' tier. Your current tier is 'free'. Please contact the administrator or upgrade to Pro.`,
    };
  }

  if (pricing.requiredTier === 'enterprise' && user.tier !== 'enterprise') {
    return {
      allowed: false,
      reason: `Model '${modelName}' requires 'enterprise' tier.`,
    };
  }

  return { allowed: true };
}

/**
 * Record usage log and calculate costs
 */
export function recordUserUsage(params: {
  user: UserAccount;
  endpoint: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  status: 'success' | 'rate_limited' | 'error' | 'forbidden';
  ip?: string;
  requestsRemaining?: number;
}): UsageLog {
  const { user, endpoint, model, promptTokens, completionTokens, status, ip, requestsRemaining } = params;
  const pricing = getModelPricing(model);

  const promptCost = (promptTokens / 1000) * pricing.inputCostPer1kTokens;
  const completionCost = (completionTokens / 1000) * pricing.outputCostPer1kTokens;
  const totalCost = Number((promptCost + completionCost).toFixed(6));
  const totalTokens = promptTokens + completionTokens;

  const log: UsageLog = {
    id: `log_${crypto.randomBytes(8).toString('hex')}`,
    timestamp: new Date().toISOString(),
    endpoint,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cost: totalCost,
    status,
    ip,
  };

  if (!user.usageLogs) {
    user.usageLogs = [];
  }
  user.usageLogs.unshift(log);
  if (user.usageLogs.length > 500) user.usageLogs.pop();

  if (status === 'success') {
    user.usage.totalRequests += 1;
    user.usage.totalPromptTokens += promptTokens;
    user.usage.totalCompletionTokens += completionTokens;
    user.usage.totalCost = Number((user.usage.totalCost + totalCost).toFixed(6));

    if (typeof requestsRemaining === 'number') {
      user.usage.totalRequestsLeft = requestsRemaining;
    } else {
      user.usage.totalRequestsLeft = Math.max(0, user.usage.rateLimitMaxRequests - user.usage.totalRequests);
    }
  }

  user.updatedAt = new Date().toISOString();
  return log;
}
