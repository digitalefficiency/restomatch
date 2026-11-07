/**
 * Typed, REVIEWABLE extraction failures. A caller (the OCR job) must route these
 * to a person instead of retrying: the same document will fail the same way, and
 * a half-read invoice must never reach the leak figure.
 *
 * Messages never carry invoice content, a URL or a token — only the code and
 * safe facts (a stop reason, an HTTP status, a byte signature name).
 */
export type OcrFailureCode =
  /** The model hit max_tokens: the JSON is cut off (a very long invoice). */
  | 'max_tokens'
  /** The model declined (stop_reason 'refusal'). */
  | 'refusal'
  /** HEIC/HEIF or unrecognised bytes — Claude cannot read them; ask for a JPEG/PNG/PDF. */
  | 'unsupported_format'
  /** The answer was not a JSON invoice (or failed the schema). */
  | 'invalid_output'
  /** Downloading the scan failed or timed out. */
  | 'fetch_failed';

export interface OcrUsage {
  inputTokens: number;
  outputTokens: number;
}

export class OcrExtractionError extends Error {
  override readonly name = 'OcrExtractionError';
  /** Always true: these go to human review; retrying does not help. */
  readonly reviewable = true;
  constructor(
    readonly code: OcrFailureCode,
    message: string,
    readonly details: { usage?: OcrUsage; elapsedMs?: number; refusalCategory?: string | null } = {},
  ) {
    super(`ocr ${code}: ${message}`);
  }
}

export function isOcrExtractionError(err: unknown): err is OcrExtractionError {
  return err instanceof OcrExtractionError;
}
