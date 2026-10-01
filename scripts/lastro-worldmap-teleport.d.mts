export interface WorldMapTeleportOptions {
  preflight: { check(route: unknown): Promise<{ approved: boolean }>; cancel(): void };
  getMap(): string;
  getProfile(): unknown;
  /** Preserve the native type 0 map warp and its default 0/0 coordinates. */
  send(mapid: string): void;
  onSameMap?(mapid: string): void;
  onError?(error: unknown): void;
  showPrompt?(message: string, onYes: () => void, onNo: () => void): {
    onRemove?: (...args: unknown[]) => unknown;
    remove?: () => void;
  } | undefined;
}
export function createLastroWorldMapTeleport(options: WorldMapTeleportOptions): {
  request(mapid: string, label?: string): Promise<boolean>;
  cancelPending(): void;
};
