import { File, Paths } from 'expo-file-system';

/**
 * Small JSON files in the app's document directory: the replica snapshot and settings.
 * Writes go to a temp file first and are then moved into place, so a crash mid-write can't
 * leave a truncated snapshot.
 */

function file(name: string): File {
  return new File(Paths.document, name);
}

export function readJson<T>(name: string): T | undefined {
  const f = file(name);
  if (!f.exists) return undefined;
  try {
    return JSON.parse(f.textSync()) as T;
  } catch (e) {
    console.warn(`unreadable ${name}`, e);
    return undefined;
  }
}

export function writeJson(name: string, value: unknown): void {
  const tmp = file(`${name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(JSON.stringify(value));
  const target = file(name);
  if (target.exists) target.delete();
  tmp.move(target);
}

export function removeFile(name: string): void {
  const f = file(name);
  if (f.exists) f.delete();
}

const SETTINGS = 'settings.json';
let settings: Record<string, unknown> | null = null;

function all(): Record<string, unknown> {
  settings ??= readJson<Record<string, unknown>>(SETTINGS) ?? {};
  return settings;
}

export function getSetting<T>(key: string): T | undefined {
  return all()[key] as T | undefined;
}

export function setSetting<T>(key: string, value: T): void {
  all()[key] = value;
  writeJson(SETTINGS, all());
}

/** Async adapter for the shared sync client. */
export const syncStorage = {
  get: async <T>(key: string) => getSetting<T>(key),
  set: async <T>(key: string, value: T) => setSetting(key, value),
};
