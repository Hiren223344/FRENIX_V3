import crypto from 'crypto';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseStorage.js';
import type { UserAccount, UserTier, UsageLog } from '../types/user.js';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_HOURS } from './userStore.js';

// In-Memory DB Replica & Cache
const dbUsersByApiKey = new Map<string, UserAccount>();
const dbUsersByEmail = new Map<string, UserAccount>();
const dbUsageLogs = new Map<string, UsageLog[]>();

export function generateRandomHexApiKey(): string {
  return `sk-${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * 1. DB tells user details and authenticates API Key
 */
export async function getUserByApiKeyFromDb(apiKey: string): Promise<UserAccount | null> {
  const cleanKey = apiKey.trim();

  // Check in-memory cache first
  const cached = dbUsersByApiKey.get(cleanKey);
  if (cached) return cached;

  // Query Supabase Database if configured
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('api_key', cleanKey)
          .single();

        if (data && !error) {
          const user: UserAccount = {
            id: data.id || `usr_${cleanKey.substring(3, 11)}`,
            email: data.email,
            apiKey: data.api_key,
            tier: (data.tier as UserTier) || 'pro',
            createdAt: data.created_at || new Date().toISOString(),
            updatedAt: data.updated_at || new Date().toISOString(),
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
          dbUsersByApiKey.set(cleanKey, user);
          dbUsersByEmail.set(user.email, user);
          return user;
        }
      } catch {
        // Fallback to cache/auto-provision
      }
    }
  }

  return null;
}

/**
 * 2. DB tells user details by Email
 */
export async function getUserByEmailFromDb(email: string): Promise<UserAccount | null> {
  const cleanEmail = email.trim().toLowerCase();

  const cached = dbUsersByEmail.get(cleanEmail);
  if (cached) return cached;

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('email', cleanEmail)
          .single();

        if (data && !error) {
          const user: UserAccount = {
            id: data.id,
            email: data.email,
            apiKey: data.api_key,
            tier: (data.tier as UserTier) || 'pro',
            createdAt: data.created_at || new Date().toISOString(),
            updatedAt: data.updated_at || new Date().toISOString(),
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
          dbUsersByApiKey.set(user.apiKey, user);
          dbUsersByEmail.set(cleanEmail, user);
          return user;
        }
      } catch {
        // Fallback
      }
    }
  }

  return null;
}

/**
 * 3. Create or register user and API Key in DB
 */
export async function createOrGetDbUser(
  apiKey?: string,
  email?: string,
  tier: UserTier = 'pro'
): Promise<UserAccount> {
  const cleanKey = apiKey?.trim();
  const cleanEmail = email?.trim().toLowerCase();

  // Try DB lookup
  if (cleanKey) {
    const existing = await getUserByApiKeyFromDb(cleanKey);
    if (existing) {
      if (cleanEmail && !existing.email.includes('@')) {
        existing.email = cleanEmail;
        dbUsersByEmail.set(cleanEmail, existing);
      }
      return existing;
    }
  }

  if (cleanEmail) {
    const existing = await getUserByEmailFromDb(cleanEmail);
    if (existing) {
      if (cleanKey && existing.apiKey !== cleanKey) {
        existing.apiKey = cleanKey;
        dbUsersByApiKey.set(cleanKey, existing);
      }
      return existing;
    }
  }

  const finalKey = cleanKey || generateRandomHexApiKey();
  const finalEmail = cleanEmail || (cleanKey ? `user_${cleanKey.substring(3, 11)}@platform.ai` : 'developer@intelligence.internal');
  const now = new Date().toISOString();
  const userId = `usr_${crypto.randomBytes(12).toString('hex')}`;

  const newUser: UserAccount = {
    id: userId,
    email: finalEmail,
    apiKey: finalKey,
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

  // Cache in memory
  dbUsersByApiKey.set(finalKey, newUser);
  dbUsersByEmail.set(finalEmail, newUser);

  // Persist into Supabase users table asynchronously
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('users').upsert({
          id: userId,
          email: finalEmail,
          api_key: finalKey,
          tier,
          created_at: now,
          updated_at: now,
        });
      } catch {
        // Table created on migration or handled in cache
      }
    }
  }

  return newUser;
}

/**
 * 4. DB records and stores persistent audit logs
 */
export async function persistUsageLogToDb(params: {
  apiKey: string;
  email: string;
  endpoint: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  status: 'success' | 'rate_limited' | 'error' | 'forbidden';
  ip?: string;
}): Promise<UsageLog> {
  const { apiKey, email, endpoint, model, promptTokens, completionTokens, costUsd, status, ip } = params;
  const now = new Date().toISOString();

  const log: UsageLog = {
    id: `log_${crypto.randomBytes(8).toString('hex')}`,
    timestamp: now,
    endpoint,
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cost: Number(costUsd.toFixed(6)),
    status,
    ip,
  };

  // Cache in-memory logs
  const logsList = dbUsageLogs.get(apiKey) || [];
  logsList.unshift(log);
  if (logsList.length > 500) logsList.pop();
  dbUsageLogs.set(apiKey, logsList);

  // Persist to Supabase usage_logs table
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('usage_logs').insert({
          id: log.id,
          api_key: apiKey,
          email,
          endpoint,
          model,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: log.totalTokens,
          cost_usd: log.cost,
          status,
          ip_address: ip,
          created_at: now,
        });
      } catch {
        // Handled in memory cache
      }
    }
  }

  return log;
}

/**
 * 5. DB retrieves recent usage audit logs
 */
export async function getRecentLogsFromDb(apiKey: string): Promise<UsageLog[]> {
  const cached = dbUsageLogs.get(apiKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('usage_logs')
          .select('*')
          .eq('api_key', apiKey)
          .order('created_at', { ascending: false })
          .limit(50);

        if (data && !error && data.length > 0) {
          const logs: UsageLog[] = data.map((d) => ({
            id: d.id,
            timestamp: d.created_at,
            endpoint: d.endpoint,
            model: d.model,
            promptTokens: d.prompt_tokens,
            completionTokens: d.completion_tokens,
            totalTokens: d.total_tokens,
            cost: d.cost_usd,
            status: d.status,
            ip: d.ip_address,
          }));
          dbUsageLogs.set(apiKey, logs);
          return logs;
        }
      } catch {
        // Fall through
      }
    }
  }

  return cached || [];
}
