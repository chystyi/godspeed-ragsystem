/** The same limit as the server's; checking here saves a pointless upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Why a file cannot be uploaded, or null. The server checks again, by content. */
export function checkUpload(file: File): string | null {
  if (!/\.(txt|pdf)$/i.test(file.name)) return "Only .txt or .pdf files can be uploaded.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "This file is larger than 5 MB.";
  return null;
}
