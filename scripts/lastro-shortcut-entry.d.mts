export interface ShortcutEntrySnapshot {
  css: string;
  isDraggable: boolean;
  methods: Record<string, unknown>;
}
export interface ShortcutEntryController {
  setEnabled(enabled: boolean): boolean;
  isEnabled(): boolean;
  refresh(): boolean;
}
export interface ShortcutEntryDependencies {
  document?: Document;
  setHtml(parent: ParentNode, html: string): unknown;
  getEnabled?(): boolean;
  normalizeRoute(route: unknown): { npc: string; [key: string]: unknown };
  requestRoute(route: unknown): unknown;
}
export function captureLastroShortcutEntry(tools: unknown): ShortcutEntrySnapshot;
export function installLastroShortcutEntry(tools: unknown, nativeEntry: ShortcutEntrySnapshot, deps: ShortcutEntryDependencies): ShortcutEntryController;
