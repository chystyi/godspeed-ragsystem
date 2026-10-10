import { createHash } from 'node:crypto';

/**
 * Fingerprint of the exact text an indexing run saw: sha256 (hex) of title, U+0001, content.
 * The database computes the same value for the current document and refuses a result whose
 * fingerprint no longer matches, so an older run can never overwrite newer text.
 */
export function documentDigest(title: string, content: string): string {
  return createHash('sha256').update(`${title}\u0001${content}`, 'utf8').digest('hex');
}
