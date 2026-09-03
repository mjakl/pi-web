/**
 * Message for a caught value. Coercion only -- callers that suppress
 * AbortError do so with their own control flow, because what they do next
 * differs (some return early, some leave the previous state alone).
 */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
