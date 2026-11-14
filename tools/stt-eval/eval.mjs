#!/usr/bin/env node
/**
 * Compare speech recognizers on the same recordings.
 *
 *   node tools/stt-eval/eval.mjs --cases tools/stt-eval/cases.zh.json --audio <dir> \
 *     --apple <apple-stt binary> [--server http://127.0.0.1:8787 --token-file <file>] [--out results.json]
 *   node tools/stt-eval/eval.mjs --journal docket-voice.json --audio <dir> --apple … [--server …]
 *
 * With --cases, audio files are named `<anything>-NN.wav`, NN being the 1-based case number.
 * With --journal (a voice log exported from the app), the recordings are the files the records
 * name (copy the phone's Documents/voice folder with `xcrun devicectl device copy from`), only
 * labelled records count, and the reference is the user's correction or else what was heard;
 * the transcripts the app got at the time are scored too (`app: system` / `app: cloud`). Engines:
 *   transcriber / dictation   Apple on-device (macOS/iOS 26 SpeechAnalyzer; see apple-stt.swift),
 *                             each with and without the vocabulary as contextual strings
 *   cloud                     the sync server's /api/ai/transcribe (exactly what the app uploads to),
 *                             with and without the vocabulary as the hint
 * Scores: character error rate after normalizing numerals, times and punctuation; the share of
 * key terms (names, objects) recognized exactly; and time per file.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    cases: { type: 'string' },
    journal: { type: 'string' },
    audio: { type: 'string' },
    apple: { type: 'string' },
    server: { type: 'string' },
    'token-file': { type: 'string' },
    lang: { type: 'string', default: 'zh' },
    out: { type: 'string' },
  },
});
/** One recording: its file, the reference text, key terms, and what the app heard at the time. */
let items;
let words;
if (opt.journal) {
  const records = JSON.parse(readFileSync(opt.journal, 'utf8')).records ?? [];
  items = records
    .filter((r) => r.capture?.audio && r.label && existsSync(join(opt.audio, r.capture.audio)))
    .map((r) => ({
      file: join(opt.audio, r.capture.audio),
      ref: r.label.said ?? r.heard,
      terms: [],
      app: { system: r.capture.system, cloud: r.capture.cloud },
    }));
  words = [];
} else {
  const suite = JSON.parse(readFileSync(opt.cases, 'utf8'));
  words = suite.words;
  items = readdirSync(opt.audio)
    .filter((f) => /-\d+\.wav$/.test(f))
    .sort()
    .map((f) => {
      const c = suite.cases[Number(f.match(/-(\d+)\.wav$/)[1]) - 1];
      return { file: join(opt.audio, f), ref: c.text, terms: c.terms };
    });
}
if (!items.length) {
  console.error('nothing to score');
  process.exit(1);
}

// --- normalization --------------------------------------------------------------------------

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNumber(s) {
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch in DIGIT) cur = DIGIT[ch];
    else if (ch === '十') {
      total += (cur || 1) * 10;
      cur = 0;
    } else if (ch === '百') {
      total += (cur || 1) * 100;
      cur = 0;
    }
  }
  return String(total + cur);
}
export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/(\d{1,2})[:：]00/g, '$1点')
    .replace(/(\d{1,2})[:：]30/g, '$1点半')
    .replace(/(\d{1,2})[:：](\d{2})/g, '$1点$2')
    .replace(/[零〇一二两三四五六七八九十百]+/g, cnNumber)
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
function distance(a, b) {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const row = [i];
    for (let j = 1; j <= B.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[B.length];
}

// --- engines --------------------------------------------------------------------------------

function apple(engine, withWords) {
  const args = ['--engine', engine, '--locale', opt.lang === 'zh' ? 'zh-CN' : 'en-US'];
  if (withWords && words.length) args.push('--words', words.join(','));
  const out = execFileSync(opt.apple, [...args, ...items.map((f) => f.file)], { encoding: 'utf8' });
  const byFile = new Map(
    out
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .map((r) => [r.file, r]),
  );
  return items.map((f) => byFile.get(f.file) ?? { error: 'missing' });
}

async function cloud(withWords) {
  const token = readFileSync(opt['token-file'], 'utf8').match(/dk_[A-Za-z0-9_-]+/)?.[0];
  const results = [];
  for (const f of items) {
    const q = new URLSearchParams({ lang: opt.lang });
    if (withWords && words.length) q.set('hint', words.join('、'));
    const t = performance.now();
    const res = await fetch(`${opt.server}/api/ai/transcribe?${q}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' },
      body: readFileSync(f.file),
    });
    const body = await res.json().catch(() => ({}));
    results.push(
      res.ok
        ? { text: body.text ?? '', ms: Math.round(performance.now() - t) }
        : { error: body.error ?? `HTTP ${res.status}` },
    );
  }
  return results;
}

const engines = [];
if (opt.journal) {
  engines.push(['app: system', () => items.map((f) => ({ text: f.app.system }))]);
  if (items.some((f) => f.app.cloud))
    engines.push(['app: cloud', () => items.map((f) => ({ text: f.app.cloud ?? '' }))]);
}
if (opt.apple) {
  engines.push(
    ['transcriber', () => apple('transcriber', false)],
    ['dictation', () => apple('dictation', false)],
  );
  if (words.length)
    engines.push(
      ['transcriber + words', () => apple('transcriber', true)],
      ['dictation + words', () => apple('dictation', true)],
    );
}
if (opt.server && opt['token-file']) {
  engines.push(['cloud', () => cloud(false)]);
  if (words.length) engines.push(['cloud + words', () => cloud(true)]);
}

const report = [];
for (const [name, run] of engines) {
  const results = await run();
  let errs = 0;
  let chars = 0;
  let hits = 0;
  let terms = 0;
  const ms = [];
  const misses = [];
  results.forEach((r, i) => {
    const c = items[i];
    const ref = normalize(c.ref);
    const hyp = normalize(r.text ?? '');
    errs += distance(hyp, ref);
    chars += [...ref].length;
    for (const term of c.terms) {
      terms++;
      if (hyp.includes(normalize(term))) hits++;
    }
    if (r.ms !== undefined) ms.push(r.ms);
    if (hyp !== ref) misses.push({ file: c.file.split('/').pop(), ref: c.ref, got: r.text ?? r.error });
  });
  ms.sort((a, b) => a - b);
  report.push({
    engine: name,
    cer: +(errs / chars).toFixed(3),
    terms: terms ? +(hits / terms).toFixed(3) : null,
    exact: results.length - misses.length,
    n: results.length,
    msMedian: ms[Math.floor(ms.length / 2)] ?? null,
    misses,
  });
  console.error(`${name}: done`);
}
console.table(
  report.map(({ misses, ...r }) => ({
    ...r,
    cer: `${(r.cer * 100).toFixed(1)}%`,
    terms: r.terms === null ? '—' : `${(r.terms * 100).toFixed(1)}%`,
  })),
);
if (opt.out) writeFileSync(opt.out, JSON.stringify(report, null, 2));
