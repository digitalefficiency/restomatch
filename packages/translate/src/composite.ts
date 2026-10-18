import { ClaudeTranslator, type ClaudeTranslatorConfig } from './claudeTranslator';
import { ALL_GLOSSARY_ENTRIES } from './glossary';
import { GlossaryTranslator } from './glossaryTranslator';
import { hasHebrew } from './normalize';

export type TranslationSource = 'glossary' | 'claude' | 'passthrough';

export interface Translation {
  en: string;
  source: TranslationSource;
}

export interface CompositeTranslatorOptions {
  glossary?: GlossaryTranslator;
  /** null/undefined → glossary only (offline). */
  claude?: ClaudeTranslator | null;
  /** Called when the Claude leg fails; defaults to console.warn. */
  onClaudeError?: (err: unknown) => void;
  /** Clock seam for tests (ms). */
  now?: () => number;
}

export interface TranslateManyOptions {
  /** false = glossary only for this call (the caller's cost budget is spent). */
  allowClaude?: boolean;
}

/**
 * A name Claude was asked about but did not answer is not re-sent for this
 * long — receiving pages call ensureEnglish on every render, and without this
 * an untranslatable line re-billed Claude on every page view (cost abuse).
 */
export const CLAUDE_MISS_TTL_MS = 60 * 60 * 1000;
/** After a Claude transport/parse failure, skip those names for a while. */
export const CLAUDE_ERROR_BACKOFF_MS = 5 * 60 * 1000;
/** Bound the process-wide caches (texts are attacker-influenced). */
export const MAX_CACHE_ENTRIES = 10_000;

/**
 * Glossary first (instant, free, deterministic), Claude for what's left (one
 * batched call), never throws: a Claude failure just leaves those names
 * untranslated so the UI shows the Hebrew original.
 *
 * Results are memoized per instance; callers persist them (products.name_en,
 * po_lines / invoice_lines.raw_description_en) and only ask for NULL columns,
 * so the same row is never translated twice.
 */
export class CompositeTranslator {
  readonly glossary: GlossaryTranslator;
  private readonly claude: ClaudeTranslator | null;
  private readonly memo = new Map<string, Translation>();
  /** text → epoch ms until which Claude is not asked about it again. */
  private readonly claudeSkipUntil = new Map<string, number>();
  private readonly onClaudeError: (err: unknown) => void;
  private readonly now: () => number;

  constructor(opts: CompositeTranslatorOptions = {}) {
    this.glossary = opts.glossary ?? defaultGlossary();
    this.claude = opts.claude ?? null;
    this.onClaudeError =
      opts.onClaudeError ??
      ((err) =>
        // Message only — never the request/response object (it may echo invoice text).
        console.warn('[translate] Claude leg failed — glossary only:', err instanceof Error ? err.message : 'error'));
    this.now = opts.now ?? Date.now;
  }

  private remember<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (map.size >= MAX_CACHE_ENTRIES) map.clear();
    map.set(key, value);
  }

  get hasClaude(): boolean {
    return this.claude !== null;
  }

  /** Translate many names; the Map holds only names we could translate. */
  async translateMany(
    texts: readonly (string | null | undefined)[],
    opts: TranslateManyOptions = {},
  ): Promise<Map<string, Translation>> {
    const out = new Map<string, Translation>();
    const misses: string[] = [];
    for (const raw of texts) {
      if (raw == null) continue;
      const text = raw.trim();
      if (text === '' || out.has(text)) continue;
      const cached = this.memo.get(text);
      if (cached) {
        out.set(text, cached);
        continue;
      }
      if (!hasHebrew(text)) {
        out.set(text, { en: text, source: 'passthrough' });
        continue;
      }
      const g = this.glossary.translate(text);
      if (g) {
        const t: Translation = { en: g, source: 'glossary' };
        this.remember(this.memo, text, t);
        out.set(text, t);
      } else {
        misses.push(text);
      }
    }

    const now = this.now();
    const askClaude = misses.filter((m) => (this.claudeSkipUntil.get(m) ?? 0) <= now);
    if (askClaude.length > 0 && this.claude && opts.allowClaude !== false) {
      try {
        const answered = await this.claude.translateBatch(askClaude);
        for (const [he, en] of answered) {
          const t: Translation = { en, source: 'claude' };
          this.remember(this.memo, he, t);
          out.set(he, t);
        }
        for (const he of askClaude) {
          if (!answered.has(he)) this.remember(this.claudeSkipUntil, he, now + CLAUDE_MISS_TTL_MS);
        }
      } catch (err) {
        for (const he of askClaude) this.remember(this.claudeSkipUntil, he, now + CLAUDE_ERROR_BACKOFF_MS);
        this.onClaudeError(err);
      }
    }
    return out;
  }

  async translateOne(text: string | null | undefined): Promise<Translation | null> {
    if (text == null) return null;
    return (await this.translateMany([text])).get(text.trim()) ?? null;
  }
}

let sharedGlossary: GlossaryTranslator | null = null;

/** The built-in restaurant-supply glossary (built once per process). */
export function defaultGlossary(): GlossaryTranslator {
  sharedGlossary ??= new GlossaryTranslator(ALL_GLOSSARY_ENTRIES);
  return sharedGlossary;
}

/**
 * Production wiring: glossary always; Claude only when ANTHROPIC_API_KEY is set
 * and TRANSLATE_WITH_CLAUDE isn't '0'.
 */
export function createTranslator(
  env: NodeJS.ProcessEnv = process.env,
  claudeConfig: Omit<ClaudeTranslatorConfig, 'apiKey'> = {},
): CompositeTranslator {
  const apiKey = env.ANTHROPIC_API_KEY;
  const claude =
    apiKey && env.TRANSLATE_WITH_CLAUDE !== '0'
      ? new ClaudeTranslator({ apiKey, model: env.TRANSLATE_CLAUDE_MODEL, ...claudeConfig })
      : null;
  return new CompositeTranslator({ claude });
}
