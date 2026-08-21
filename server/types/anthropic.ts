export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicThinkingBlock | AnthropicImageBlock | { type: string; [key: string]: unknown };

export interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  max_tokens?: number;
  metadata?: {
    user_id?: string;
  };
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: unknown[];
  tool_choice?: unknown;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: (AnthropicTextBlock | AnthropicThinkingBlock | { type: string; [key: string]: unknown })[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

// SSE Event types
export interface AnthropicMessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: unknown[];
    stop_reason: null;
    stop_sequence: null;
    usage: AnthropicUsage;
  };
}

export interface AnthropicContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text';
    text: string;
  };
}

export interface AnthropicContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

export interface AnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface AnthropicMessageStopEvent {
  type: 'message_stop';
}
