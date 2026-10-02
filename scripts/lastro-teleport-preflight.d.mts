export interface TeleportPreflightMap {
  /** Full server map ID; rsw may use the scene loader's instance base name. */
  mapname: string;
  width: number;
  height: number;
  rsw: string;
  gnd: string;
  gat: string;
}

export interface TeleportPreflightApproval {
  approved: true;
  token: number;
  maps: TeleportPreflightMap[];
}

export function createLastroTeleportPreflight(deps: {
  /** Raw ArrayBuffer bytes; the native Client.loadFile decoder is not suitable. */
  loadFile: (name: string) => Promise<ArrayBuffer>;
  getMap: () => unknown;
  /** Server/client identity; changes invalidate metadata and pending checks. */
  getProfile?: () => unknown;
}): {
  /** A new check cancels the previous check. Failures reject; cancellation is AbortError. */
  check: (route: unknown) => Promise<TeleportPreflightApproval>;
  cancel: () => void;
};
