"use client";

import { useEffect } from "react";

import { useI18n } from "@/hooks/useI18n";

/**
 * Root error boundary. Every panel renders inside the single AppShell, so
 * without this a render throw anywhere blanks the app including the sidebar
 * the user would need to navigate away from the broken session.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error("Pi Web render error:", error);
  }, [error]);

  return (
    <div className="app-error">
      <div className="app-error-panel">
        <h1 className="app-error-title">{t("error.boundaryTitle")}</h1>
        <p className="app-error-body">{t("error.boundaryBody")}</p>
        <pre className="app-error-detail">{error.message}</pre>
        <div className="app-error-actions">
          <button type="button" className="app-error-button" onClick={reset}>
            {t("error.tryAgain")}
          </button>
          <button
            type="button"
            className="app-error-button is-primary"
            onClick={() => window.location.reload()}
          >
            {t("error.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}
