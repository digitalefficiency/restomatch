/**
 * The five G-16 guards (GAP-PACKAGES G-16 §3). Each one is a heuristic over the
 * TypeScript AST, tuned to flag the pattern the finding describes and nothing
 * broader. All start in warn mode (see ./engine); the unit test plants a positive
 * and a negative for each.
 */
import ts from 'typescript';
import type { Rule, SourceFile } from './engine';

const WEB_SRC = /^apps\/web\/(app|lib)\//;
const API_SRC = /^packages\/api\/src\//;

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

// ─── 1. onchange-mutation ────────────────────────────────────────────────────

/** Calls that commit something: a tRPC mutation, a transition/run wrapper, a fetch, an auto-submit. */
const COMMIT_CALL = /\.(mutate|mutateAsync)\s*\(|\bstartTransition\s*\(|(^|[^\w.])run\s*\(|\bfetch\s*\(|\.requestSubmit\s*\(|\.submit\s*\(/;

/** Setting toggles that save on change by design (allow-list; path prefix + element kind). */
export const ONCHANGE_ALLOW: ReadonlyArray<{ path: RegExp; kinds: ReadonlyArray<'checkbox' | 'switch'>; why: string }> = [
  { path: /^apps\/web\/app\/dashboard\/settings\//, kinds: ['checkbox', 'switch'], why: 'settings toggles save on change' },
];

type ChoiceKind = 'select' | 'radio' | 'checkbox' | 'switch';

function attr(el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  for (const p of el.attributes.properties) {
    if (ts.isJsxAttribute(p) && p.name.getText() === name) return p;
  }
  return undefined;
}

function stringAttr(el: ts.JsxOpeningLikeElement, name: string): string | null {
  const a = attr(el, name);
  if (!a?.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  if (ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteralLike(a.initializer.expression)) {
    return a.initializer.expression.text;
  }
  return null;
}

function choiceKind(el: ts.JsxOpeningLikeElement): ChoiceKind | null {
  const tag = el.tagName.getText();
  if (tag === 'select') return 'select';
  if (tag === 'input') {
    const type = stringAttr(el, 'type');
    return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : null;
  }
  const last = tag.split('.').pop() ?? tag;
  if (/Select$/.test(last)) return 'select';
  if (/Radio/.test(last)) return 'radio';
  if (/Checkbox$/.test(last)) return 'checkbox';
  if (/(Switch|Toggle)$/.test(last)) return 'switch';
  return null;
}

/** Local functions (declarations and `const f = () => …`) by name → their text. */
function localFunctions(file: SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  walk(file.ast, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) out.set(n.name.text, n.getText(file.ast));
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer) || ts.isCallExpression(n.initializer))
    ) {
      out.set(n.name.text, n.getText(file.ast));
    }
  });
  return out;
}

/** Imported names that are server actions: from a `'use server'` module, or a module named `actions`. */
function serverActionImports(file: SourceFile): Set<string> {
  const out = new Set<string>();
  for (const st of file.ast.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue;
    const spec = st.moduleSpecifier.text;
    const text = file.readImport(spec);
    const isAction = /(^|[/-])actions?$/.test(spec.replace(/\.(ts|tsx)$/, '')) || (text != null && /^\s*['"]use server['"]/.test(text));
    if (!isAction) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const s of named.elements) if (!s.isTypeOnly) out.add(s.name.text);
    if (st.importClause?.name) out.add(st.importClause.name.text);
  }
  return out;
}

/** The handler's text plus one level of the local functions it calls. */
function handlerText(expr: ts.Expression, file: SourceFile, locals: Map<string, string>): string {
  const own = ts.isIdentifier(expr) ? (locals.get(expr.text) ?? '') : expr.getText(file.ast);
  let text = own;
  for (const m of own.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const body = locals.get(m[1]!);
    if (body && body !== own) text += `\n${body}`;
  }
  return text;
}

function reachesCommit(text: string, actions: Set<string>): string | null {
  const m = text.match(COMMIT_CALL);
  if (m) return m[0].replace(/\s*\($/, '').replace(/^[^\w.]/, '').trim();
  for (const a of actions) if (new RegExp(`\\b${a.replace(/\$/g, '\\$')}\\s*\\(`).test(text)) return `${a}() (server action)`;
  return null;
}

export const onchangeMutation: Rule = {
  id: 'onchange-mutation',
  describe: 'onChange on a select / radio / checkbox reaches a mutation, server action, run()/startTransition or fetch',
  applies: (p) => WEB_SRC.test(p) && /\.(tsx|jsx)$/.test(p),
  check(file, report) {
    let locals: Map<string, string> | null = null;
    let actions: Set<string> | null = null;
    walk(file.ast, (n) => {
      if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) return;
      const kind = choiceKind(n);
      if (!kind) return;
      const handler = attr(n, 'onChange') ?? attr(n, 'onValueChange') ?? attr(n, 'onCheckedChange');
      const init = handler?.initializer;
      if (!init || !ts.isJsxExpression(init) || !init.expression) return;
      if (ONCHANGE_ALLOW.some((a) => a.path.test(file.path) && (a.kinds as readonly string[]).includes(kind))) return;
      locals ??= localFunctions(file);
      actions ??= serverActionImports(file);
      const hit = reachesCommit(handlerText(init.expression, file, locals), actions);
      if (hit) report(n, `${kind} onChange commits (${hit}); use an explicit save/apply action`);
    });
  },
};

// ─── 2. money-swallow ────────────────────────────────────────────────────────

/** Promise chains that carry money: names of the ₪ procedures / readers. */
const MONEY_CHAIN =
  /leak|amount|kpi|recovery|monthlyReport|payRun|ledger|price|money|owner\.|approvals|invoices|claims|summary|vat|returned|savings|spend/i;
/** Case-sensitive suffixes (`leakIls`, `amountAgorot`) — `/ils/i` would match "utils". */
const MONEY_SUFFIX = /Ils\b|Agorot/;

function isEmptyFallback(e: ts.Expression): string | null {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  if (x.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (ts.isIdentifier(x) && x.text === 'undefined') return 'undefined';
  if (ts.isArrayLiteralExpression(x) && x.elements.length === 0) return '[]';
  return null;
}

function isServerComponent(file: SourceFile): boolean {
  return /^apps\/web\/app\//.test(file.path) && /\.tsx$/.test(file.path) && !file.isClient;
}

export const moneySwallow: Rule = {
  id: 'money-swallow',
  describe: '.catch(() => null|[]|undefined) on a money read; `?? 0` on *Ils / *Agorot in a server component',
  applies: (p) => WEB_SRC.test(p) || API_SRC.test(p),
  check(file, report) {
    const server = isServerComponent(file);
    walk(file.ast, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'catch' &&
        n.arguments.length === 1
      ) {
        const fn = n.arguments[0]!;
        if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isExpression(fn.body)) {
          const empty = isEmptyFallback(fn.body);
          const chain = n.expression.expression.getText(file.ast);
          if (empty && (MONEY_CHAIN.test(chain) || MONEY_SUFFIX.test(chain))) {
            report(n, `money read swallows its error to ${empty}: ${chain.replace(/\s+/g, ' ').slice(0, 80)}`);
          }
        }
      }
      if (
        server &&
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
        ts.isNumericLiteral(n.right) &&
        Number(n.right.text) === 0
      ) {
        const left = n.left.getText(file.ast);
        if (/(Ils|Agorot)\)?$/.test(left)) report(n, `\`${left} ?? 0\` turns an unknown ₪ into ₪0`);
      }
    });
  },
};

// ─── 3. receiver-idb-delete ──────────────────────────────────────────────────

const IDB_FILE = /indexedDB|IDBDatabase|IDBObjectStore|objectStore\(|idb-keyval|openDB\(/;
const IDB_DELETE = new Set(['delete', 'clear', 'deleteDatabase', 'deleteObjectStore', 'del', 'delMany']);

export const receiverIdbDelete: Rule = {
  id: 'receiver-idb-delete',
  describe: 'deletes on the receiver IndexedDB outside outbox.ts',
  applies: (p) => /^apps\/web\//.test(p) && !/\/outbox\.ts$/.test(p),
  check(file, report) {
    if (!IDB_FILE.test(file.text)) return;
    // Names bound to an in-memory Map / Set: their `.delete` is not IndexedDB.
    const memory = new Set<string>();
    walk(file.ast, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        ts.isNewExpression(n.initializer) &&
        /^(Map|Set|WeakMap|WeakSet|URLSearchParams|Headers|FormData)$/.test(n.initializer.expression.getText(file.ast))
      ) {
        memory.add(n.name.text);
      }
    });
    walk(file.ast, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
      if (!name || !IDB_DELETE.has(name)) return;
      if (ts.isPropertyAccessExpression(callee)) {
        const recv = callee.expression.getText(file.ast);
        if (memory.has(recv) || /^(this\.)?\w*(map|set|cache|seen|params|headers)$/i.test(recv)) return;
      }
      report(n, `IndexedDB ${name}() outside outbox.ts — queued receipts must leave only through the outbox`);
    });
  },
};

// ─── 4. status-literals ──────────────────────────────────────────────────────

/** Lifecycle status values across POs, receipts, invoices, approvals, claims, deliveries, jobs. */
export const STATUS_WORDS = new Set([
  'draft', 'sent', 'confirmed', 'partial', 'closed', 'cancelled', 'pending', 'completed', 'rejected', 'received',
  'approved', 'paid', 'unpaid', 'matched', 'unmatched', 'claimed', 'letter_sent', 'acknowledged', 'credited',
  'recovered', 'written_off', 'disputed', 'open', 'escalated', 'accepted', 'resolved', 'processing', 'failed',
  'queued', 'upcoming', 'due_today', 'late', 'in_progress', 'needs_review', 'overdue', 'scheduled', 'skipped',
]);

/** Lifecycle modules: where a status list is DEFINED. */
const LIFECYCLE_MODULE = /(^|\/)(lifecycle|deliveryState|transitions?|status(es)?|states?|invoiceState)\.(ts|tsx)$|\/lifecycle\//;

/** `export const X_STATUSES = [...]` (any file) is a definition, not a use. */
function isExportedDefinition(n: ts.ArrayLiteralExpression): boolean {
  let p: ts.Node = n.parent;
  while (ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isParenthesizedExpression(p)) p = p.parent;
  if (!ts.isVariableDeclaration(p) || !ts.isIdentifier(p.name)) return false;
  const list = p.parent;
  const stmt = list?.parent;
  return (
    stmt != null &&
    ts.isVariableStatement(stmt) &&
    (stmt.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
    /STATUS|STATES|LIFECYCLE/i.test(p.name.text)
  );
}

export const statusLiterals: Rule = {
  id: 'status-literals',
  describe: 'status literal arrays outside the lifecycle modules',
  applies: (p) => (WEB_SRC.test(p) || API_SRC.test(p)) && !LIFECYCLE_MODULE.test(p) && !/\/db\/|schema\.ts$/.test(p),
  check(file, report) {
    walk(file.ast, (n) => {
      if (!ts.isArrayLiteralExpression(n) || n.elements.length < 2) return;
      const words: string[] = [];
      for (const e of n.elements) {
        if (!ts.isStringLiteralLike(e) || !STATUS_WORDS.has(e.text)) return;
        words.push(e.text);
      }
      if (new Set(words).size < 2 || isExportedDefinition(n)) return;
      report(n, `status list [${words.join(', ')}] — import it from the lifecycle module`);
    });
  },
};

// ─── 5. client-api-value-import ──────────────────────────────────────────────

export const clientApiValueImport: Rule = {
  id: 'client-api-value-import',
  describe: "value imports of @restomatch/api in 'use client' files",
  applies: (p) => WEB_SRC.test(p),
  check(file, report) {
    if (!file.isClient) return;
    for (const st of file.ast.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      if (!/^@restomatch\/api(\/|$)/.test(st.moduleSpecifier.text)) continue;
      const clause = st.importClause;
      if (!clause) {
        report(st, `side-effect import of ${st.moduleSpecifier.text} in a client file`);
        continue;
      }
      if (clause.isTypeOnly) continue;
      const values: string[] = [];
      if (clause.name) values.push(clause.name.text);
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) values.push(`* as ${nb.name.text}`);
      if (nb && ts.isNamedImports(nb)) for (const s of nb.elements) if (!s.isTypeOnly) values.push(s.name.text);
      if (values.length) report(st, `value import {${values.join(', ')}} from ${st.moduleSpecifier.text} pulls server code into the client bundle`);
    }
  },
};

export const RULES: readonly Rule[] = [onchangeMutation, moneySwallow, receiverIdbDelete, statusLiterals, clientApiValueImport];
