import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoldenCase, Recording, type GoldenCaseT, type RecordingT } from './schema';

export const GOLDEN_DIR = join(__dirname, 'cases');
export const RECORDED_DIR = join(__dirname, '..', 'recorded');

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export function readRaw(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

/** Every case file, parsed (throws on the first invalid file, naming it). */
export function loadCases(): GoldenCaseT[] {
  return jsonFiles(GOLDEN_DIR).map((f) => {
    const parsed = GoldenCase.safeParse(readRaw(GOLDEN_DIR, f));
    if (!parsed.success) throw new Error(`${f}: ${parsed.error.message}`);
    if (`${parsed.data.id}.json` !== f) throw new Error(`${f}: file name must be <id>.json`);
    return parsed.data;
  });
}

export function loadRecording(caseId: string): RecordingT {
  return Recording.parse(readRaw(RECORDED_DIR, `${caseId}.json`));
}

export function caseFiles(): string[] {
  return jsonFiles(GOLDEN_DIR);
}

export function recordingFiles(): string[] {
  return jsonFiles(RECORDED_DIR);
}
