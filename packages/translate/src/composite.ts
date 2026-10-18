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
}

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
  private readonly onClaudeError: (err: unknown) => void;

  constructor(opts: CompositeTranslatorOptions = {}) {
    this.glossary = opts.glossary ?? defaultGlossary();
    this.claude = opts.claude ?? null;
    this.onClaudeError =
      opts.onClaudeError ?? ((err) => console.warn('[translate] Claude leg failed — glossary only', err));
  }

  get hasClaude(): boolean {
    return this.claude !== null;
  }

  /** Translate many names; the Map holds only names we could translate. */
  async translateMany(texts: readonly (string | null | undefined)[]): Promise<Map<string, Translation>> {
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
        this.memo.set(text, t);
        out.set(text, t);
      } else {
        misses.push(text);
      }
    }

    if (misses.length > 0 && this.claude) {
      try {
        const answered = await this.claude.translateBatch(misses);
        for (const [he, en] of answered) {
          const t: Translation = { en, source: 'claude' };
          this.memo.set(he, t);
          out.set(he, t);
        }
      } catch (err) {
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
