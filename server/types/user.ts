export type UserTier = 'free' | 'pro' | 'enterprise';

export interface UsageLog {
  id: string;
  timestamp: string;
  endpoint: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  status: 'success' | 'rate_limited' | 'error' | 'forbidden';
  ip?: string;
}

export interface UserUsage {
  totalRequests: number;
  totalCost: number;
  totalRequestsLeft: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  rateLimitWindowHours: number;
  rateLimitMaxRequests: number;
}

export interface UserAccount {
  id: string;
  email: string;
  apiKey: string; // sk-<randomhex>
  apiKeyHash?: string;
  tier: UserTier;
  assignedProviderKey?: string; // Dedicated upstream OpenCode Zen key for PRO user
  createdAt: string;
  updatedAt: string;
  usage: UserUsage;
  usageLogs: UsageLog[];
}

export interface ModelPricing {
  model: string;
  requiredTier: UserTier;
  inputCostPer1kTokens: number; // in USD
  outputCostPer1kTokens: number; // in USD
}
