import type { Priority } from '../model';

/**
 * Prefix tokens: `#project`, `@label`, `/section`, `!1`–`!4` / `p1`–`p4`.
 *
 * Scanned by hand (no regex lookbehind, which older Hermes/JSC lack). A prefix only counts at a
 * word start: after whitespace, a CJK character or punctuation — so `a@b.com`, `issue#12` and
 * `C#` stay plain text. Full-width `＃＠／！` from Chinese IMEs work too.
 */

export interface PrefixSyntax {
  project: string;
  label: string;
  section: string;
}

export const DEFAULT_SYNTAX: PrefixSyntax = { project: '#', label: '@', section: '/' };

const FULL_WIDTH: Record<string, string> = { '＃': '#', '＠': '@', '／': '/', '！': '!' };

export interface Named {
  id: string;
  name: string;
}

export interface PrefixToken {
  kind: 'project' | 'label' | 'section' | 'priority';
  start: number;
  end: number;
  text: string;
  name?: string;
  id?: string;
  priority?: Priority;
}

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);
const normalize = (c: string | undefined) => (c !== undefined ? (FULL_WIDTH[c] ?? c) : c);

/** May a token start at `i`? (Start of text, or previous char is not a latin word char.) */
function atWordStart(text: string, i: number): boolean {
  return i === 0 || !isWordChar(text[i - 1]);
}

/** Longest known name that `text` starts with at `i` (case-insensitive). */
function matchKnown(text: string, i: number, known: readonly Named[]): Named | null {
  let best: Named | null = null;
  const rest = text.slice(i).toLowerCase();
  for (const k of known) {
    const name = k.name.toLowerCase();
    if (!name || !rest.startsWith(name)) continue;
    // Latin names must end at a word boundary (#work ≠ #workshop); CJK names may run straight
    // into the title, as in "#工作写周报".
    if (isWordChar(name.at(-1)) && isWordChar(text[i + name.length])) continue;
    if (!best || name.length > best.name.length) best = k;
  }
  return best;
}

/** Raw name after a prefix: up to whitespace or another prefix char. */
function rawName(text: string, i: number, prefixes: string): string {
  let j = i;
  while (j < text.length && !isSpace(text[j]) && !prefixes.includes(normalize(text[j]) ?? '')) j++;
  return text.slice(i, j);
}

const PRIORITY_BY_LEVEL: Record<string, Priority> = { '1': 3, '2': 2, '3': 1, '4': 0 };

export function scanPrefixTokens(
  text: string,
  opts: {
    syntax?: PrefixSyntax;
    projects?: readonly Named[];
    labels?: readonly Named[];
    sections?: readonly (Named & { projectId: string })[];
  } = {},
): PrefixToken[] {
  const syntax = opts.syntax ?? DEFAULT_SYNTAX;
  const prefixes = `${syntax.project}${syntax.label}${syntax.section}!`;
  const tokens: PrefixToken[] = [];
  let projectId: string | undefined;
  let i = 0;
  while (i < text.length) {
    const c = normalize(text[i]);
    if (!atWordStart(text, i)) {
      i++;
      continue;
    }
    // Priority: !1..!4 or p1..p4 as a standalone word.
    const pm = /^(?:!|p|P)([1-4])/.exec(`${c}${text.slice(i + 1, i + 2)}`);
    if (pm && !isWordChar(text[i + 2]) && (c === '!' || c === 'p' || c === 'P')) {
      tokens.push({
        kind: 'priority',
        start: i,
        end: i + 2,
        text: text.slice(i, i + 2),
        priority: PRIORITY_BY_LEVEL[pm[1] as string] as Priority,
      });
      i += 2;
      continue;
    }
    const kind =
      c === syntax.project
        ? 'project'
        : c === syntax.label
          ? 'label'
          : c === syntax.section
            ? 'section'
            : null;
    if (!kind) {
      i++;
      continue;
    }
    // `/` is common in normal text ("A/B", "1/2"): only known sections, and only after a space.
    if (kind === 'section' && i > 0 && !isSpace(text[i - 1])) {
      i++;
      continue;
    }
    const pool: readonly Named[] =
      kind === 'project'
        ? (opts.projects ?? [])
        : kind === 'label'
          ? (opts.labels ?? [])
          : (opts.sections ?? []).filter((s) => !projectId || s.projectId === projectId);
    const known = matchKnown(text, i + 1, pool);
    const name = known ? text.slice(i + 1, i + 1 + known.name.length) : rawName(text, i + 1, prefixes);
    if (!name || (kind === 'section' && !known)) {
      i++;
      continue;
    }
    const end = i + 1 + name.length;
    tokens.push({
      kind,
      start: i,
      end,
      text: text.slice(i, end),
      name: known?.name ?? name,
      ...(known ? { id: known.id } : {}),
    });
    if (kind === 'project' && known) projectId = known.id;
    i = end;
  }
  return tokens;
}
