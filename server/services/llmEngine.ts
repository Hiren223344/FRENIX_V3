import crypto from 'crypto';
import type {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelObject,
} from '../types/openai.js';
import { applyIdentityToOpenAiMessages } from './identityService.js';
import {
  forwardChatCompletionToProvider1,
  streamChatCompletionFromProvider1,
} from './providerService.js';
import { getUserByApiKeyFromDb } from './dbUserStore.js';

export const SUPPORTED_MODELS: ModelObject[] = [
  { id: 'intelligence-evolution-v1', object: 'model', created: 1718000000, owned_by: 'intelligence-evolution' },
  { id: 'gpt-4o', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'gpt-4o-mini', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'gpt-4-turbo', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'gpt-3.5-turbo', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'claude-3-5-sonnet', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'claude-3-7-sonnet-20250219', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'claude-opus-5', object: 'model', created: 1718000000, owned_by: 'system' },
  { id: 'deepseek-v4-flash-free', object: 'model', created: 1718000000, owned_by: 'deepseek' },
  { id: 'mimo-v2.5-free', object: 'model', created: 1718000000, owned_by: 'mimo' },
];

function generateCompletionId(): string {
  return `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function extractLastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        return msg.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join(' ');
      }
    }
  }
  return '';
}

function generateLocalReply(messages: ChatMessage[], _model: string): string {
  const lastUser = extractLastUserMessage(messages).trim();
  if (!lastUser) {
    return 'Hello! How can I assist you today?';
  }
  return `I have received your request: "${lastUser}". How else can I assist you?`;
}

/**
 * Handle non-streaming completion
 */
export async function createChatCompletion(
  req: ChatCompletionRequest,
  _apiKey?: string
): Promise<ChatCompletionResponse> {
  const model = req.model || 'intelligence-evolution-v1';
  const id = generateCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const systemFingerprint = `fp_${crypto.randomBytes(4).toString('hex')}`;

  // Apply identity service to amend/prepend system prompt
  const finalMessages = applyIdentityToOpenAiMessages(req.messages, model);
  const finalReq: ChatCompletionRequest = {
    ...req,
    messages: finalMessages,
  };

  // 1. Dispatch to Provider-1 (OpenCode Zen Gateway) with Dedicated Key if PRO user
  try {
    let preferredKey: string | undefined;
    if (_apiKey && _apiKey.startsWith('sk-') && _apiKey.length > 40) {
      preferredKey = _apiKey;
    } else if (_apiKey) {
      const user = await getUserByApiKeyFromDb(_apiKey);
      preferredKey = user?.assignedProviderKey;
    }
    const provider1Result = await forwardChatCompletionToProvider1(finalReq, preferredKey);
    if (provider1Result) {
      return provider1Result;
    }
  } catch (err) {
    console.warn('[LLM Engine] Provider-1 call failed, attempting fallback:', err);
  }

  // 2. Generate with local engine fallback
  const reply = generateLocalReply(finalMessages, model);
  
  const promptTokens = finalMessages.reduce((acc, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return acc + estimateTokens(text);
  }, 0);
  const completionTokens = estimateTokens(reply);

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    system_fingerprint: systemFingerprint,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: reply,
        },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Handle streaming SSE chat completion
 */
export async function* streamChatCompletion(
  req: ChatCompletionRequest,
  _apiKey?: string
): AsyncGenerator<string, void, unknown> {
  const model = req.model || 'intelligence-evolution-v1';
  const id = generateCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const systemFingerprint = `fp_${crypto.randomBytes(4).toString('hex')}`;

  // Apply identity service to amend/prepend system prompt
  const finalMessages = applyIdentityToOpenAiMessages(req.messages, model);
  const finalReq: ChatCompletionRequest = {
    ...req,
    messages: finalMessages,
  };

  // 1. Attempt Streaming from Provider-1 with Dedicated Key if PRO user
  let streamedSuccessfully = false;
  try {
    let preferredKey: string | undefined;
    if (_apiKey && _apiKey.startsWith('sk-') && _apiKey.length > 40) {
      preferredKey = _apiKey;
    } else if (_apiKey) {
      const user = await getUserByApiKeyFromDb(_apiKey);
      preferredKey = user?.assignedProviderKey;
    }
    const provider1Stream = streamChatCompletionFromProvider1(finalReq, preferredKey);
    for await (const chunk of provider1Stream) {
      streamedSuccessfully = true;
      yield chunk;
    }
    if (streamedSuccessfully) {
      return;
    }
  } catch (err) {
    console.warn('[LLM Engine] Provider-1 streaming failed, using fallback generator:', err);
  }

  // 2. Local streaming engine fallback
  const fullText = generateLocalReply(finalMessages, model);

  // Initial chunk with role
  const initialChunk: ChatCompletionChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    system_fingerprint: systemFingerprint,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: '' },
        logprobs: null,
        finish_reason: null,
      },
    ],
  };
  yield `data: ${JSON.stringify(initialChunk)}\n\n`;

  // Stream content words / chunks
  const words = fullText.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunkWord = (i === 0 ? '' : ' ') + words[i];
    const chunk: ChatCompletionChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      system_fingerprint: systemFingerprint,
      choices: [
        {
          index: 0,
          delta: { content: chunkWord },
          logprobs: null,
          finish_reason: null,
        },
      ],
    };
    yield `data: ${JSON.stringify(chunk)}\n\n`;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  // Final chunk with finish_reason: 'stop'
  const finalChunk: ChatCompletionChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    system_fingerprint: systemFingerprint,
    choices: [
      {
        index: 0,
        delta: {},
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
  };
  yield `data: ${JSON.stringify(finalChunk)}\n\n`;
  yield `data: [DONE]\n\n`;
}
