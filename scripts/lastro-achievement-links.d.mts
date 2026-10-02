import type { NpcMapPrompt } from './lastro-npc-map-links.mjs';
export interface AchievementLinksApi {
  render(parent: Element, value: unknown): void;
  request(link: Element): Promise<boolean>;
  invalidate(): void;
  canSend(mapname: string): boolean;
}
export interface AchievementLinkComponent {
  __active: boolean;
  selectedAchId: number | null;
  _host?: HTMLElement;
  getRoot(): ShadowRoot | HTMLElement;
  renderDetail?(...args: unknown[]): unknown;
  renderList?(...args: unknown[]): unknown;
  renderOverview?(...args: unknown[]): unknown;
  toggle?(...args: unknown[]): unknown;
  onRemove?(...args: unknown[]): unknown;
  _lastroAchievementLinks?: AchievementLinksApi;
}
export function installLastroAchievementLinks(component: AchievementLinkComponent, options: {
  mapLabel?(mapname: string): string;
  showPrompt(message: string, onYes: () => void, onNo: () => void): NpcMapPrompt | void;
  shouldConfirmTeleport?(): boolean;
  teleport(mapname: string): Promise<boolean>;
  cancelPending(): void;
  showMonster(name: string): unknown;
  onError?(error: unknown): void;
}): AchievementLinksApi;
export function patchRuntimeAchievementLinks(source: string, resourceLoaderCode: string): string;
