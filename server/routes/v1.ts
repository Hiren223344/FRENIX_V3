import { Router, Request, Response } from 'express';
import {
  createChatCompletion,
  streamChatCompletion,
  SUPPORTED_MODELS,
} from '../services/llmEngine.js';
import {
  createAnthropicMessage,
  streamAnthropicMessage,
} from '../services/anthropicEngine.js';
import {
  createUserAccount,
  canAccessModel,
  getModelPricing,
  MODEL_PRICING,
  DEFAULT_MODEL_PRICING,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_HOURS,
} from '../services/userStore.js';
import {
  createOrGetDbUser,
  getUserByApiKeyFromDb,
  getUserByEmailFromDb,
  persistUsageLogToDb,
  getRecentLogsFromDb,
} from '../services/dbUserStore.js';
import {
  getUsageStatsFromRedis,
  incrementUsageInRedis,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
} from '../services/redisUsageService.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { getAuth } from '@clerk/express';
import { getIdentityForModel, buildComposedSystemPrompt } from '../services/identityService.js';
import { fetchProvider1Models, MODEL_ROUTING_MAP } from '../services/providerService.js';
import storageRouter from './storage.js';
import type { ChatCompletionRequest } from '../types/openai.js';
import type { AnthropicMessagesRequest } from '../types/anthropic.js';
import type { UserTier } from '../types/user.js';

const v1Router = Router();

// 1. Root & Health Check Endpoints
v1Router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'online',
    version: 'v1',
    description: 'Intelligence Evolution Platform API Gateway v1 (DB Auth + Redis Metrics)',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /v1/health',
      ok: 'GET /v1/ok',
      chatCompletions: 'POST /v1/chat/completions',
      models: 'GET /v1/models',
      messages: 'POST /v1/messages',
      createUser: 'POST /v1/user/create',
      userUsage: 'GET /v1/user/usage',
      pricing: 'GET /v1/pricing',
      identity: 'GET /v1/identity',
      storage: 'ALL /v1/storage/*',
    },
  });
});

v1Router.get('/ok', (_req: Request, res: Response) => {
  res.status(200).send('ok :0');
});

v1Router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    version: '1.0.0',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
    services: {
      llmEngine: 'active',
      redisMetrics: 'active',
      database: 'active',
      anthropicMessages: 'active',
      rateLimiter: 'active (800 req / 5h via Redis)',
      storage: 'active',
    },
  });
});

// 2. Identity Service Inspector Endpoint: GET /v1/identity
v1Router.get('/identity', (req: Request, res: Response) => {
  const modelName = (req.query.model as string) || 'claude-3-5-sonnet';
  const userPrompt = req.query.userPrompt as string | undefined;

  const identity = getIdentityForModel(modelName);
  const composed = buildComposedSystemPrompt(modelName, userPrompt);

  return res.status(200).json({
    success: true,
    model: modelName,
    family: identity.family,
    name: identity.name,
    baseIdentityPrompt: identity.systemPrompt,
    userProvidedPrompt: userPrompt || null,
    finalComposedSystemPrompt: composed,
    formatRule: 'Our System Prompt + User System Prompt',
  });
});

// 3. Model Pricing & Tier Table Endpoint: GET /v1/pricing
v1Router.get('/pricing', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    description: 'Intelligence Evolution Model Pricing & Tier Requirements',
    currency: 'USD',
    rateLimitPolicy: {
      maxRequests: RATE_LIMIT_MAX,
      windowHours: 5,
      rateLimiter: 'Redis Sliding Window Engine',
    },
    tierPolicy: {
      free: ['gpt-4o-mini', 'claude-3-5-haiku-20241022', 'mimo-v2.5-free', 'deepseek-v4-flash-free'],
      pro: ['intelligence-evolution-v1', 'claude-opus-5', 'gpt-4o', 'gpt-4-turbo', 'claude-3-5-sonnet', 'claude-3-7-sonnet-20250219'],
      enterprise: ['all-models', 'custom-fine-tunes'],
    },
    pricing: MODEL_PRICING,
    fallbackPricing: DEFAULT_MODEL_PRICING,
  });
});

// 4. User Creation Endpoint: POST /v1/user/create (Stored in Database)
v1Router.post('/user/create', async (req: Request, res: Response) => {
  try {
    const { email, tier, preferredApiKey } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'A valid email address is required to create a user account.',
          type: 'invalid_request_error',
          param: 'email',
        },
      });
    }

    const assignedTier: UserTier = tier === 'enterprise' || tier === 'free' ? tier : 'pro';
    const user = await createOrGetDbUser(preferredApiKey, email, assignedTier);

    return res.status(201).json({
      success: true,
      message: `User created successfully in DB under email: ${user.email}`,
      user: {
        id: user.id,
        email: user.email,
        apiKey: user.apiKey,
        tier: user.tier,
        createdAt: user.createdAt,
        storedIn: 'Supabase PostgreSQL Database',
      },
    });
  } catch (err: unknown) {
    console.error('Error in /v1/user/create:', err);
    const message = err instanceof Error ? err.message : 'User creation failed';
    return res.status(500).json({ success: false, error: message });
  }
});

// 5. User Usage Query Endpoint: GET /v1/user/usage
// API Key & User identity told by DB; Rate Limits, Tokens, & Cost told by Redis
v1Router.get('/user/usage', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'] as string;
    const emailQuery = req.query.email as string;

    const rawKey = apiKeyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined);
    
    // DB tells the API key and user record
    const user = await createOrGetDbUser(rawKey, emailQuery);

    // Redis tells the rate limiting status, total cost, and token metrics
    const redisStats = await getUsageStatsFromRedis(user.apiKey);

    // DB tells recent audit logs
    const recentLogs = await getRecentLogsFromDb(user.apiKey);

    // Set Rate Limit HTTP Headers from Redis
    res.setHeader('X-RateLimit-Limit', redisStats.rateLimit.limit.toString());
    res.setHeader('X-RateLimit-Remaining', redisStats.rateLimit.remaining.toString());
    res.setHeader('X-RateLimit-Reset', redisStats.rateLimit.resetInSeconds.toString());
    res.setHeader('X-RateLimit-Window', '5h');

    return res.status(200).json({
      success: true,
      email: user.email,
      apiKey: user.apiKey,
      tier: user.tier,
      database: {
        userId: user.id,
        email: user.email,
        apiKey: user.apiKey,
        tier: user.tier,
        authority: 'PostgreSQL Database',
      },
      redis: {
        rateLimit: redisStats.rateLimit,
        usage: redisStats.usage,
        engine: 'Redis Sliding-Window & Atomic Counter',
      },
      rateLimit: redisStats.rateLimit,
      usage: redisStats.usage,
      recentLogs,
    });
  } catch (err: unknown) {
    console.error('Error in /v1/user/usage:', err);
    const message = err instanceof Error ? err.message : 'Failed to retrieve usage';
    return res.status(500).json({ success: false, error: message });
  }
});

// 6. Comprehensive User Profile & Telemetry Endpoint: GET /v1/user/me
v1Router.all(['/user/me', '/me'], async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'] as string;
    const emailQuery = (req.query.email as string) || (req.body?.email as string);

    let clerkUserId: string | null = null;
    let clerkSessionId: string | null = null;
    try {
      const clerkAuth = getAuth(req);
      clerkUserId = clerkAuth?.userId || null;
      clerkSessionId = clerkAuth?.sessionId || null;
    } catch {
      // clerk optional
    }

    const rawKey = apiKeyHeader || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined);

    // 1. Database tells user profile, email, API key, tier, creation date
    const user = await createOrGetDbUser(rawKey, emailQuery);

    // 2. Redis tells real-time rate limit (800 req / 5h), token usage, and total costs
    const redisStats = await getUsageStatsFromRedis(user.apiKey);

    // 3. Database tells persistent historical audit logs
    const recentLogs = await getRecentLogsFromDb(user.apiKey);

    // Set Rate Limit HTTP Headers from Redis
    res.setHeader('X-RateLimit-Limit', redisStats.rateLimit.limit.toString());
    res.setHeader('X-RateLimit-Remaining', redisStats.rateLimit.remaining.toString());
    res.setHeader('X-RateLimit-Reset', redisStats.rateLimit.resetInSeconds.toString());
    res.setHeader('X-RateLimit-Window', '5h');

    return res.status(200).json({
      success: true,
      message: 'Comprehensive user profile and telemetry retrieved successfully',
      user: {
        id: user.id,
        email: user.email,
        apiKey: user.apiKey,
        maskedKey: user.apiKey ? `${user.apiKey.slice(0, 7)}...${user.apiKey.slice(-6)}` : null,
        tier: user.tier,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      database: {
        authority: 'Supabase PostgreSQL Database',
        record: {
          id: user.id,
          email: user.email,
          apiKey: user.apiKey,
          tier: user.tier,
          createdAt: user.createdAt,
        },
      },
      redis: {
        engine: 'Redis Sliding Window & Atomic Counters',
        rateLimit: redisStats.rateLimit,
        usage: redisStats.usage,
      },
      rateLimit: redisStats.rateLimit,
      usage: redisStats.usage,
      recentLogs,
      clerkSession: {
        authenticated: Boolean(clerkUserId),
        userId: clerkUserId,
        sessionId: clerkSessionId,
      },
      gateway: {
        activeProvider: 'Provider-1 (OpenCode Zen)',
        modelRouting: MODEL_ROUTING_MAP,
      },
    });
  } catch (err: unknown) {
    console.error('Error in /v1/user/me:', err);
    const message = err instanceof Error ? err.message : 'Failed to retrieve user telemetry';
    return res.status(500).json({ success: false, error: message });
  }
});

// 7. OpenAI-Compatible Models Endpoint
v1Router.get('/models', async (_req: Request, res: Response) => {
  try {
    const providerModels = await fetchProvider1Models();
    const mergedMap = new Map<string, typeof SUPPORTED_MODELS[0]>();
    SUPPORTED_MODELS.forEach((m) => mergedMap.set(m.id, m));
    providerModels.forEach((m) => mergedMap.set(m.id, m));

    res.status(200).json({
      object: 'list',
      data: Array.from(mergedMap.values()),
    });
  } catch {
    res.status(200).json({
      object: 'list',
      data: SUPPORTED_MODELS,
    });
  }
});

v1Router.get('/models/:model', async (req: Request, res: Response) => {
  const modelId = req.params.model;
  const found = SUPPORTED_MODELS.find((m) => m.id === modelId);

  if (found) {
    return res.status(200).json(found);
  }

  const providerModels = await fetchProvider1Models();
  const providerFound = providerModels.find((m) => m.id === modelId);
  if (providerFound) {
    return res.status(200).json(providerFound);
  }

  return res.status(404).json({
    error: {
      message: `Model '${modelId}' does not exist`,
      type: 'invalid_request_error',
      param: 'model',
      code: 'model_not_found',
    },
  });
});

// 7. OpenAI-Compatible Chat Completions Endpoint (DB Key Validation + Redis Rate Limiting)
v1Router.post('/chat/completions', rateLimitMiddleware, async (req: Request, res: Response) => {
  try {
    const { messages, model, stream, temperature, max_tokens } = req.body as ChatCompletionRequest;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: "Missing required parameter: 'messages' must be a non-empty array",
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_required_parameter',
        },
      });
    }

    const selectedModel = model || 'intelligence-evolution-v1';

    // Extract API Key from request
    const authHeader = req.headers.authorization;
    const rawApiKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;

    // DB tells and validates user by API Key
    const user = await createOrGetDbUser(rawApiKey, (req.body as any)?.user || (req.query?.email as string));

    // Check Model Tier Permissions in DB
    const accessCheck = canAccessModel(user, selectedModel);
    if (!accessCheck.allowed) {
      await persistUsageLogToDb({
        apiKey: user.apiKey,
        email: user.email,
        endpoint: '/v1/chat/completions',
        model: selectedModel,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        status: 'forbidden',
        ip: req.ip,
      });

      return res.status(403).json({
        error: {
          message: accessCheck.reason,
          type: 'permission_error',
          code: 'tier_upgrade_required',
          required_tier: 'pro',
          current_tier: user.tier,
        },
      });
    }

    const requestPayload: ChatCompletionRequest = {
      model: selectedModel,
      messages,
      stream: Boolean(stream),
      temperature,
      max_tokens,
    };

    // Calculate costs
    const pricing = getModelPricing(selectedModel);

    // Handle Streaming (SSE)
    if (requestPayload.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const generator = streamChatCompletion(requestPayload, rawApiKey);

      for await (const chunk of generator) {
        res.write(chunk);
      }

      const promptEstimate = messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? Math.ceil(m.content.length / 4) : 10), 0);
      const completionEstimate = 50;
      const costUsd = (promptEstimate / 1000) * pricing.inputCostPer1kTokens + (completionEstimate / 1000) * pricing.outputCostPer1kTokens;

      // Redis atomically increments tokens, requests, and cost
      await incrementUsageInRedis({
        identifier: user.apiKey,
        promptTokens: promptEstimate,
        completionTokens: completionEstimate,
        costUsd,
      });

      // DB stores persistent audit log
      await persistUsageLogToDb({
        apiKey: user.apiKey,
        email: user.email,
        endpoint: '/v1/chat/completions',
        model: selectedModel,
        promptTokens: promptEstimate,
        completionTokens: completionEstimate,
        costUsd,
        status: 'success',
        ip: req.ip,
      });

      res.end();
      return;
    }

    // Handle Non-Streaming (Standard JSON response)
    const result = await createChatCompletion(requestPayload, rawApiKey);

    const promptTokens = result.usage?.prompt_tokens || 10;
    const completionTokens = result.usage?.completion_tokens || 10;
    const costUsd = (promptTokens / 1000) * pricing.inputCostPer1kTokens + (completionTokens / 1000) * pricing.outputCostPer1kTokens;

    // Redis atomically increments tokens, requests, and cost
    await incrementUsageInRedis({
      identifier: user.apiKey,
      promptTokens,
      completionTokens,
      costUsd,
    });

    // DB stores persistent audit log
    await persistUsageLogToDb({
      apiKey: user.apiKey,
      email: user.email,
      endpoint: '/v1/chat/completions',
      model: selectedModel,
      promptTokens,
      completionTokens,
      costUsd,
      status: 'success',
      ip: req.ip,
    });

    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('Error in /v1/chat/completions:', err);
    const errorMessage = err instanceof Error ? err.message : 'Internal Server Error';
    return res.status(500).json({
      error: {
        message: errorMessage,
        type: 'api_error',
        param: null,
        code: 'internal_error',
      },
    });
  }
});

// 8. Anthropic-Compatible Messages Endpoint (/v1/messages and /v1/messeges alias)
const handleAnthropicMessages = async (req: Request, res: Response) => {
  try {
    const { messages, model, system, max_tokens, stream, temperature, top_p, top_k } =
      req.body as AnthropicMessagesRequest;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'messages: Field required and must be a non-empty array',
        },
      });
    }

    const selectedModel = model || 'claude-3-5-sonnet-20241022';
    const rawApiKey =
      (req.headers['x-api-key'] as string) ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.substring(7).trim()
        : undefined);

    const anthropicVersion = (req.headers['anthropic-version'] as string) || '2023-06-01';

    // DB tells and validates user by API Key
    const user = await createOrGetDbUser(
      rawApiKey,
      (req.body as any)?.metadata?.user_id || (req.query?.email as string)
    );

    // Check Model Tier
    const accessCheck = canAccessModel(user, selectedModel);
    if (!accessCheck.allowed) {
      await persistUsageLogToDb({
        apiKey: user.apiKey,
        email: user.email,
        endpoint: '/v1/messages',
        model: selectedModel,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        status: 'forbidden',
        ip: req.ip,
      });

      return res.status(403).json({
        type: 'error',
        error: {
          type: 'permission_error',
          message: accessCheck.reason,
        },
      });
    }

    const requestPayload: AnthropicMessagesRequest = {
      model: selectedModel,
      messages,
      system,
      max_tokens: max_tokens || 4096,
      stream: Boolean(stream),
      temperature,
      top_p,
      top_k,
    };

    const pricing = getModelPricing(selectedModel);

    // Handle Streaming (SSE with Anthropic events)
    if (requestPayload.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const generator = streamAnthropicMessage(requestPayload, rawApiKey, anthropicVersion);

      for await (const chunk of generator) {
        res.write(chunk);
      }

      const promptEstimate = messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? Math.ceil(m.content.length / 4) : 10), 0);
      const completionEstimate = 50;
      const costUsd = (promptEstimate / 1000) * pricing.inputCostPer1kTokens + (completionEstimate / 1000) * pricing.outputCostPer1kTokens;

      // Redis atomically increments metrics
      await incrementUsageInRedis({
        identifier: user.apiKey,
        promptTokens: promptEstimate,
        completionTokens: completionEstimate,
        costUsd,
      });

      // DB records audit log
      await persistUsageLogToDb({
        apiKey: user.apiKey,
        email: user.email,
        endpoint: '/v1/messages',
        model: selectedModel,
        promptTokens: promptEstimate,
        completionTokens: completionEstimate,
        costUsd,
        status: 'success',
        ip: req.ip,
      });

      res.end();
      return;
    }

    // Handle Non-Streaming
    const result = await createAnthropicMessage(requestPayload, rawApiKey, anthropicVersion);

    const promptTokens = result.usage?.input_tokens || 10;
    const completionTokens = result.usage?.output_tokens || 10;
    const costUsd = (promptTokens / 1000) * pricing.inputCostPer1kTokens + (completionTokens / 1000) * pricing.outputCostPer1kTokens;

    // Redis atomically increments metrics
    await incrementUsageInRedis({
      identifier: user.apiKey,
      promptTokens,
      completionTokens,
      costUsd,
    });

    // DB records audit log
    await persistUsageLogToDb({
      apiKey: user.apiKey,
      email: user.email,
      endpoint: '/v1/messages',
      model: selectedModel,
      promptTokens,
      completionTokens,
      costUsd,
      status: 'success',
      ip: req.ip,
    });

    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('Error in /v1/messages:', err);
    const errorMessage = err instanceof Error ? err.message : 'Internal Server Error';
    return res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: errorMessage,
      },
    });
  }
};

v1Router.post('/messages', rateLimitMiddleware, handleAnthropicMessages);
v1Router.post('/messeges', rateLimitMiddleware, handleAnthropicMessages);

// 9. Mount Supabase Storage Sub-Router at /v1/storage
v1Router.use('/storage', storageRouter);

export default v1Router;
