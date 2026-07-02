import type { EntityHandler } from './types.js';
import type { SupportedLanguage } from '../types.js';
import { tsHandlers } from './ts-visitor.js';

const registry: Record<SupportedLanguage, Record<string, EntityHandler>> = {
  typescript: tsHandlers,
  javascript: tsHandlers,
  tsx: tsHandlers,
};

export function getHandlers(language: SupportedLanguage): Record<string, EntityHandler> {
  const handlers = registry[language];
  if (!handlers) throw new Error(`No entity handlers registered for language "${language}"`);
  return handlers;
}
