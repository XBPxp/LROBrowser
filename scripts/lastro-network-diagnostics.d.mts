export interface LastroNetworkDiagnostic {
  event: 'packet-failure' | 'disconnect';
  atMs: number;
  ageMs?: number;
  opcode: number | null;
  length: number | null;
  phase: 'map' | 'login-or-char';
  kind: 'decode' | 'handler' | 'unknown' | 'framing';
  errorName?: string;
  reason?: 'unknown-length' | 'invalid-length' | 'invalid-frame';
}
export interface LastroNetworkDiagnostics {
  record(socket: object, opcode: unknown, length: unknown, kind: string, error?: unknown, reason?: unknown): void;
  disconnected(socket: object): void;
}
export function createLastroNetworkDiagnostics(dependencies?: {
  log?(metadata: LastroNetworkDiagnostic): void;
  publish?(metadata: LastroNetworkDiagnostic): void;
  now?(): number;
}): LastroNetworkDiagnostics;
export function patchRuntimeNetworkDiagnostics(source: string): string;
