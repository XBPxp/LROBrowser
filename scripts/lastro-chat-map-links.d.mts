export interface ChatMapDestination { mapname: string; x: number; y: number; mapOnly?: true; }
export interface ChatMapPrompt {
  onRemove?: (...args: unknown[]) => unknown;
}
export function createLastroChatMapLinks(deps: {
  setHtml: (parent: HTMLElement, html: string) => void;
  showPrompt: (message: string, onYes: () => void, onNo: () => void) => ChatMapPrompt | undefined;
  teleport: (destination: ChatMapDestination) => void;
  canTeleport?: () => boolean;
  getMap?: () => string;
  navigate?: (destination: ChatMapDestination) => void;
  onError?: (error: unknown) => void;
}): {
  render: (parent: HTMLElement, text: unknown, override?: boolean) => void;
  request: (link: Element | null) => boolean;
  normalize: (text: unknown) => string;
  serverMessage: (text: unknown) => string | null;
  plainText: (text: unknown) => string;
  formatItemLink: (match: string, parse: () => { name?: unknown } | null) => string | null;
};
