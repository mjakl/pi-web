/**
 * Opaque client-generated id.
 *
 * crypto.randomUUID() needs a secure context, which `npm run dev:lan` over a
 * LAN address is not, so the fallback is load-bearing rather than defensive.
 */
export function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
