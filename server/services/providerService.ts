import dotenv from 'dotenv';
dotenv.config();

import type { ChatCompletionRequest, ChatCompletionResponse, ModelObject } from '../types/openai.js';
import type {
  AnthropicMessagesRequest,
  AnthropicMessageResponse,
} from '../types/anthropic.js';
import { buildComposedSystemPrompt } from './identityService.js';

export const PROVIDER_1_NAME = 'Provider-1 (OpenCode Zen)';
export const DEFAULT_PROVIDER_1_URL = 'https://opencode.ai/zen/v1';
export const DEFAULT_PROVIDER_1_KEY =
  process.env.PROVIDER_1_API_KEY ||
  process.env.OPENAI_API_KEY ||
  'sk-tubtj6Jb2Qxmk48LtiYfDlAfRU1N1F3r3bpBTaqnl2kyGcjg6GcL9PqdOX6mnH8S';

// Model Routing / Aliasing Map -> mimo-v2.5-free
export const MODEL_ROUTING_MAP: Record<string, string> = {
  'claude-opus-5': 'mimo-v2.5-free',
  'claude-opus-5-2025': 'mimo-v2.5-free',
  'deepseek-v4-flash': 'mimo-v2.5-free',
  'deepseek-v4-flash-free': 'mimo-v2.5-free',
  'deepseek-chat': 'mimo-v2.5-free',
  'deepseek-reasoner': 'mimo-v2.5-free',
  'deepseek-r1': 'mimo-v2.5-free',
  'deepseek-v3': 'mimo-v2.5-free',
};

// Model Fallback Map: If primary model is down or unavailable upstream, fallback automatically
export const MODEL_FALLBACK_MAP: Record<string, string> = {
  'deepseek-v4-flash': 'mimo-v2.5-free',
  'deepseek-v4-flash-free': 'mimo-v2.5-free',
  'deepseek-chat': 'mimo-v2.5-free',
  'deepseek-reasoner': 'mimo-v2.5-free',
  'deepseek-r1': 'mimo-v2.5-free',
  'deepseek-v3': 'mimo-v2.5-free',
};

export function getFallbackModel(modelName: string): string | null {
  const norm = (modelName || '').toLowerCase().trim();
  return MODEL_FALLBACK_MAP[norm] || null;
}

/**
 * Resolve target model according to routing rules
 * e.g. claude-opus-5 -> mimo-v2.5-free
 */
export function resolveRoutedModel(requestedModel: string): string {
  const normalized = (requestedModel || '').toLowerCase().trim();
  return MODEL_ROUTING_MAP[normalized] || requestedModel;
}

export function getProvider1BaseUrl(): string {
  return (process.env.PROVIDER_1_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_PROVIDER_1_URL).replace(/\/+$/, '');
}

/**
 * Get active API key: Dedicated key if assigned, otherwise server default
 */
export function getProvider1ApiKey(preferredKey?: string): string {
  if (preferredKey && preferredKey.trim().startsWith('sk-')) {
    return preferredKey.trim();
  }
  return process.env.PROVIDER_1_API_KEY || process.env.OPENAI_API_KEY || DEFAULT_PROVIDER_1_KEY;
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
 * Dispatch chat completion to Provider-1 with dedicated key or server default key
 */
async function attemptProvider1Completion(
  targetModel: string,
  messages: Array<{ role: string; content: string }>,
  preferredKey?: string
): Promise<ChatCompletionResponse | null> {
  const baseUrl = getProvider1BaseUrl();
  const apiKey = getProvider1ApiKey(preferredKey);
  const bodyToSend: Record<string, unknown> = {
    model: targetModel,
    messages,
    stream: false,
  };

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
    } else {
      const errorText = await response.text();
      console.warn(`[Provider-1 ${targetModel} Error ${response.status}]:`, errorText);
    }
  } catch (err: unknown) {
    console.warn(`[Provider-1 Network Error for ${targetModel}]:`, err instanceof Error ? err.message : err);
  }

  return null;
}

/**
 * 1. Forward OpenAI Chat Completion to Provider-1 with Dedicated Key and Automated Model Fallback
 */
export async function forwardChatCompletionToProvider1(
  payload: ChatCompletionRequest,
  preferredKey?: string
): Promise<ChatCompletionResponse | null> {
  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model);
  const cleanMessages = sanitizeMessages(payload.messages as any, undefined, originalModel);

  // 1. Initial attempt with target model
  let result = await attemptProvider1Completion(targetModel, cleanMessages, preferredKey);

  // 2. If target model failed (e.g. deepseek-v4-flash unavailable), fallback to mimo-v2.5-free automatically
  if (!result) {
    const fallbackModel = getFallbackModel(targetModel) || getFallbackModel(originalModel);
    if (fallbackModel && fallbackModel !== targetModel) {
      console.log(`[Model Fallback] Model '${targetModel}' is unavailable upstream. Automatically falling back to '${fallbackModel}'...`);
      result = await attemptProvider1Completion(fallbackModel, cleanMessages, preferredKey);
    }
  }

  if (result) {
    return {
      ...result,
      model: originalModel,
    };
  }

  return null;
}

/**
 * 2. Stream OpenAI SSE Chat Completion from Provider-1 with Dedicated Key and Automated Fallback
 */
export async function* streamChatCompletionFromProvider1(
  payload: ChatCompletionRequest,
  preferredKey?: string
): AsyncGenerator<string, boolean, unknown> {
  const originalModel = payload.model;

  // 1. Fetch live completion from Provider-1 with automated fallback
  try {
    const nonStreamResult = await forwardChatCompletionToProvider1(payload, preferredKey);
    if (nonStreamResult) {
      const content = nonStreamResult.choices?.[0]?.message?.content || '';
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

      // Word-by-word real-time streaming
      const words = content.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunkWord = (i === 0 ? '' : ' ') + words[i];
        yield `data: ${JSON.stringify({
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: originalModel,
          choices: [{ index: 0, delta: { content: chunkWord }, finish_reason: null }],
        })}\n\n`;
        await new Promise((r) => setTimeout(r, 15));
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
 * 3. Forward Anthropic Messages request to Provider-1 with Dedicated Key
 */
export async function forwardAnthropicMessageToProvider1(
  payload: AnthropicMessagesRequest,
  preferredKey?: string
): Promise<AnthropicMessageResponse | null> {
  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model);
  const cleanMessages = sanitizeMessages(payload.messages as any, payload.system, originalModel);

  const openAiPayload: ChatCompletionRequest = {
    model: targetModel,
    messages: cleanMessages as any,
    stream: false,
  };

  const openAiResult = await forwardChatCompletionToProvider1(openAiPayload, preferredKey);
  if (openAiResult) {
    const reply = openAiResult.choices?.[0]?.message?.content || '';
    return {
      id: `msg_${(openAiResult.id || '').replace(/^chatcmpl-/, '')}`,
      type: 'message',
      role: 'assistant',
      model: originalModel,
      content: [{ type: 'text', text: reply }],
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
 * 4. Stream Anthropic Messages from Provider-1 with Dedicated Key & Model Routing
 */
export async function* streamAnthropicMessageFromProvider1(
  payload: AnthropicMessagesRequest,
  preferredKey?: string
): AsyncGenerator<string, boolean, unknown> {
  const originalModel = payload.model;
  const msgId = `msg_${Date.now()}`;

  const directResult = await forwardAnthropicMessageToProvider1(payload, preferredKey);
  if (directResult) {
    const textContent = directResult.content?.[0]?.text || '';
    const inputTokens = directResult.usage?.input_tokens || 20;
    const outputTokens = directResult.usage?.output_tokens || 20;

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

    // content_block_start
    yield `event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })}\n\n`;

    // stream words
    const words = textContent.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunkWord = (i === 0 ? '' : ' ') + words[i];
      yield `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: chunkWord },
      })}\n\n`;
      await new Promise((r) => setTimeout(r, 15));
    }

    // content_block_stop
    yield `event: content_block_stop\ndata: ${JSON.stringify({
      type: 'content_block_stop',
      index: 0,
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
  const apiKey = getProvider1ApiKey();

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

  return [];
}
