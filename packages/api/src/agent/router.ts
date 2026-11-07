/**
 * The deterministic front of the WhatsApp agent (WA-02). Only free text that
 * is not a command reaches `runAgent` (and so, maybe, the model):
 *  - `interactive` / `button` taps → WA-07's token handler (stub until then);
 *  - `image` / `document` → the ingest hand-off (WA-05ʰ), never the model;
 *  - commands `עצור` · `אדם` · `עזרה` · `החלף מסעדה` · `החלף תפקיד` → fixed
 *    handlers (`עצור`/`החלף` call WA-04's identity API once it exists);
 *  - other kinds (voice, sticker, location…) → a fixed reply (voice is not v1).
 */
import { COMMANDS, HE, type AgentCommand } from './copy/he';

export type InboundMessage =
  | { kind: 'text'; text: string }
  | { kind: 'interactive' | 'button'; id: string }
  | { kind: 'image' | 'document'; mediaId?: string; caption?: string }
  | { kind: 'audio' | 'video' | 'sticker' | 'location' | 'contacts' | 'reaction' | 'unknown' };

export type RouteHandler = 'agent' | 'tap' | 'media' | 'command' | 'unsupported';

export interface RouteResult {
  handler: RouteHandler;
  command?: AgentCommand;
  text: string;
}

export interface RouterDeps {
  /** Free text → the agent (the ONLY path that may call the model). */
  runAgent(text: string): Promise<{ text: string }>;
  /** WA-07: claim a staged action by its token. Absent → "coming soon". */
  onTap?(id: string): Promise<{ text: string }>;
  /** WA-05ʰ: hand the media to ingest (caption is data, never an instruction). */
  onMedia?(msg: Extract<InboundMessage, { kind: 'image' | 'document' }>): Promise<void>;
  /** WA-04 identity API. */
  onStop?(): Promise<void>;
  onSwitch?(what: 'restaurant' | 'role'): Promise<{ text: string } | null>;
  onHuman?(): Promise<void>;
}

/** The command a text is, or null: exact words after trimming punctuation and spaces. */
export function commandOf(text: string): AgentCommand | null {
  const t = text
    .normalize('NFKC')
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/[.!?,;:"'״׳()\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (COMMANDS as readonly string[]).includes(t) ? (t as AgentCommand) : null;
}

export async function routeMessage(msg: InboundMessage, deps: RouterDeps): Promise<RouteResult> {
  switch (msg.kind) {
    case 'interactive':
    case 'button':
      return { handler: 'tap', text: deps.onTap ? (await deps.onTap(msg.id)).text : HE.actionSoon };
    case 'image':
    case 'document':
      await deps.onMedia?.(msg);
      return { handler: 'media', text: HE.mediaReceived };
    case 'text': {
      const cmd = commandOf(msg.text);
      if (cmd) return { handler: 'command', command: cmd, text: await runCommand(cmd, deps) };
      return { handler: 'agent', text: (await deps.runAgent(msg.text)).text };
    }
    default:
      return { handler: 'unsupported', text: HE.unsupported };
  }
}

async function runCommand(cmd: AgentCommand, deps: RouterDeps): Promise<string> {
  switch (cmd) {
    case 'עצור':
      await deps.onStop?.();
      return HE.stop;
    case 'אדם':
      await deps.onHuman?.();
      return HE.human;
    case 'עזרה':
      return HE.help;
    case 'החלף מסעדה':
      return (await deps.onSwitch?.('restaurant'))?.text ?? HE.switchRestaurant;
    case 'החלף תפקיד':
      return (await deps.onSwitch?.('role'))?.text ?? HE.switchRole;
  }
}
