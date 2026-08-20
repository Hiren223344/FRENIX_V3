import crypto from 'crypto';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseStorage.js';
import type { UserAccount, UserTier, UsageLog } from '../types/user.js';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_HOURS } from './userStore.js';

// In-Memory Fallback Cache (used only when DB is offline)
const fallbackUsersByApiKey = new Map<string, UserAccount>();
const fallbackUsersByEmail = new Map<string, UserAccount>();
const fallbackUsageLogs = new Map<string, UsageLog[]>();

export function generateRandomHexApiKey(): string {
  return `sk-${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * 1. DB tells user details and authenticates API Key (Direct DB Query)
 */
export async function getUserByApiKeyFromDb(apiKey: string): Promise<UserAccount | null> {
  const cleanKey = apiKey.trim();

  // 1. Direct Supabase Database Query First
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('api_key', cleanKey)
          .maybeSingle();

        if (data && !error) {
          const user: UserAccount = {
            id: data.id || `usr_${cleanKey.substring(3, 11)}`,
            email: data.email,
            apiKey: data.api_key,
            tier: (data.tier as UserTier) || 'free',
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
          fallbackUsersByApiKey.set(cleanKey, user);
          fallbackUsersByEmail.set(user.email.toLowerCase(), user);
          return user;
        }
      } catch (err) {
        console.warn('[DB User Lookup Error]:', err);
      }
    }
  }

  // 2. Fallback to memory cache
  return fallbackUsersByApiKey.get(cleanKey) || null;
}

/**
 * 2. DB tells user details by Email (Direct DB Query)
 */
export async function getUserByEmailFromDb(email: string): Promise<UserAccount | null> {
  const cleanEmail = email.trim().toLowerCase();

  // 1. Direct Supabase Database Query First
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle();

        if (data && !error) {
          const user: UserAccount = {
            id: data.id,
            email: data.email,
            apiKey: data.api_key,
            tier: (data.tier as UserTier) || 'free',
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
          fallbackUsersByApiKey.set(user.apiKey, user);
          fallbackUsersByEmail.set(cleanEmail, user);
          return user;
        }
      } catch (err) {
        console.warn('[DB User by Email Error]:', err);
      }
    }
  }

  // 2. Fallback to memory cache
  return fallbackUsersByEmail.get(cleanEmail) || null;
}

/**
 * 3. Create or register user directly in Supabase DB (Default Tier = free)
 */
export async function createOrGetDbUser(
  apiKey?: string,
  email?: string,
  tier: UserTier = 'free'
): Promise<UserAccount> {
  const cleanKey = apiKey?.trim();
  const cleanEmail = email?.trim().toLowerCase();

  // 1. Check existing record in DB
  if (cleanKey) {
    const existing = await getUserByApiKeyFromDb(cleanKey);
    if (existing) {
      if (cleanEmail && !existing.email.includes('@')) {
        existing.email = cleanEmail;
        await updateUserInDb(existing.apiKey, { email: cleanEmail });
      }
      return existing;
    }
  }

  if (cleanEmail) {
    const existing = await getUserByEmailFromDb(cleanEmail);
    if (existing) {
      if (cleanKey && existing.apiKey !== cleanKey) {
        existing.apiKey = cleanKey;
        await updateUserInDb(existing.apiKey, { api_key: cleanKey });
      }
      return existing;
    }
  }

  // 2. Create new user in DB
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

  // Sync to memory
  fallbackUsersByApiKey.set(finalKey, newUser);
  fallbackUsersByEmail.set(finalEmail, newUser);

  // Direct Supabase DB Upsert
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('users').upsert(
          {
            id: userId,
            email: finalEmail,
            api_key: finalKey,
            tier,
            created_at: now,
            updated_at: now,
          },
          { onConflict: 'email' }
        );
        if (error) {
          console.warn('[Supabase DB Upsert Notice]:', error.message);
        }
      } catch (err) {
        console.warn('[Supabase DB Connection]:', err);
      }
    }
  }

  return newUser;
}

/**
 * 4. Update user directly in Supabase DB
 */
export async function updateUserInDb(
  apiKeyOrEmail: string,
  fieldsToUpdate: Partial<{ email: string; api_key: string; tier: UserTier }>
): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const clean = apiKeyOrEmail.trim();
        await supabase
          .from('users')
          .update({ ...fieldsToUpdate, updated_at: new Date().toISOString() })
          .or(`email.eq.${clean.toLowerCase()},api_key.eq.${clean}`);
      } catch {}
    }
  }
}

/**
 * 5. Update user tier directly in Supabase DB
 */
export async function updateUserTierInDb(emailOrKey: string, newTier: UserTier): Promise<UserAccount | null> {
  const clean = emailOrKey.trim().toLowerCase();
  const now = new Date().toISOString();

  // 1. Direct Supabase DB Update First
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('users')
          .update({ tier: newTier, updated_at: now })
          .or(`email.eq.${clean},api_key.eq.${emailOrKey.trim()}`)
          .select()
          .maybeSingle();

        if (data && !error) {
          const user: UserAccount = {
            id: data.id,
            email: data.email,
            apiKey: data.api_key,
            tier: data.tier as UserTier,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
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
          fallbackUsersByApiKey.set(user.apiKey, user);
          fallbackUsersByEmail.set(user.email.toLowerCase(), user);
          return user;
        }
      } catch (err) {
        console.warn('[DB User Tier Update Error]:', err);
      }
    }
  }

  // 2. Memory Fallback
  let user = fallbackUsersByEmail.get(clean) || fallbackUsersByApiKey.get(emailOrKey.trim());
  if (user) {
    user.tier = newTier;
    user.updatedAt = now;
    return user;
  }

  return null;
}

/**
 * 6. Get all users directly from Supabase DB for Admin Dashboard
 */
export async function getAllUsersFromDb(): Promise<UserAccount[]> {
  const usersMap = new Map<string, UserAccount>();

  // 1. Fetch Directly from Supabase Database First
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .order('created_at', { ascending: false });

        if (data && !error && Array.isArray(data)) {
          for (const d of data) {
            const user: UserAccount = {
              id: d.id,
              email: d.email,
              apiKey: d.api_key,
              tier: (d.tier as UserTier) || 'free',
              createdAt: d.created_at,
              updatedAt: d.updated_at,
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
            usersMap.set(d.email.toLowerCase(), user);
            fallbackUsersByApiKey.set(d.api_key, user);
            fallbackUsersByEmail.set(d.email.toLowerCase(), user);
          }
          return Array.from(usersMap.values());
        }
      } catch (err) {
        console.warn('[DB Fetch All Users Exception]:', err);
      }
    }
  }

  // 2. If DB returned empty or offline, fallback to memory
  for (const u of fallbackUsersByEmail.values()) {
    usersMap.set(u.email.toLowerCase(), u);
  }
  for (const u of fallbackUsersByApiKey.values()) {
    usersMap.set(u.email.toLowerCase(), u);
  }

  return Array.from(usersMap.values());
}

/**
 * 7. DB records and stores persistent audit logs directly in Supabase
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

  // Cache in-memory
  const logsList = fallbackUsageLogs.get(apiKey) || [];
  logsList.unshift(log);
  if (logsList.length > 500) logsList.pop();
  fallbackUsageLogs.set(apiKey, logsList);

  // Direct Supabase DB insert
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
      } catch {}
    }
  }

  return log;
}

/**
 * 8. DB retrieves recent usage audit logs directly from Supabase
 */
export async function getRecentLogsFromDb(apiKey: string): Promise<UsageLog[]> {
  // 1. Direct Supabase DB Query
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
          fallbackUsageLogs.set(apiKey, logs);
          return logs;
        }
      } catch {}
    }
  }

  return fallbackUsageLogs.get(apiKey) || [];
}
