export interface NpcMapLinksApi {
  render(parent: Element, value: unknown, formatText: (text: string) => string): void;
  invalidate(): void;
  request(link: Element): Promise<boolean>;
  canSend(mapname: string): boolean;
  commit(mapname: string, send: () => void): void;
}
export interface NpcMapComponent {
  ownerID: number;
  __active: boolean;
  _host?: HTMLElement;
  getRoot(): ShadowRoot | HTMLElement;
  init?(...args: unknown[]): unknown;
  onKeyDown?(event: KeyboardEvent): unknown;
  setText(text: string, gid: number): unknown;
  addNext(gid: number): unknown;
  addClose(gid: number): unknown;
  next(): unknown;
  close(): unknown;
  onRemove?(): unknown;
  _lastroMapLinks?: NpcMapLinksApi;
}
export interface NpcMapPrompt {
  remove(): unknown;
  getRoot?(): ShadowRoot | HTMLElement;
  onRemove?(...args: unknown[]): unknown;
  onKeyDown?(event: KeyboardEvent): unknown;
  captureKeyEvents?: boolean;
  _bindKeyDown?(): void;
}
export function installLastroNpcMapLinks(component: NpcMapComponent, options: {
  setHtml(parent: Element, html: string): void;
  labelFor?(mapid: string): string;
  showPrompt(message: string, onYes: () => void, onNo: () => void): NpcMapPrompt | void;
  shouldConfirmTeleport?(): boolean;
  teleport(mapid: string): Promise<boolean>;
  cancelPending(): void;
  canActivate?(): boolean;
  onError?(error: unknown): void;
}): NpcMapLinksApi;
export function patchRuntimeNpcMapLinks(source: string, resourceLoaderCode: string): string;
