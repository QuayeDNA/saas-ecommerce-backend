// src/utils/mtnSanitizer.js
// Small sanitizer utilities for MTN message fields.
// Removes non-ASCII characters and trims the result to avoid MTN rejections.

export default function sanitizeForMtn(input) {
  if (input == null) return input;
  const s = String(input);
  // Normalize to decompose combined characters, then strip non-printable/non-ASCII
  try {
    // Use NFKD to decompose characters with diacritics
    const normalized = s.normalize ? s.normalize("NFKD") : s;
    // Keep printable ASCII range (space 0x20 to tilde 0x7E)
    const cleaned = normalized.replace(/[^\x20-\x7E]/g, "");
    return cleaned.trim();
  } catch {
    // Fallback: remove characters outside basic ASCII range
    // Use Unicode escape ranges to avoid control-regex warnings
    return s.replace(/[^ -~]/g, "").trim();
  }
}
