import crypto from 'crypto';
import type {
  AnthropicMessagesRequest,
  AnthropicMessageResponse,
  AnthropicMessageStartEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStopEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStopEvent,
  AnthropicMessage,
} from '../types/anthropic.js';
import { applyIdentityToAnthropicSystem } from './identityService.js';
import {
  forwardAnthropicMessageToProvider1,
  streamAnthropicMessageFromProvider1,
} from './providerService.js';
import { getUserByApiKeyFromDb } from './dbUserStore.js';

export function generateAnthropicMsgId(): string {
  return `msg_${crypto.randomBytes(16).toString('hex')}`;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function extractLastUserMessage(messages: AnthropicMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        return msg.content
          .map((c) => (typeof c === 'string' ? c : 'text' in c && typeof c.text === 'string' ? c.text : ''))
          .join(' ');
      }
    }
  }
  return '';
}

function generateAnthropicReply(
  messages: AnthropicMessage[],
  _model: string,
  _composedSystem: string
): string {
  const lastUser = extractLastUserMessage(messages).trim();
  if (!lastUser) {
    return 'Hello! How can I assist you today?';
  }
  return `I have processed your query: "${lastUser}". How else can I assist you?`;
}

/**
 * Handle non-streaming Anthropic Message creation
 */
export async function createAnthropicMessage(
  req: AnthropicMessagesRequest,
  _apiKey?: string,
  _anthropicVersion?: string
): Promise<AnthropicMessageResponse> {
  const model = req.model || 'claude-3-5-sonnet-20241022';
  const id = generateAnthropicMsgId();

  // Apply identity service: Our system prompt + User system prompt
  const composedSystem = applyIdentityToAnthropicSystem(model, req.system);
  const finalReq: AnthropicMessagesRequest = {
    ...req,
    system: composedSystem,
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
    const provider1Result = await forwardAnthropicMessageToProvider1(finalReq, preferredKey);
    if (provider1Result) {
      return provider1Result;
    }
  } catch (err) {
    console.warn('[Anthropic Engine] Provider-1 dispatch failed:', err);
  }

  // 2. Generate with local engine fallback
  const replyText = generateAnthropicReply(req.messages, model, composedSystem);

  const inputTokens = req.messages.reduce((acc, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return acc + estimateTokens(text);
  }, 0) + estimateTokens(composedSystem);
  const outputTokens = estimateTokens(replyText);

  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: [
      {
        type: 'text',
        text: replyText,
      },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

/**
 * Handle streaming SSE Anthropic Message
 */
export async function* streamAnthropicMessage(
  req: AnthropicMessagesRequest,
  _apiKey?: string,
  _anthropicVersion?: string
): AsyncGenerator<string, void, unknown> {
  const model = req.model || 'claude-3-5-sonnet-20241022';
  const id = generateAnthropicMsgId();

  // Apply identity service: Our system prompt + User system prompt
  const composedSystem = applyIdentityToAnthropicSystem(model, req.system);
  const finalReq: AnthropicMessagesRequest = {
    ...req,
    system: composedSystem,
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
    const provider1Stream = streamAnthropicMessageFromProvider1(finalReq, preferredKey);
    for await (const chunk of provider1Stream) {
      streamedSuccessfully = true;
      yield chunk;
    }
    if (streamedSuccessfully) {
      return;
    }
  } catch (err) {
    console.warn('[Anthropic Engine] Provider-1 stream failed, using fallback generator:', err);
  }

  // 2. Local streaming engine fallback
  const replyText = generateAnthropicReply(req.messages, model, composedSystem);
  const inputTokens = req.messages.reduce((acc, m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return acc + estimateTokens(text);
  }, 0) + estimateTokens(composedSystem);
  const outputTokens = estimateTokens(replyText);

  // message_start event
  const messageStart: AnthropicMessageStartEvent = {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 1,
      },
    },
  };
  yield `event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`;

  // content_block_start event
  const contentBlockStart: AnthropicContentBlockStartEvent = {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'text',
      text: '',
    },
  };
  yield `event: content_block_start\ndata: ${JSON.stringify(contentBlockStart)}\n\n`;

  // stream words with content_block_delta
  const words = replyText.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunkWord = (i === 0 ? '' : ' ') + words[i];
    const blockDelta: AnthropicContentBlockDeltaEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: chunkWord,
      },
    };
    yield `event: content_block_delta\ndata: ${JSON.stringify(blockDelta)}\n\n`;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  // content_block_stop event
  const contentBlockStop: AnthropicContentBlockStopEvent = {
    type: 'content_block_stop',
    index: 0,
  };
  yield `event: content_block_stop\ndata: ${JSON.stringify(contentBlockStop)}\n\n`;

  // message_delta event
  const messageDelta: AnthropicMessageDeltaEvent = {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn',
      stop_sequence: null,
    },
    usage: {
      output_tokens: outputTokens,
    },
  };
  yield `event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`;

  // message_stop event
  const messageStop: AnthropicMessageStopEvent = {
    type: 'message_stop',
  };
  yield `event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`;
}
