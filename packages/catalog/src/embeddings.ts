import type { EmbeddingProvider } from './types';

/**
 * Deterministic mock embedding provider for tests and dev.
 *
 * Strategy: tokenize text into bigrams (character pairs), each bigram contributes
 * to a stable dim via a fast string hash. Result is L2-normalized so cosine
 * similarity behaves correctly.
 *
 * Result: similar strings → similar vectors. "tomato" and "tomatoes" share
 * most bigrams and thus produce vectors with high cosine similarity.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'mock-bigram';
  readonly dimensions: number;

  constructor(dimensions = 1536) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const vec = new Array(this.dimensions).fill(0);
    const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
    if (normalized.length === 0) return vec;

    // Use character bigrams + single chars for short strings
    const tokens: string[] = [];
    for (let i = 0; i < normalized.length; i += 1) {
      tokens.push(normalized[i]!);
      if (i < normalized.length - 1) {
        tokens.push(normalized.slice(i, i + 2));
      }
    }

    for (const tok of tokens) {
      const dim = hashToIndex(tok, this.dimensions);
      vec[dim] += 1;
    }

    // L2-normalize so cosine similarity = dot product
    let magSq = 0;
    for (const v of vec) magSq += v * v;
    const mag = Math.sqrt(magSq);
    if (mag === 0) return vec;
    for (let i = 0; i < vec.length; i += 1) {
      vec[i] /= mag;
    }
    return vec;
  }
}

function hashToIndex(s: string, mod: number): number {
  // FNV-1a style hash, fast and good distribution
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) * (a[i] ?? 0);
    magB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
