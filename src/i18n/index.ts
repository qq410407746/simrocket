import { useGameStore } from '@/stores/gameStore';
import { createTranslator } from './locale';

/** Subscribe only to language, not high-frequency flight telemetry. */
export function useI18n() {
  const language = useGameStore((state) => state.language);
  return { language, t: createTranslator(language) };
}
