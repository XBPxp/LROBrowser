export function installLastroShortcutSettings(component: {
  _lastroShortcutSettings?: { sync(): void };
  init?: (...args: unknown[]) => unknown;
  onAppend?: (...args: unknown[]) => unknown;
  getRoot(): ParentNode;
}, options: {
  document: Document;
  getEnabled(): boolean;
  setEnabled(enabled: boolean): unknown | Promise<unknown>;
  onError?(error: unknown): void;
}): { sync(): void };
