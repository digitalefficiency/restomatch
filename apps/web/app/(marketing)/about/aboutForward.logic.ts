/**
 * W3-06b split /about → /about (story) + /product (problem in ₪, features,
 * calculator, trust). Old deep links /about#problem|#features|#roi|#trust (in
 * decks, DEMO-PACK, shared messages) must still land on the section (Q5).
 */
export const MOVED_ABOUT_HASHES = ['#problem', '#features', '#roi', '#trust'] as const;

/** Where an /about visit with this hash belongs, or null (stay on /about). */
export function movedAboutTarget(hash: string, search = ''): string | null {
  return (MOVED_ABOUT_HASHES as readonly string[]).includes(hash) ? `/product${search}${hash}` : null;
}
