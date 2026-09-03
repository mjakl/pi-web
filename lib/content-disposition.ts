function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Build a Content-Disposition header that carries the exact file name through
 * RFC 5987 `filename*` and an ASCII-only `filename` fallback for clients that
 * ignore it. `fallbackName` is used when nothing printable survives.
 */
export function contentDisposition(
  type: "inline" | "attachment",
  fileName: string,
  fallbackName: string,
): string {
  const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || fallbackName;
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(fileName)}`;
}
