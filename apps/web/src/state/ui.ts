import { create } from 'zustand';

export type Route =
  | { kind: 'inbox' }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'logbook' }
  | { kind: 'trash' }
  | { kind: 'project'; id: string }
  | { kind: 'label'; id: string }
  | { kind: 'search'; q: string };

export function routeToHash(r: Route): string {
  switch (r.kind) {
    case 'project':
    case 'label':
      return `#/${r.kind}/${r.id}`;
    case 'search':
      return `#/search/${encodeURIComponent(r.q)}`;
    default:
      return `#/${r.kind}`;
  }
}

export function hashToRoute(hash: string): Route {
  const [, kind, arg] = hash.replace(/^#/, '').split('/');
  switch (kind) {
    case 'inbox':
    case 'upcoming':
    case 'logbook':
    case 'trash':
    case 'today':
      return { kind };
    case 'project':
    case 'label':
      return arg ? { kind, id: arg } : { kind: 'today' };
    case 'search':
      return { kind: 'search', q: decodeURIComponent(arg ?? '') };
    default:
      return { kind: 'today' };
  }
}

export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'error';
  action?: { label: string; run: () => void };
}

export type Theme = 'system' | 'light' | 'dark';

export interface ReschedulePrompt {
  resolve: (mode: 'occurrence' | 'series' | null) => void;
}

interface UIState {
  route: Route;
  /** Selected task ids (multi-select); `focusId` is the keyboard cursor. */
  selection: string[];
  focusId: string | null;
  detailId: string | null;
  /** Task currently being renamed inline. */
  editingId: string | null;
  /** Ordered ids of the tasks the current view shows (keyboard navigation). */
  visibleIds: string[];
  /** Subtask parents collapsed in list views. */
  collapsed: Record<string, boolean>;
  paletteOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  brainDumpOpen: boolean;
  /** Keyboard date picker (`d`) for the selection. */
  scheduleOpen: boolean;
  sidebarOpen: boolean;
  quickAddNonce: number;
  /** Bumped to ask the open detail pane to run AI breakdown. */
  breakdownNonce: number;
  toasts: Toast[];
  theme: Theme;
  reschedulePrompt: ReschedulePrompt | null;

  navigate(route: Route): void;
  select(ids: string[], focusId?: string | null): void;
  setFocus(id: string | null): void;
  openDetail(id: string | null): void;
  setEditing(id: string | null): void;
  set(patch: Partial<UIState>): void;
  focusQuickAdd(): void;
  toggleCollapsed(id: string): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;

export const useUI = create<UIState>((set, get) => ({
  route: hashToRoute(location.hash),
  selection: [],
  focusId: null,
  detailId: null,
  editingId: null,
  visibleIds: [],
  collapsed: JSON.parse(localStorage.getItem('docket.collapsed') ?? '{}') as Record<string, boolean>,
  paletteOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  brainDumpOpen: false,
  scheduleOpen: false,
  sidebarOpen: false,
  quickAddNonce: 0,
  breakdownNonce: 0,
  toasts: [],
  theme: (localStorage.getItem('docket.theme') as Theme | null) ?? 'system',
  reschedulePrompt: null,

  navigate(route) {
    const hash = routeToHash(route);
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ route, selection: [], focusId: null, editingId: null, sidebarOpen: false });
  },
  select(ids, focusId) {
    set({ selection: ids, focusId: focusId === undefined ? (ids.at(-1) ?? null) : focusId });
  },
  setFocus(id) {
    set({ focusId: id });
  },
  openDetail(id) {
    set({ detailId: id, ...(id ? { selection: [id], focusId: id } : {}) });
  },
  setEditing(id) {
    set({ editingId: id });
  },
  set(patch) {
    set(patch);
  },
  focusQuickAdd() {
    set({ quickAddNonce: get().quickAddNonce + 1 });
  },
  toggleCollapsed(id) {
    const collapsed = { ...get().collapsed, [id]: !get().collapsed[id] };
    localStorage.setItem('docket.collapsed', JSON.stringify(collapsed));
    set({ collapsed });
  },
  toast(toast) {
    const id = ++toastSeq;
    // Keep the newest few; each replaces older ones of the same message.
    set({
      toasts: [
        ...get()
          .toasts.filter((x) => x.message !== toast.message)
          .slice(-2),
        { ...toast, id },
      ],
    });
    setTimeout(() => get().dismissToast(id), toast.tone === 'error' ? 7000 : 5000);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((x) => x.id !== id) });
  },
}));

window.addEventListener('popstate', () => {
  useUI.setState({ route: hashToRoute(location.hash), selection: [], focusId: null });
});

/** Ask "only this one or the whole series?" for recurring tasks. */
export function askRescheduleMode(): Promise<'occurrence' | 'series' | null> {
  return new Promise((resolve) => {
    useUI.setState({
      reschedulePrompt: {
        resolve: (mode) => {
          useUI.setState({ reschedulePrompt: null });
          resolve(mode);
        },
      },
    });
  });
}
