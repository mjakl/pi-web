export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}
