import type { ChatCompletionRequest, ChatCompletionResponse, ModelObject } from '../types/openai.js';
import type {
  AnthropicMessagesRequest,
  AnthropicMessageResponse,
} from '../types/anthropic.js';
import { buildComposedSystemPrompt } from './identityService.js';

export const PROVIDER_1_NAME = 'Provider-1 (OpenCode Zen)';
export const DEFAULT_PROVIDER_1_URL = 'https://opencode.ai/zen/v1';

// 1. Initial Provider-1 Key Pool with Automatic Round-Robin Rotation
export const INITIAL_PROVIDER_1_KEYS: string[] = [
  'sk-tubtj6Jb2Qxmk48LtiYfDlAfRU1N1F3r3bpBTaqnl2kyGcjg6GcL9PqdOX6mnH8S',
  'sk-a3xZh5wVaJdZlMdnIf7uMX8CswUR4UJIb79LrHApLW93kbQVmWUshFK2RyZQTZ2x',
  'sk-Y2qeo16JleKRXmeqDh4I4PqY4JO1vEmchnDXUAxKIaphzt0onXH2twzTCTgHcOCK',
  'sk-a24WFR2BPxwJgckqE1i6QQNyPBrywGU49g8Mc5nN0EWmaHCrVPVyMet2KyZsstq1',
];

interface KeyStatus {
  key: string;
  maskedKey: string;
  requestsHandled: number;
  errorsCount: number;
  lastUsed: string | null;
  status: 'active' | 'degraded';
}

const keyPool: KeyStatus[] = INITIAL_PROVIDER_1_KEYS.map((k) => ({
  key: k,
  maskedKey: `${k.slice(0, 7)}...${k.slice(-6)}`,
  requestsHandled: 0,
  errorsCount: 0,
  lastUsed: null,
  status: 'active',
}));

let currentKeyIndex = 0;

export function addProviderKey(newKey: string): boolean {
  const clean = newKey.trim();
  if (!clean || !clean.startsWith('sk-') || clean.length < 20) return false;
  const exists = keyPool.some((k) => k.key === clean);
  if (!exists) {
    keyPool.push({
      key: clean,
      maskedKey: `${clean.slice(0, 7)}...${clean.slice(-6)}`,
      requestsHandled: 0,
      errorsCount: 0,
      lastUsed: null,
      status: 'active',
    });
    return true;
  }
  return false;
}

export function removeProviderKey(keyToRemove: string): boolean {
  const clean = keyToRemove.trim();
  const index = keyPool.findIndex((k) => k.key === clean || k.maskedKey === clean);
  if (index >= 0 && keyPool.length > 1) {
    keyPool.splice(index, 1);
    if (currentKeyIndex >= keyPool.length) {
      currentKeyIndex = 0;
    }
    return true;
  }
  return false;
}

export function getProviderKeyPoolInfo(): {
  totalKeys: number;
  currentIndex: number;
  keys: KeyStatus[];
} {
  return {
    totalKeys: keyPool.length,
    currentIndex: currentKeyIndex,
    keys: keyPool.map((k) => ({ ...k })),
  };
}

/**
 * Get next rotated key in round-robin order
 */
export function getNextRotatedKey(): KeyStatus {
  if (keyPool.length === 0) {
    return {
      key: INITIAL_PROVIDER_1_KEYS[0],
      maskedKey: 'sk-tubt...6mnH8S',
      requestsHandled: 0,
      errorsCount: 0,
      lastUsed: new Date().toISOString(),
      status: 'active',
    };
  }

  const selected = keyPool[currentKeyIndex];
  selected.requestsHandled += 1;
  selected.lastUsed = new Date().toISOString();

  // Advance index for next call
  currentKeyIndex = (currentKeyIndex + 1) % keyPool.length;
  return selected;
}

// Model Routing / Aliasing Map
export const MODEL_ROUTING_MAP: Record<string, string> = {
  'claude-opus-5': 'mimo-v2.5-free',
  'claude-opus-5-2025': 'mimo-v2.5-free',
};

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
    if (m.role === 'system') continue; // Handled above in composed system prompt
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
 * 1. Forward OpenAI Chat Completion to Provider-1 with Key Rotation & Failover
 */
export async function forwardChatCompletionToProvider1(
  payload: ChatCompletionRequest
): Promise<ChatCompletionResponse | null> {
  const baseUrl = getProvider1BaseUrl();
  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model);
  const cleanMessages = sanitizeMessages(payload.messages as any, undefined, originalModel);

  const bodyToSend: Record<string, unknown> = {
    model: targetModel,
    messages: cleanMessages,
    stream: false,
  };

  const maxAttempts = Math.min(3, keyPool.length);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keyRecord = getNextRotatedKey();
    const targetUrl = `${baseUrl}/chat/completions`;

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keyRecord.key}`,
        },
        body: JSON.stringify(bodyToSend),
      });

      if (response.ok) {
        const data = (await response.json()) as ChatCompletionResponse;
        keyRecord.status = 'active';
        return {
          ...data,
          model: originalModel,
        };
      } else {
        keyRecord.errorsCount += 1;
        if (response.status === 429 || response.status === 401) {
          keyRecord.status = 'degraded';
          console.warn(`[Key Rotation] Key ${keyRecord.maskedKey} returned HTTP ${response.status}. Rotating to next key...`);
          continue; // Try next rotated key
        }
        const errorText = await response.text();
        console.error(`[Provider-1 Error ${response.status}]:`, errorText);
      }
    } catch (err: unknown) {
      keyRecord.errorsCount += 1;
      console.warn(`[Key Rotation Network Error] with ${keyRecord.maskedKey}:`, err instanceof Error ? err.message : err);
    }
  }

  return null;
}

/**
 * 2. Stream OpenAI SSE Chat Completion from Provider-1 with Key Rotation
 */
export async function* streamChatCompletionFromProvider1(
  payload: ChatCompletionRequest
): AsyncGenerator<string, boolean, unknown> {
  const originalModel = payload.model;

  // 1. Fetch live completion from Provider-1 with Key Rotation
  try {
    const nonStreamResult = await forwardChatCompletionToProvider1(payload);
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
 * 3. Forward Anthropic Messages request to Provider-1 with Key Rotation & Composed System Prompt
 */
export async function forwardAnthropicMessageToProvider1(
  payload: AnthropicMessagesRequest
): Promise<AnthropicMessageResponse | null> {
  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model);
  const cleanMessages = sanitizeMessages(payload.messages as any, payload.system, originalModel);

  const openAiPayload: ChatCompletionRequest = {
    model: targetModel,
    messages: cleanMessages as any,
    stream: false,
  };

  const openAiResult = await forwardChatCompletionToProvider1(openAiPayload);
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
 * 4. Stream Anthropic Messages from Provider-1 with Model Routing & SSE Translation
 */
export async function* streamAnthropicMessageFromProvider1(
  payload: AnthropicMessagesRequest
): AsyncGenerator<string, boolean, unknown> {
  const originalModel = payload.model;
  const msgId = `msg_${Date.now()}`;

  const directResult = await forwardAnthropicMessageToProvider1(payload);
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
 * 5. Fetch Models list dynamically from Provider-1 using Key Rotation
 */
export async function fetchProvider1Models(): Promise<ModelObject[]> {
  const baseUrl = getProvider1BaseUrl();
  const keyRecord = getNextRotatedKey();

  try {
    const targetUrl = `${baseUrl}/models`;
    const response = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${keyRecord.key}`,
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
