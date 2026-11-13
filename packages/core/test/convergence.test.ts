import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Command,
  CommandError,
  completeTask,
  createLabel,
  createProject,
  createSection,
  createTask,
  deleteLabel,
  deleteProject,
  deleteSection,
  deleteTask,
  inbox,
  moveTask,
  type Op,
  projectView,
  Replica,
  rescheduleOverdue,
  rescheduleTask,
  restoreTask,
  sidebar,
  today,
  uncompleteTask,
  updateTask,
} from '../src';
import { addDays } from '../src/time';
import { cells, clock, materialize, replica, rng } from './helpers';

/**
 * Convergence fuzzing: three devices make random edits (including undo/redo and conflicting
 * moves), exchange random subsets of ops in random order with duplicates and clock skew, then
 * sync fully. All devices must end with byte-identical state, and the merged state must satisfy
 * the integrity rules (no parent cycles, no tasks lost in deleted containers).
 */

const SEEDS = 1000;
const STEPS = 60;

function pick<T>(r: () => number, xs: readonly T[]): T | undefined {
  return xs.length ? xs[Math.floor(r() * xs.length)] : undefined;
}

function shuffle<T>(r: () => number, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

function randomCommand(r: () => number, rep: Replica): Command<unknown> | 'undo' | 'redo' | null {
  const tasks = rep.store.all('task');
  const live = tasks.filter((t) => !t.deletedAt);
  const projects = rep.store.all('project').filter((p) => !p.deletedAt);
  const sections = rep.store.all('section').filter((s) => !s.deletedAt);
  const labels = rep.store.all('label').filter((l) => !l.deletedAt);
  const t = pick(r, live);
  const date = addDays('2026-11-10', Math.floor(r() * 10));
  switch (Math.floor(r() * 18)) {
    case 0:
    case 1: {
      const where = r();
      return createTask({
        title: `t${Math.floor(r() * 1000)}`,
        ...(where < 0.3
          ? {}
          : where < 0.6
            ? { projectId: pick(r, projects)?.id ?? null }
            : where < 0.8
              ? { sectionId: pick(r, sections)?.id ?? null }
              : { parentId: t?.id ?? null }),
        ...(r() < 0.4 ? { scheduled: { date } } : {}),
        ...(r() < 0.2
          ? {
              recurrence: {
                rule: pick(r, [
                  'FREQ=DAILY',
                  'FREQ=WEEKLY;BYDAY=MO,TH',
                  'FREQ=MONTHLY;BYMONTHDAY=-1',
                ]) as string,
              },
            }
          : {}),
        ...(r() < 0.3 && labels.length ? { labels: [pick(r, labels)?.id as string] } : {}),
        position: pick(r, ['top', 'bottom', { index: Math.floor(r() * 5) }] as const),
      });
    }
    case 2:
      return t
        ? updateTask(t.id, { title: `e${Math.floor(r() * 1000)}`, priority: pick(r, [0, 1, 2, 3] as const) })
        : null;
    case 3:
      return t ? completeTask(t.id) : null;
    case 4:
      return t ? uncompleteTask(t.id) : null;
    case 5:
      return t ? deleteTask(t.id) : null;
    case 6: {
      const d = pick(
        r,
        tasks.filter((x) => x.deletedAt),
      );
      return d ? restoreTask(d.id) : null;
    }
    case 7:
    case 8: {
      if (!t) return null;
      const k = r();
      const target =
        k < 0.3
          ? { index: Math.floor(r() * 6) }
          : k < 0.5
            ? { projectId: pick(r, [...projects.map((p) => p.id), null]) ?? null, index: Math.floor(r() * 4) }
            : k < 0.65
              ? { sectionId: pick(r, sections)?.id ?? null }
              : { parentId: pick(r, live)?.id ?? null };
      return moveTask(t.id, target);
    }
    case 9:
      return t ? rescheduleTask(t.id, r() < 0.1 ? null : date, r() < 0.5 ? 'occurrence' : 'series') : null;
    case 10:
      return createProject({
        name: `p${Math.floor(r() * 100)}`,
        parentId:
          r() < 0.3
            ? (pick(
                r,
                projects.filter((p) => !p.parentId),
              )?.id ?? null)
            : null,
      });
    case 11: {
      const p = pick(r, projects);
      return p ? createSection({ projectId: p.id, name: `s${Math.floor(r() * 100)}` }) : null;
    }
    case 12: {
      const p = pick(r, projects);
      return p && r() < 0.5 ? deleteProject(p.id) : null;
    }
    case 13: {
      const s = pick(r, sections);
      return s ? deleteSection(s.id) : null;
    }
    case 14:
      return r() < 0.5
        ? createLabel({ name: `l${Math.floor(r() * 1000)}` })
        : (() => {
            const l = pick(r, labels);
            return l ? deleteLabel(l.id) : null;
          })();
    case 15:
      return rescheduleOverdue();
    case 16:
      return 'undo';
    default:
      return 'redo';
  }
}

function checkIntegrity(rep: Replica): void {
  const tasks = rep.store.all('task');
  for (const t of tasks) {
    // No parent cycles.
    const seen = new Set<string>();
    let p: string | null = t.id;
    while (p) {
      expect(seen.has(p), `parent cycle at ${t.id}`).toBe(false);
      seen.add(p);
      p = rep.store.get('task', p)?.parentId ?? null;
    }
    if (t.deletedAt) continue;
    if (t.parentId) {
      const parent = rep.store.get('task', t.parentId);
      expect(!!parent && !parent.deletedAt, `live child ${t.id} of missing/deleted parent`).toBe(true);
      expect(t.projectId).toBe(parent?.projectId);
    } else if (t.projectId) {
      const project = rep.store.get('project', t.projectId);
      expect(!!project && !project.deletedAt, `task ${t.id} in dead project`).toBe(true);
    }
    for (const l of t.labels) {
      const label = rep.store.get('label', l);
      expect(!!label && !label.deletedAt, `task ${t.id} has dead label ${l}`).toBe(true);
    }
  }
}

/** Derived views, compared by ids to make ordering differences visible. */
function views(rep: Replica) {
  const sb = sidebar(rep.store);
  return {
    inbox: inbox(rep.store).map((t) => t.id),
    today: today(rep.store, '2026-11-13').today.map((t) => t.id),
    projects: sb.projects.map((p) => [p.project.id, p.children.map((c) => c.id)]),
    groups: sb.projects.map((p) =>
      projectView(rep.store, p.project.id)?.groups.map((g) => g.tasks.map((t) => t.id)),
    ),
  };
}

describe('convergence fuzz', () => {
  afterEach(() => vi.restoreAllMocks());

  it(`${SEEDS} seeds × ${STEPS} steps converge`, () => {
    const stats = { ops: 0, repairs: 0, undos: 0, rejected: 0, cycles: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      vi.spyOn(Math, 'random').mockImplementation(r); // deterministic sort-key jitter
      const repairSpy = vi.spyOn(Replica.prototype, 'repair');
      const clocks = [0, 1, 2].map(() => clock());
      // Skewed device clocks (up to ±10 minutes).
      for (const c of clocks) c.advance(Math.floor((r() - 0.5) * 20 * 60 * 1000));
      const reps = ['a', 'b', 'c'].map((id, i) => replica(id, clocks[i]));
      const sent: Op[][] = reps.map(() => []);
      const collect = (i: number) => {
        const rep = reps[i] as Replica;
        const out = rep.pending();
        rep.ack(out.map((o) => o.hlc));
        (sent[i] as Op[]).push(...out);
      };

      try {
        for (let step = 0; step < STEPS; step++) {
          const i = Math.floor(r() * 3);
          const rep = reps[i] as Replica;
          clocks[i]?.advance(Math.floor(r() * 5000));
          if (r() < 0.25) {
            // Partial, shuffled delivery from another device, with duplicates.
            const from = (i + 1 + Math.floor(r() * 2)) % 3;
            collect(from);
            const ops = (sent[from] as Op[]).filter(() => r() < 0.6);
            rep.receive(shuffle(r, [...ops, ...ops.filter(() => r() < 0.2)]));
            collect(i);
            continue;
          }
          const cmd = randomCommand(r, rep);
          try {
            if (cmd === 'undo') stats.undos += rep.undo() ? 1 : 0;
            else if (cmd === 'redo') rep.redo();
            else if (cmd) rep.dispatch(cmd);
          } catch (e) {
            if (!(e instanceof CommandError)) throw e;
            stats.rejected++;
          }
          collect(i);
        }

        // Full sync until quiescent (repairs may produce a round of new ops).
        for (let round = 0; round < 5; round++) {
          const all = sent.flat();
          for (const rep of reps) rep.receive(shuffle(r, [...all]));
          for (let i = 0; i < reps.length; i++) collect(i);
          if (sent.flat().length === all.length) break;
        }

        const [a, b, c] = reps as [Replica, Replica, Replica];
        expect(cells(b)).toEqual(cells(a));
        expect(cells(c)).toEqual(cells(a));
        expect(materialize(b)).toEqual(materialize(a));
        expect(views(b)).toEqual(views(a));
        expect(views(c)).toEqual(views(a));
        checkIntegrity(a);
        stats.ops += sent.flat().length;
        stats.repairs += repairSpy.mock.results.filter(
          (x) => x.type === 'return' && (x.value as number) > 0,
        ).length;
        stats.cycles += sent.flat().filter((o) => o.actor === 'system' && o.field === 'parentId').length;
      } catch (e) {
        throw new Error(`seed ${seed}: ${(e as Error).message}`, { cause: e });
      } finally {
        vi.restoreAllMocks();
      }
    }
    // The fuzz must actually hit conflicts, not just pass trivially.
    expect(stats.repairs).toBeGreaterThan(SEEDS / 10);
    expect(stats.cycles).toBeGreaterThan(0);
    expect(stats.undos).toBeGreaterThan(SEEDS / 2);
    expect(stats.rejected).toBeGreaterThan(0);
    expect(stats.ops).toBeGreaterThan(SEEDS * 40);
    console.info('convergence fuzz stats', stats);
  }, 120_000);
});
