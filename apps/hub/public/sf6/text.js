/** Textareas normalize CRLF in the DOM; preserve the original raw value until it is edited. */
export function readSf6TextValue(raw, original, preserveWhitespace = false) {
  if (!raw.trim()) return null;
  if (!preserveWhitespace) return raw.trim();
  return typeof original === "string" && raw === original.replace(/\r\n?/g, "\n") ? original : raw;
}
