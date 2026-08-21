import type { ChatMessage } from '../types/openai.js';

export interface ModelIdentity {
  family: 'claude' | 'gpt' | 'intelligence-evolution' | 'default';
  name: string;
  systemPrompt: string;
}

// 1. Specialized System Prompt Templates (~50 tokens)
export const CLAUDE_IDENTITY_PROMPT = `You are Claude Opus 5, Anthropic's most advanced flagship reasoning artificial intelligence model. You provide deep, nuanced, highly accurate, and rigorous solutions across engineering, architecture, and coding tasks with exceptional depth and clarity.`;

export const GPT_IDENTITY_PROMPT = `You are a helpful and intelligent AI assistant.
You are concise, direct, highly analytical, and focused on delivering accurate solutions, clean code architectures, and structured insights.`;

export const INTELLIGENCE_EVOLUTION_IDENTITY_PROMPT = `You are the Intelligence Evolution Platform Core AI (intelligence-evolution-v1).
You represent an advanced autonomous reasoning engine designed to evolve, synthesize complex engineering challenges, enforce best architectural practices, and provide production-grade answers across full-stack distributed systems.`;

export const DEFAULT_IDENTITY_PROMPT = `You are a helpful and intelligent AI assistant.
You provide precise, reliable, and well-structured assistance for engineering, development, and reasoning tasks.`;

/**
 * Determine model family and retrieve its specific identity prompt
 */
export function getIdentityForModel(modelName: string): ModelIdentity {
  const normalized = (modelName || '').toLowerCase().trim();

  if (normalized.includes('claude')) {
    return {
      family: 'claude',
      name: 'Anthropic Claude Identity',
      systemPrompt: CLAUDE_IDENTITY_PROMPT,
    };
  }

  if (normalized.includes('gpt') || normalized.includes('openai') || normalized.includes('o1') || normalized.includes('o3')) {
    return {
      family: 'gpt',
      name: 'OpenAI GPT Identity',
      systemPrompt: GPT_IDENTITY_PROMPT,
    };
  }

  if (normalized.includes('intelligence') || normalized.includes('evolution') || normalized.includes('custom')) {
    return {
      family: 'intelligence-evolution',
      name: 'Intelligence Evolution Core Identity',
      systemPrompt: INTELLIGENCE_EVOLUTION_IDENTITY_PROMPT,
    };
  }

  return {
    family: 'default',
    name: 'Standard AI Identity',
    systemPrompt: DEFAULT_IDENTITY_PROMPT,
  };
}

/**
 * Compose platform system prompt + user custom system prompt
 * Format: Our System Prompt + User System Prompt
 */
export function buildComposedSystemPrompt(
  modelName: string,
  userSystemPrompt?: string | Array<{ type?: string; text?: string }>
): string {
  const identity = getIdentityForModel(modelName);
  const basePrompt = identity.systemPrompt.trim();

  let userText = '';
  if (typeof userSystemPrompt === 'string') {
    userText = userSystemPrompt.trim();
  } else if (Array.isArray(userSystemPrompt)) {
    userText = userSystemPrompt
      .map((block) => (typeof block === 'string' ? block : block.text || ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  // If user provided a system prompt, cleanly combine: Our system prompt + User system prompt
  if (userText && userText !== basePrompt) {
    return `${basePrompt}\n\n${userText}`;
  }

  return basePrompt;
}

/**
 * Amend OpenAI messages array with composed identity system prompt
 */
export function applyIdentityToOpenAiMessages(
  messages: ChatMessage[],
  modelName: string
): ChatMessage[] {
  const cloned = [...messages];
  const systemIndex = cloned.findIndex((m) => m.role === 'system');

  if (systemIndex >= 0) {
    const existingContent = cloned[systemIndex].content;
    const userSystemText = typeof existingContent === 'string' ? existingContent : JSON.stringify(existingContent);
    const composed = buildComposedSystemPrompt(modelName, userSystemText);
    cloned[systemIndex] = {
      ...cloned[systemIndex],
      content: composed,
    };
  } else {
    // No user system message was present: prepend our identity system prompt
    const composed = buildComposedSystemPrompt(modelName);
    cloned.unshift({
      role: 'system',
      content: composed,
    });
  }

  return cloned;
}

/**
 * Amend Anthropic request system prompt with composed identity system prompt
 */
export function applyIdentityToAnthropicSystem(
  modelName: string,
  userSystem?: string | Array<{ text: string }>
): string {
  return buildComposedSystemPrompt(modelName, userSystem);
}
