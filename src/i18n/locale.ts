/** Presentation-only localization; simulation data and identifiers never depend on language. */
export type Language = 'zh' | 'en';

export const DEFAULT_LANGUAGE: Language = 'zh';

export const isLanguage = (value: unknown): value is Language => value === 'zh' || value === 'en';

export type Translator = (chinese: string, english: string) => string;

const TRANSLATORS: Record<Language, Translator> = {
  zh: (chinese) => chinese,
  en: (_chinese, english) => english,
};

/** Stable functions also make this safe in effect and memo dependencies. */
export const createTranslator = (language: Language): Translator => TRANSLATORS[language];
