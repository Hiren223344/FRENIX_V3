import dotenv from 'dotenv';
dotenv.config();

import type { ChatCompletionRequest, ChatCompletionResponse, ModelObject } from '../types/openai.js';
import type {
  AnthropicMessagesRequest,
  AnthropicMessageResponse,
} from '../types/anthropic.js';
import type { UserAccount } from '../types/user.js';
import { buildComposedSystemPrompt } from './identityService.js';

export const PROVIDER_1_NAME = 'Provider-1 (NewAPI)';
export const DEFAULT_PROVIDER_1_URL = 'https://newapi.frenix.sh/v1';

// Active Key Pool for Automatic Failover on 429 Rate Limits
export function getCandidateKeys(preferredKey?: string): string[] {
  const list: string[] = [];

  // 1. Dedicated Assigned Key (highest priority)
  if (preferredKey && preferredKey.trim().startsWith('sk-')) {
    list.push(preferredKey.trim());
  }

  // 2. Keys from .env (PROVIDER_1_API_KEYS / PROVIDER_1_API_KEY)
  const envMulti = process.env.PROVIDER_1_API_KEYS || process.env.OPENAI_API_KEYS;
  if (envMulti) {
    const keys = envMulti
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.startsWith('sk-'));
    for (const k of keys) {
      if (!list.includes(k)) list.push(k);
    }
  }

  const envSingle = process.env.PROVIDER_1_API_KEY || process.env.OPENAI_API_KEY;
  if (envSingle && envSingle.trim().startsWith('sk-')) {
    const clean = envSingle.trim();
    if (!list.includes(clean)) list.push(clean);
  }

  // 3. Fallback defaults
  const defaults = [
    'sk-Rc4f1e8T2SVgEn1U6hNrmukmLZoC9xnY1F4t44s4iOmjt8HC',
    'sk-a3xZh5wVaJdZlMdnIf7uMX8CswUR4UJIb79LrHApLW93kbQVmWUshFK2RyZQTZ2x',
    'sk-Y2qeo16JleKRXmeqDh4I4PqY4JO1vEmchnDXUAxKIaphzt0onXH2twzTCTgHcOCK',
    'sk-a24WFR2BPxwJgckqE1i6QQNyPBrywGU49g8Mc5nN0EWmaHCrVPVyMet2KyZsstq1',
    'sk-tubtj6Jb2Qxmk48LtiYfDlAfRU1N1F3r3bpBTaqnl2kyGcjg6GcL9PqdOX6mnH8S',
  ];

  for (const d of defaults) {
    if (!list.includes(d)) list.push(d);
  }

  return list;
}

// Global Default Model Routing / Aliasing Map -> Default target: qwen3.5-397B
export const MODEL_ROUTING_MAP: Record<string, string> = {
  'claude-opus-5': 'qwen3.5-397B',
  'claude-opus-5-2025': 'qwen3.5-397B',
  'claude-3-7-sonnet-20250219': 'qwen3.5-397B',
  'claude-3-5-sonnet-20241022': 'qwen3.5-397B',
  'claude-3-5-sonnet': 'qwen3.5-397B',
  'claude-3-opus-20240229': 'qwen3.5-397B',
  'intelligence-evolution-v1': 'qwen3.5-397B',
  'deepseek-v4-flash': 'qwen3.5-397B',
  'deepseek-v4-flash-free': 'qwen3.5-397B',
  'deepseek-chat': 'qwen3.5-397B',
  'deepseek-reasoner': 'qwen3.5-397B',
  'deepseek-r1': 'qwen3.5-397B',
  'deepseek-v3': 'qwen3.5-397B',
};

// Model Fallback Map: If primary model is down or unavailable upstream, fallback automatically
export const MODEL_FALLBACK_MAP: Record<string, string> = {
  'deepseek-v4-flash': 'qwen3.5-397B',
  'deepseek-v4-flash-free': 'qwen3.5-397B',
  'deepseek-chat': 'qwen3.5-397B',
  'deepseek-reasoner': 'qwen3.5-397B',
  'deepseek-r1': 'qwen3.5-397B',
  'deepseek-v3': 'qwen3.5-397B',
};

export function getFallbackModel(modelName: string): string | null {
  const norm = (modelName || '').toLowerCase().trim();
  return MODEL_FALLBACK_MAP[norm] || null;
}

/**
 * Resolve target model according to user configuration & routing rules
 * 1. User specific model routing map (e.g. user.customModelRouting['claude-opus-5'] = 'qwen3.5-397B')
 * 2. User assigned model override (e.g. user.assignedModel = 'qwen3.5-397B')
 * 3. Global routing map (defaults to qwen3.5-397B)
 */
export function resolveRoutedModel(requestedModel: string, user?: UserAccount | null): string {
  const normalized = (requestedModel || '').toLowerCase().trim();

  // 1. Check user-specific custom model routing map
  if (user?.customModelRouting && user.customModelRouting[normalized]) {
    return user.customModelRouting[normalized];
  }

  // 2. Check user-specific assigned model override
  if (user?.assignedModel && user.assignedModel.trim()) {
    return user.assignedModel.trim();
  }

  // 3. Global routing map
  if (MODEL_ROUTING_MAP[normalized]) {
    return MODEL_ROUTING_MAP[normalized];
  }

  if (normalized.includes('claude') || normalized.includes('opus') || normalized.includes('evolution')) {
    return 'qwen3.5-397B';
  }

  return requestedModel || 'qwen3.5-397B';
}

export function getProvider1BaseUrl(): string {
  return (process.env.PROVIDER_1_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_PROVIDER_1_URL).replace(/\/+$/, '');
}

/**
 * Extract clean plain text from string or structured content array
 */
export function extractCleanText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          if ('text' in item && typeof (item as any).text === 'string') return (item as any).text;
          if ('content' in item && typeof (item as any).content === 'string') return (item as any).content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object' && 'text' in content && typeof (content as any).text === 'string') {
    return (content as any).text;
  }
  return '';
}

/**
 * Build sanitized OpenAI messages list
 * GUARANTEES concatenation: [Our Platform Identity Prompt] + "\n\n" + [User / Client System Prompt]
 */
export function sanitizeMessages(
  messages: Array<{ role: string; content: unknown }>,
  systemPrompt?: unknown,
  modelName: string = 'claude-opus-5'
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];

  // Extract user system prompt (if any)
  let userSystem = extractCleanText(systemPrompt).trim();
  
  // Check if first message is a system message
  const firstMsg = messages?.[0];
  if (firstMsg && firstMsg.role === 'system') {
    const firstSystemText = extractCleanText(firstMsg.content).trim();
    if (firstSystemText) {
      userSystem = userSystem ? `${userSystem}\n\n${firstSystemText}` : firstSystemText;
    }
  }

  // Concatenate: [Our System Prompt] + "\n\n" + [User System Prompt]
  const composedSystem = buildComposedSystemPrompt(modelName, userSystem);
  if (composedSystem) {
    result.push({ role: 'system', content: composedSystem });
  }

  // Append user & assistant conversation messages
  for (const m of messages || []) {
    if (m.role === 'system') continue;
    const text = extractCleanText(m.content).trim();
    if (text) {
      result.push({
        role: m.role || 'user',
        content: text,
      });
    }
  }

  // Ensure at least one user message exists
  if (result.length === 1 && result[0].role === 'system') {
    result.push({ role: 'user', content: 'Hello' });
  } else if (result.length === 0) {
    result.push({ role: 'user', content: 'Hello' });
  }

  return result;
}

/**
 * Dispatch chat completion to Provider-1 with dedicated key first, with automatic failover on 429 RateLimit
 */
async function attemptProvider1Completion(
  targetModel: string,
  messages: Array<{ role: string; content: string }>,
  preferredKey?: string
): Promise<ChatCompletionResponse | null> {
  const baseUrl = getProvider1BaseUrl();
  const bodyToSend: Record<string, unknown> = {
    model: targetModel,
    messages,
    stream: false,
  };

  // Build candidate keys: Preferred Dedicated Key FIRST, followed by .env and fallback pool
  const candidateKeys = getCandidateKeys(preferredKey);

  for (let i = 0; i < candidateKeys.length; i++) {
    const apiKey = candidateKeys[i];
    const masked = `${apiKey.slice(0, 7)}...${apiKey.slice(-6)}`;

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(bodyToSend),
      });

      if (response.ok) {
        return (await response.json()) as ChatCompletionResponse;
      }

      if (response.status === 429 || response.status === 401) {
        console.warn(`[Provider-1 429/401] Key ${masked} rate limited on ${baseUrl}. Immediately trying next candidate key (${i + 1}/${candidateKeys.length})...`);
        continue;
      }

      const errorText = await response.text();
      console.warn(`[Provider-1 ${targetModel} Error ${response.status} with key ${masked} on ${baseUrl}]:`, errorText);
    } catch (err: unknown) {
      console.warn(`[Provider-1 Network Error with key ${masked} on ${baseUrl}]:`, err instanceof Error ? err.message : err);
    }
  }

  return null;
}

/**
 * Extract reasoning thoughts between <think> and </think> and separate from main content
 */
export function parseReasoningAndContent(raw: string): { reasoningContent?: string; mainContent: string } {
  if (!raw) return { mainContent: '' };

  const thinkBlockRegex = /<think>([\s\S]*?)<\/think>/i;
  const match = raw.match(thinkBlockRegex);

  if (match) {
    const reasoningContent = match[1].trim();
    const mainContent = raw.replace(thinkBlockRegex, '').trim();
    return { reasoningContent: reasoningContent || undefined, mainContent };
  }

  if (raw.includes('<think>') && !raw.includes('</think>')) {
    const parts = raw.split('<think>');
    return {
      reasoningContent: (parts[1] || '').trim() || undefined,
      mainContent: (parts[0] || '').trim(),
    };
  }

  if (raw.includes('</think>') && !raw.includes('<think>')) {
    const parts = raw.split('</think>');
    return {
      reasoningContent: (parts[0] || '').trim() || undefined,
      mainContent: (parts[1] || '').trim(),
    };
  }

  return { mainContent: raw };
}

/**
 * 1. Forward OpenAI Chat Completion to Provider-1 with User-specific routing and failover
 */
export async function forwardChatCompletionToProvider1(
  payload: ChatCompletionRequest,
  preferredKey?: string,
  user?: UserAccount | null
): Promise<ChatCompletionResponse | null> {
  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model, user);
  const cleanMessages = sanitizeMessages(payload.messages as any, undefined, originalModel);

  // 1. Initial attempt with target model
  let result = await attemptProvider1Completion(targetModel, cleanMessages, preferredKey);

  // 2. If target model failed, fallback to fallback model automatically
  if (!result) {
    const fallbackModel = getFallbackModel(targetModel) || getFallbackModel(originalModel);
    if (fallbackModel && fallbackModel !== targetModel) {
      console.log(`[Model Fallback] Model '${targetModel}' is unavailable upstream. Automatically falling back to '${fallbackModel}'...`);
      result = await attemptProvider1Completion(fallbackModel, cleanMessages, preferredKey);
    }
  }

  if (result) {
    const originalMessage = result.choices?.[0]?.message;
    const rawContent = originalMessage?.content || '';
    const existingReasoning = (originalMessage as any)?.reasoning_content;

    const { reasoningContent, mainContent } = parseReasoningAndContent(rawContent);
    const finalReasoning = existingReasoning || reasoningContent || undefined;
    const finalContent = reasoningContent ? mainContent : rawContent;

    return {
      ...result,
      model: originalModel,
      choices: [
        {
          ...result.choices[0],
          message: {
            role: originalMessage?.role || 'assistant',
            content: finalContent,
            reasoning_content: finalReasoning,
          },
        },
      ],
    };
  }

  return null;
}

/**
 * 2. Stream OpenAI SSE Chat Completion from Provider-1 with User-specific routing and failover
 */
export async function* streamChatCompletionFromProvider1(
  payload: ChatCompletionRequest,
  preferredKey?: string,
  user?: UserAccount | null
): AsyncGenerator<string, boolean, unknown> {
  const originalModel = payload.model;

  // 1. Fetch live completion from Provider-1 with automated fallback & key failover
  try {
    const nonStreamResult = await forwardChatCompletionToProvider1(payload, preferredKey, user);
    if (nonStreamResult) {
      const mainContent = nonStreamResult.choices?.[0]?.message?.content || '';
      const reasoningContent = nonStreamResult.choices?.[0]?.message?.reasoning_content || '';
      const completionId = nonStreamResult.id || `chatcmpl-${Date.now()}`;
      const created = nonStreamResult.created || Math.floor(Date.now() / 1000);

      // Initial chunk with role
      yield `data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: originalModel,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      })}\n\n`;

      // 1. Stream reasoning_content chunks first if model output thoughts
      if (reasoningContent) {
        const reasoningWords = reasoningContent.split(' ');
        for (let i = 0; i < reasoningWords.length; i++) {
          const chunkWord = (i === 0 ? '' : ' ') + reasoningWords[i];
          yield `data: ${JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: originalModel,
            choices: [{ index: 0, delta: { reasoning_content: chunkWord }, finish_reason: null }],
          })}\n\n`;
          await new Promise((r) => setTimeout(r, 10));
        }
      }

      // 2. Stream main content chunks
      if (mainContent) {
        const words = mainContent.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunkWord = (i === 0 ? '' : ' ') + words[i];
          yield `data: ${JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: originalModel,
            choices: [{ index: 0, delta: { content: chunkWord }, finish_reason: null }],
          })}\n\n`;
          await new Promise((r) => setTimeout(r, 10));
        }
      }

      // Final stop chunk
      yield `data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: originalModel,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`;
      yield `data: [DONE]\n\n`;
      return true;
    }
  } catch (err: unknown) {
    console.error('[Provider-1 Stream Error]:', err);
  }

  return false;
}

/**
 * 3. Forward Anthropic Messages request to Provider-1 with User-specific routing
 */
export async function forwardAnthropicMessageToProvider1(
  payload: AnthropicMessagesRequest,
  preferredKey?: string,
  user?: UserAccount | null
): Promise<AnthropicMessageResponse | null> {
  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model, user);
  const cleanMessages = sanitizeMessages(payload.messages as any, payload.system, originalModel);

  const openAiPayload: ChatCompletionRequest = {
    model: targetModel,
    messages: cleanMessages as any,
    stream: false,
  };

  const openAiResult = await forwardChatCompletionToProvider1(openAiPayload, preferredKey, user);
  if (openAiResult) {
    const mainContent = openAiResult.choices?.[0]?.message?.content || '';
    const reasoningContent = openAiResult.choices?.[0]?.message?.reasoning_content || '';

    const contentBlocks: any[] = [];
    if (reasoningContent) {
      contentBlocks.push({ type: 'thinking', thinking: reasoningContent });
    }
    contentBlocks.push({ type: 'text', text: mainContent });

    return {
      id: `msg_${(openAiResult.id || '').replace(/^chatcmpl-/, '')}`,
      type: 'message',
      role: 'assistant',
      model: originalModel,
      content: contentBlocks,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: openAiResult.usage?.prompt_tokens || 20,
        output_tokens: openAiResult.usage?.completion_tokens || 20,
      },
    };
  }

  return null;
}

/**
 * 4. Stream Anthropic Messages from Provider-1 with User-specific routing
 */
export async function* streamAnthropicMessageFromProvider1(
  payload: AnthropicMessagesRequest,
  preferredKey?: string,
  user?: UserAccount | null
): AsyncGenerator<string, boolean, unknown> {
  const originalModel = payload.model;
  const msgId = `msg_${Date.now()}`;

  const directResult = await forwardAnthropicMessageToProvider1(payload, preferredKey, user);
  if (directResult) {
    const inputTokens = directResult.usage?.input_tokens || 20;
    const outputTokens = directResult.usage?.output_tokens || 20;

    let thinkingText = '';
    let responseText = '';

    for (const block of directResult.content) {
      if (block.type === 'thinking' && 'thinking' in block && typeof (block as any).thinking === 'string') {
        thinkingText = (block as any).thinking;
      } else if (block.type === 'text' && 'text' in block && typeof (block as any).text === 'string') {
        responseText = (block as any).text;
      }
    }

    // message_start
    yield `event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        model: originalModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 1 },
      },
    })}\n\n`;

    let blockIndex = 0;

    // 1. Thinking block stream if thinking text exists
    if (thinkingText) {
      yield `event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'thinking', thinking: '' },
      })}\n\n`;

      const tWords = thinkingText.split(' ');
      for (let i = 0; i < tWords.length; i++) {
        const chunkWord = (i === 0 ? '' : ' ') + tWords[i];
        yield `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'thinking_delta', thinking: chunkWord },
        })}\n\n`;
        await new Promise((r) => setTimeout(r, 10));
      }

      yield `event: content_block_stop\ndata: ${JSON.stringify({
        type: 'content_block_stop',
        index: blockIndex,
      })}\n\n`;

      blockIndex++;
    }

    // 2. Text block stream
    yield `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'text', text: '' },
    })}\n\n`;

    const rWords = responseText.split(' ');
    for (let i = 0; i < rWords.length; i++) {
      const chunkWord = (i === 0 ? '' : ' ') + rWords[i];
      yield `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text: chunkWord },
      })}\n\n`;
      await new Promise((r) => setTimeout(r, 10));
    }

    yield `event: content_block_stop\ndata: ${JSON.stringify({
      type: 'content_block_stop',
      index: blockIndex,
    })}\n\n`;

    // message_delta
    yield `event: message_delta\ndata: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    })}\n\n`;

    // message_stop
    yield `event: message_stop\ndata: ${JSON.stringify({
      type: 'message_stop',
    })}\n\n`;

    return true;
  }

  return false;
}

/**
 * 5. Fetch Models list dynamically from Provider-1
 */
export async function fetchProvider1Models(): Promise<ModelObject[]> {
  const baseUrl = getProvider1BaseUrl();
  const candidateKeys = getCandidateKeys();

  for (const apiKey of candidateKeys) {
    try {
      const targetUrl = `${baseUrl}/models`;
      const response = await fetch(targetUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result && Array.isArray(result.data)) {
          return result.data as ModelObject[];
        }
      }
    } catch (err) {
      console.warn('[Provider-1] Could not fetch models list:', err);
    }
  }

  return [];
}
