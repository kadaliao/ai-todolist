/**
 * The brain dump's "no AI" split: one task per line or sentence. Spoken text has no line breaks,
 * so sentence ends count too, and so does a comma right before a word that starts a new item
 * ("…，还有…", "…, and then …"); that word is dropped. Pieces of one character are noise.
 */

const CONNECTOR_ZH = '还有|然后|另外|再就是|再|并且|以及|还要|别忘了|记得';
const CONNECTOR_EN = 'and then|and also|also|then';

const BREAK = new RegExp(
  [
    '\\n+',
    '[。；;！!？?]+',
    // An English full stop ends a sentence only before a space or the end, so "3.5" stays whole.
    '\\.(?=\\s|$)',
    `[，,、](?=\\s*(?:${CONNECTOR_ZH}))`,
    `,(?=\\s*(?:${CONNECTOR_EN})\\b)`,
  ].join('|'),
  'i',
);
const LEADING = new RegExp(`^\\s*(?:(?:${CONNECTOR_ZH})|(?:${CONNECTOR_EN}|and)\\b)[\\s，,]*`, 'i');

export function splitSentences(text: string): string[] {
  return text
    .split(new RegExp(BREAK.source, 'gi'))
    .map((s) =>
      s
        .replace(LEADING, '')
        .replace(/[，,、\s]+$/, '')
        .trim(),
    )
    .filter((s) => s.length > 1);
}
