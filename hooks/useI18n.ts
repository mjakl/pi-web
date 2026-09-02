import { translateMessage, type TranslationParams } from "@/lib/i18n/format";

const i18n = {
  t: (key: string, params?: TranslationParams): string => translateMessage(key, params),
};

/** Returns Pi Web's English message formatter. */
export function useI18n() {
  return i18n;
}
