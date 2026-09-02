"use client";

import { createContext, useContext, useEffect } from "react";
import { translateMessage } from "@/lib/i18n/format";
import { enMessages } from "@/lib/i18n/messages/en";
import type { TranslationParams } from "@/lib/i18n/types";

const LOCALE_STORAGE_KEY = "pi-locale";

interface I18nContextValue {
  t: (key: string, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const contextValue: I18nContextValue = {
  t: (key, params) => translateMessage(key, enMessages, params),
};

/** Provides Pi Web's English message lookup and interpolation. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }, []);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

/** Returns the English message formatter for the current component tree. */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
