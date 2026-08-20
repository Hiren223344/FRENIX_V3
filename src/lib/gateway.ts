export interface GatewayStats {
  tier?: string;
  keyPrefix?: string;
  plainKey?: string;
  stats: {
    totalRequests: number;
    failedRequests: number;
    totalCostUsd?: number;
    tokens?: {
      total: number;
      prompt?: number;
      completion?: number;
    };
    modelsUsed?: Record<string, number | { requests: number }>;
  };
}
