import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseStorage.js';
import type { UserAccount, UserTier, UsageLog } from '../types/user.js';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_HOURS } from './userStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch {}

// Persistent in-memory + disk cache
const usersByApiKey = new Map<string, UserAccount>();
const usersByEmail = new Map<string, UserAccount>();
const usageLogsByApiKey = new Map<string, UsageLog[]>();

// Load persisted users from disk on startup
function loadUsersFromDisk(): void {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const u of list) {
          if (u && u.email && u.apiKey) {
            usersByApiKey.set(u.apiKey, u);
            usersByEmail.set(u.email.toLowerCase(), u);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Disk Storage Warning]:', err);
  }
}

// Save users to disk
function saveUsersToDisk(): void {
  try {
    const list = Array.from(usersByEmail.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Disk Save Warning]:', err);
  }
}

loadUsersFromDisk();

export function generateRandomHexApiKey(): string {
  return `sk-${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * 1. DB tells user details and authenticates API Key
 */
export async function getUserByApiKeyFromDb(apiKey: string): Promise<UserAccount | null> {
  const cleanKey = apiKey.trim();

  // 1. Check local persistent store
  const local = usersByApiKey.get(cleanKey);
  if (local) return local;

  // 2. Query Supabase Database if configured
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
            assignedProviderKey: data.assigned_provider_key || undefined,
            assignedModel: data.assigned_model || undefined,
            customModelRouting: data.custom_model_routing || undefined,
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
          usersByApiKey.set(cleanKey, user);
          usersByEmail.set(user.email.toLowerCase(), user);
          saveUsersToDisk();
          return user;
        }
      } catch (err) {
        console.warn('[DB User Lookup Error]:', err);
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

  // 1. Check local persistent store
  const local = usersByEmail.get(cleanEmail);
  if (local) return local;

  // 2. Query Supabase Database if configured
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
            assignedProviderKey: data.assigned_provider_key || undefined,
            assignedModel: data.assigned_model || undefined,
            customModelRouting: data.custom_model_routing || undefined,
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
          usersByApiKey.set(user.apiKey, user);
          usersByEmail.set(cleanEmail, user);
          saveUsersToDisk();
          return user;
        }
      } catch (err) {
        console.warn('[DB User by Email Error]:', err);
      }
    }
  }

  return null;
}

/**
 * 3. Create or register user directly in DB & local store
 */
export async function createOrGetDbUser(
  apiKey?: string,
  email?: string,
  tier: UserTier = 'free',
  assignedProviderKey?: string,
  assignedModel?: string
): Promise<UserAccount> {
  const cleanKey = apiKey?.trim();
  const cleanEmail = email?.trim().toLowerCase();

  // 1. Check existing record
  if (cleanKey) {
    const existing = await getUserByApiKeyFromDb(cleanKey);
    if (existing) {
      if (cleanEmail && !existing.email.includes('@')) {
        existing.email = cleanEmail;
        usersByEmail.set(cleanEmail, existing);
        saveUsersToDisk();
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
        usersByApiKey.set(cleanKey, existing);
        saveUsersToDisk();
        await updateUserInDb(existing.apiKey, { api_key: cleanKey });
      }
      return existing;
    }
  }

  // 2. Create new user
  const finalKey = cleanKey || generateRandomHexApiKey();
  const finalEmail = cleanEmail || (cleanKey ? `user_${cleanKey.substring(3, 11)}@platform.ai` : 'developer@intelligence.internal');
  const now = new Date().toISOString();
  const userId = `usr_${crypto.randomBytes(12).toString('hex')}`;

  const newUser: UserAccount = {
    id: userId,
    email: finalEmail,
    apiKey: finalKey,
    tier,
    assignedProviderKey: assignedProviderKey || undefined,
    assignedModel: assignedModel || undefined,
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

  // Sync to local memory + disk
  usersByApiKey.set(finalKey, newUser);
  usersByEmail.set(finalEmail, newUser);
  saveUsersToDisk();

  // Async Upsert into Supabase DB
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('users').upsert(
          {
            id: userId,
            email: finalEmail,
            api_key: finalKey,
            tier,
            assigned_provider_key: assignedProviderKey || null,
            assigned_model: assignedModel || null,
            created_at: now,
            updated_at: now,
          },
          { onConflict: 'email' }
        );
      } catch (err) {
        console.warn('[Supabase DB Upsert]:', err);
      }
    }
  }

  return newUser;
}

/**
 * 4. Update user fields
 */
export async function updateUserInDb(
  apiKeyOrEmail: string,
  fieldsToUpdate: Partial<{
    email: string;
    api_key: string;
    tier: UserTier;
    assigned_provider_key: string | null;
    assigned_model: string | null;
  }>
): Promise<void> {
  const clean = apiKeyOrEmail.trim().toLowerCase();
  const user = usersByEmail.get(clean) || usersByApiKey.get(apiKeyOrEmail.trim());
  if (user) {
    if (fieldsToUpdate.email) user.email = fieldsToUpdate.email;
    if (fieldsToUpdate.api_key) user.apiKey = fieldsToUpdate.api_key;
    if (fieldsToUpdate.tier) user.tier = fieldsToUpdate.tier;
    if ('assigned_provider_key' in fieldsToUpdate) {
      user.assignedProviderKey = fieldsToUpdate.assigned_provider_key || undefined;
    }
    if ('assigned_model' in fieldsToUpdate) {
      user.assignedModel = fieldsToUpdate.assigned_model || undefined;
    }
    user.updatedAt = new Date().toISOString();
    usersByEmail.set(user.email.toLowerCase(), user);
    usersByApiKey.set(user.apiKey, user);
    saveUsersToDisk();
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase
          .from('users')
          .update({ ...fieldsToUpdate, updated_at: new Date().toISOString() })
          .or(`email.eq.${clean},api_key.eq.${apiKeyOrEmail.trim()}`);
      } catch {}
    }
  }
}

/**
 * 5. Update user tier
 */
export async function updateUserTierInDb(emailOrKey: string, newTier: UserTier): Promise<UserAccount | null> {
  const clean = emailOrKey.trim().toLowerCase();
  const now = new Date().toISOString();

  let user = usersByEmail.get(clean) || usersByApiKey.get(emailOrKey.trim());
  if (user) {
    user.tier = newTier;
    user.updatedAt = now;
    usersByEmail.set(user.email.toLowerCase(), user);
    usersByApiKey.set(user.apiKey, user);
    saveUsersToDisk();
  }

  // Update in Supabase DB
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

        if (data && !error && !user) {
          user = {
            id: data.id,
            email: data.email,
            apiKey: data.api_key,
            tier: data.tier as UserTier,
            assignedProviderKey: data.assigned_provider_key || undefined,
            assignedModel: data.assigned_model || undefined,
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
          usersByApiKey.set(user.apiKey, user);
          usersByEmail.set(user.email.toLowerCase(), user);
          saveUsersToDisk();
        }
      } catch (err) {
        console.warn('[DB User Tier Update Error]:', err);
      }
    }
  }

  return user || null;
}

/**
 * 6. Assign Dedicated Key & Custom Model Routing per User
 */
export async function updateUserConfigInDb(
  emailOrKey: string,
  updates: {
    apiKey?: string;
    tier?: UserTier;
    assignedProviderKey?: string;
    assignedModel?: string;
    customModelRouting?: Record<string, string>;
  }
): Promise<UserAccount | null> {
  const clean = emailOrKey.trim().toLowerCase();
  const now = new Date().toISOString();

  let user = usersByEmail.get(clean) || usersByApiKey.get(emailOrKey.trim());
  if (user) {
    if (updates.tier) user.tier = updates.tier;
    if (updates.assignedProviderKey !== undefined) user.assignedProviderKey = updates.assignedProviderKey.trim() || undefined;
    if (updates.assignedModel !== undefined) user.assignedModel = updates.assignedModel.trim() || undefined;
    if (updates.customModelRouting !== undefined) user.customModelRouting = updates.customModelRouting;
    if (updates.apiKey && updates.apiKey.trim().startsWith('sk-')) {
      const oldKey = user.apiKey;
      usersByApiKey.delete(oldKey);
      user.apiKey = updates.apiKey.trim();
      usersByApiKey.set(user.apiKey, user);
    }
    user.updatedAt = now;
    usersByEmail.set(user.email.toLowerCase(), user);
    usersByApiKey.set(user.apiKey, user);
    saveUsersToDisk();
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const payload: Record<string, unknown> = { updated_at: now };
        if (updates.tier) payload.tier = updates.tier;
        if (updates.assignedProviderKey !== undefined) payload.assigned_provider_key = updates.assignedProviderKey.trim() || null;
        if (updates.assignedModel !== undefined) payload.assigned_model = updates.assignedModel.trim() || null;
        if (updates.apiKey) payload.api_key = updates.apiKey.trim();

        const { data, error } = await supabase
          .from('users')
          .update(payload)
          .or(`email.eq.${clean},api_key.eq.${emailOrKey.trim()}`)
          .select()
          .maybeSingle();

        if (data && !error && !user) {
          user = {
            id: data.id,
            email: data.email,
            apiKey: data.api_key,
            tier: data.tier as UserTier,
            assignedProviderKey: data.assigned_provider_key || undefined,
            assignedModel: data.assigned_model || undefined,
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
          usersByApiKey.set(user.apiKey, user);
          usersByEmail.set(user.email.toLowerCase(), user);
          saveUsersToDisk();
        }
      } catch (err) {
        console.warn('[DB Update User Config Error]:', err);
      }
    }
  }

  return user || null;
}

/**
 * 7. Get all users for Admin Dashboard
 */
export async function getAllUsersFromDb(): Promise<UserAccount[]> {
  const usersMap = new Map<string, UserAccount>();

  // 1. Load all local & disk users first
  for (const u of usersByEmail.values()) {
    if (u && u.email) {
      usersMap.set(u.email.toLowerCase(), u);
    }
  }
  for (const u of usersByApiKey.values()) {
    if (u && u.email) {
      usersMap.set(u.email.toLowerCase(), u);
    }
  }

  // 2. Fetch from Supabase DB and merge
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
            const emailKey = (d.email || '').toLowerCase();
            if (emailKey) {
              const existing = usersMap.get(emailKey);
              const userRecord: UserAccount = {
                id: d.id || existing?.id || `usr_${d.api_key?.substring(3, 11)}`,
                email: d.email,
                apiKey: d.api_key || existing?.apiKey || '',
                tier: (d.tier as UserTier) || existing?.tier || 'free',
                assignedProviderKey: d.assigned_provider_key || existing?.assignedProviderKey || undefined,
                assignedModel: d.assigned_model || existing?.assignedModel || undefined,
                customModelRouting: existing?.customModelRouting || undefined,
                createdAt: d.created_at || existing?.createdAt || new Date().toISOString(),
                updatedAt: d.updated_at || existing?.updatedAt || new Date().toISOString(),
                usage: existing?.usage || {
                  totalRequests: 0,
                  totalCost: 0,
                  totalRequestsLeft: RATE_LIMIT_MAX_REQUESTS,
                  totalPromptTokens: 0,
                  totalCompletionTokens: 0,
                  rateLimitWindowHours: RATE_LIMIT_WINDOW_HOURS,
                  rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
                },
                usageLogs: existing?.usageLogs || [],
              };
              usersMap.set(emailKey, userRecord);
              usersByApiKey.set(userRecord.apiKey, userRecord);
              usersByEmail.set(emailKey, userRecord);
            }
          }
          saveUsersToDisk();
        }
      } catch (err) {
        console.warn('[DB Fetch All Users Exception]:', err);
      }
    }
  }

  return Array.from(usersMap.values());
}

/**
 * 8. Persistent audit logs
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

  const logsList = usageLogsByApiKey.get(apiKey) || [];
  logsList.unshift(log);
  if (logsList.length > 500) logsList.pop();
  usageLogsByApiKey.set(apiKey, logsList);

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
 * 9. Retrieve audit logs
 */
export async function getRecentLogsFromDb(apiKey: string): Promise<UsageLog[]> {
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
          return data.map((d) => ({
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
        }
      } catch {}
    }
  }

  return usageLogsByApiKey.get(apiKey) || [];
}
