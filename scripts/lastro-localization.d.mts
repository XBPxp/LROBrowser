export const JOB_NAME_OVERRIDES: Record<string, string>;
export const RUNTIME_TEXT_REPLACEMENTS: Array<[string, string]>;
export const MESSAGE_FALLBACKS: Record<number, string>;
export const MAP_NAME_OVERRIDES: Record<string, string>;
export const MAP_TITLE_OVERRIDES: Record<string, string>;
export interface LastroMapInfo {
  displayName?: string;
  signName?: { mainTitle?: string | null; subTitle?: string | null };
  backgroundBmp?: string | null;
  notifyEnter?: boolean;
  [key: string]: unknown;
}
export function createLastroMapLocalization(names?: Record<string, string>, titles?: Record<string, string>): {
  normalize(value: unknown): string;
  rememberName(mapname: unknown, value: string | undefined): string | undefined;
  resolveName(mapname: unknown, fallback?: string): string | undefined;
  localizeInfo(mapname: unknown, info: LastroMapInfo | null, tableName?: string): LastroMapInfo | null;
};
export function patchRuntimeMapLocalization(source: string): string;
export function setLastroStatusTooltip(node: HTMLElement, value: string | null | undefined): void;
export function patchRuntimeStatusTooltips(source: string): string;
export function assertRuntimeLocalizationMount(source: string, baseline?: string): void;
