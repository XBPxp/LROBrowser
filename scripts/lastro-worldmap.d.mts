export interface WorldMapMonsterTarget {
  /** A real monster mobGID from the initial quest packet; never a huntID. */
  id?: number | null;
  name?: string | null;
}
export interface WorldMapItemInput {
  identifiedDisplayName?: string;
  identifiedDescriptionName?: string | string[];
  identifiedResourceName?: string;
  slotCount?: number;
}
export interface WorldMapMapInput {
  name?: string;
  mobs?: Array<number | string>;
  branch?: string[];
  belong?: string;
  [field: string]: unknown;
}
export interface WorldMapMonsterInput {
  kName?: string;
  LV?: number | string;
  [field: string]: unknown;
}
export interface WorldMapMonster {
  id: number; name: string; level?: number | string;
  maps: WorldMapMap[];
  drops: Array<{ item: WorldMapItem; rate: number; kind: string }>;
}
export interface WorldMapItem {
  id: number; name: string; description?: string | string[]; resource?: string; slots?: number;
  sources: Array<{ monster: WorldMapMonster; rate: number; kind: string }>;
}
export interface WorldMapMap extends WorldMapMapInput {
  id: string; name: string; monsters: WorldMapMonster[];
}
export interface WorldMapIndex {
  maps: Map<string, WorldMapMap>;
  monsters: Map<number, WorldMapMonster>;
  items: Map<number, WorldMapItem>;
  floors(id: string): WorldMapMap[];
  search(query: string, type?: 'all' | 'monster' | 'item' | 'map'): Array<{ kind: 'map' | 'monster' | 'item'; record: WorldMapMap | WorldMapMonster | WorldMapItem; rank: number }>;
  normalize(value: unknown): string;
}
export function createWorldMapIndex(worldData: Record<string, WorldMapMapInput>, mobData: Record<string, WorldMapMonsterInput>, itemTable: Record<number, WorldMapItemInput>, getItemInfo: (id: number) => WorldMapItemInput): WorldMapIndex;
export const WORLD_MAP_HTML: string;
export const WORLD_MAP_CSS: string;
export interface WorldMapComponent {
  _host: HTMLElement | null;
  __active?: boolean;
  needFocus?: boolean;
  manager?: { components: Record<string, WorldMapComponent> } | null;
  getRoot(): ShadowRoot | HTMLElement | null;
  prepare(): unknown;
  append(target?: HTMLElement | string): unknown;
  focus?(): unknown;
  searchMonster?(target: WorldMapMonsterTarget): Promise<void>;
}
export interface WorldMapDependencies {
  document?: Document;
  DB: { INTERFACE_PATH: string; getItemInfo(id: number): WorldMapItemInput };
  Client: { loadFile(path: string, done: (url: string) => void, failed: () => void): unknown };
  loadData(): Promise<{ worldData: Record<string, WorldMapMapInput>; mobData: Record<string, WorldMapMonsterInput> }>;
  itemTable(): Record<number, WorldMapItemInput>;
  currentMap?(): string;
  accountId?(): number;
  monsterPortrait?(id: number): Promise<string | null>;
  navigate?(mapid: string): unknown;
  teleport?(mapid: string, label?: string): void | boolean | Promise<void | boolean>;
  cancelTeleport?(): void;
}
export interface WorldMapRegion {
  name: string; background: string; columns: number; rows: number;
  cells: Array<{ id: string | null; image: string; x: number; y: number; span: number; boss: boolean }>;
}
export function installLastroWorldMap(component: WorldMapComponent, dependencies: WorldMapDependencies, regions: WorldMapRegion[], makeIndex: typeof createWorldMapIndex): {
  open(target: { kind: 'search' } | { kind: 'map' | 'monster' | 'item'; id: number | string }, opener?: HTMLElement): Promise<void>;
  ensureData(): Promise<WorldMapIndex>;
  searchMonster(target: WorldMapMonsterTarget): Promise<void>;
};
