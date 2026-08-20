import type { ChatCompletionRequest, ChatCompletionResponse, ModelObject } from '../types/openai.js';
import type {
  AnthropicMessagesRequest,
  AnthropicMessageResponse,
} from '../types/anthropic.js';

export const PROVIDER_1_NAME = 'Provider-1 (OpenCode Zen)';
export const DEFAULT_PROVIDER_1_URL = 'https://opencode.ai/zen/v1';
export const DEFAULT_PROVIDER_1_KEY = 'sk-tubtj6Jb2Qxmk48LtiYfDlAfRU1N1F3r3bpBTaqnl2kyGcjg6GcL9PqdOX6mnH8S';

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

export function getProvider1ApiKey(): string {
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
 * Build sanitized OpenAI messages list from any format (Cline, Claude, OpenAI)
 */
export function sanitizeMessages(
  messages: Array<{ role: string; content: unknown }>,
  systemPrompt?: unknown
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];

  const cleanSystem = extractCleanText(systemPrompt).trim();
  if (cleanSystem) {
    result.push({ role: 'system', content: cleanSystem });
  }

  for (const m of messages || []) {
    const text = extractCleanText(m.content).trim();
    if (text) {
      result.push({
        role: m.role || 'user',
        content: text,
      });
    }
  }

  // Ensure at least one user message exists
  if (result.length === 0) {
    result.push({ role: 'user', content: 'Hello' });
  }

  return result;
}

/**
 * 1. Forward OpenAI Chat Completion to Provider-1 with Model Routing
 */
export async function forwardChatCompletionToProvider1(
  payload: ChatCompletionRequest
): Promise<ChatCompletionResponse | null> {
  const baseUrl = getProvider1BaseUrl();
  const apiKey = getProvider1ApiKey();

  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model);
  const cleanMessages = sanitizeMessages(payload.messages as any);

  const bodyToSend: Record<string, unknown> = {
    model: targetModel,
    messages: cleanMessages,
    stream: false,
  };

  try {
    const targetUrl = `${baseUrl}/chat/completions`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(bodyToSend),
    });

    if (response.ok) {
      const data = (await response.json()) as ChatCompletionResponse;
      return {
        ...data,
        model: originalModel,
      };
    } else {
      const errorText = await response.text();
      console.error(`[Provider-1 Error ${response.status}] from ${targetUrl}:`, errorText);
      return null;
    }
  } catch (err: unknown) {
    console.error('[Provider-1 Network Error]:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 2. Stream OpenAI SSE Chat Completion from Provider-1 with Model Routing
 */
export async function* streamChatCompletionFromProvider1(
  payload: ChatCompletionRequest
): AsyncGenerator<string, boolean, unknown> {
  const baseUrl = getProvider1BaseUrl();
  const apiKey = getProvider1ApiKey();

  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model);
  const cleanMessages = sanitizeMessages(payload.messages as any);

  // 1. Try real-time upstream SSE streaming
  try {
    const targetUrl = `${baseUrl}/chat/completions`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages: cleanMessages,
        stream: true,
      }),
    });

    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let hasReceived = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hasReceived = true;
        yield decoder.decode(value, { stream: true });
      }
      if (hasReceived) {
        return true;
      }
    }
  } catch {
    // upstream stream fallback
  }

  // 2. Fetch live completion and stream chunks smoothly
  try {
    const nonStreamResult = await forwardChatCompletionToProvider1(payload);
    if (nonStreamResult) {
      const content = nonStreamResult.choices?.[0]?.message?.content || '';
      const completionId = nonStreamResult.id || `chatcmpl-${Date.now()}`;
      const created = nonStreamResult.created || Math.floor(Date.now() / 1000);

      // Initial chunk
      yield `data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: originalModel,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      })}\n\n`;

      // Word-by-word streaming
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
    console.error('[Provider-1 Stream dispatch failed]:', err);
  }

  return false;
}

/**
 * 3. Forward Anthropic Messages request to Provider-1 with Model Routing
 */
export async function forwardAnthropicMessageToProvider1(
  payload: AnthropicMessagesRequest
): Promise<AnthropicMessageResponse | null> {
  const originalModel = payload.model;
  const targetModel = resolveRoutedModel(payload.model);
  const cleanMessages = sanitizeMessages(payload.messages as any, payload.system);

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
        input_tokens: openAiResult.usage?.prompt_tokens || 0,
        output_tokens: openAiResult.usage?.completion_tokens || 0,
      },
    };
  }

  return null;
}

/**
 * 4. Stream Anthropic Messages from Provider-1 with Model Routing
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
