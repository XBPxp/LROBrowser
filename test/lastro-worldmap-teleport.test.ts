import { describe, expect, it, vi } from 'vitest';
import { createLastroWorldMapTeleport } from '../scripts/lastro-worldmap-teleport.mjs';

function fixture(withPrompt = false) {
  let map = 'prontera.gat', profile = '6:5';
  const pending: Array<{ resolve(value: { approved: boolean }): void; reject(error: Error): void }> = [];
  const preflight = {
    check: vi.fn<(route: unknown) => Promise<{ approved: boolean }>>(() => new Promise((resolve, reject) => pending.push({ resolve, reject }))),
    cancel: vi.fn(),
  };
  const send = vi.fn<(mapid: string) => void>();
  const onError = vi.fn(), onSameMap = vi.fn();
  const prompts: Array<{ message: string; yes(): void; no(): void; popup: { onRemove?: () => void; remove(): void } }> = [];
  const showPrompt = vi.fn((message: string, yes: () => void, no: () => void) => {
    const popup = { onRemove: vi.fn(), remove: vi.fn(() => popup.onRemove?.()) };
    prompts.push({ message, yes, no, popup }); return popup;
  });
  const api = createLastroWorldMapTeleport({ preflight, getMap: () => map, getProfile: () => profile, send, onSameMap, onError,
    ...(withPrompt ? { showPrompt } : {}) });
  return { api, pending, preflight, send, onSameMap, onError, prompts, showPrompt,
    setMap: (value: string) => { map = value; }, setProfile: (value: string) => { profile = value; } };
}

describe('verified world map teleports', () => {
  it.each(['izlude', ' IZLUDE.GAT ', 'izlude.rsw'])('does not treat a map-level 0/0 default as a coordinate or warp on the current map: %s', async target => {
    const f = fixture(); f.setMap('IZLUDE.gat');
    expect(await f.api.request(target)).toBe(false);
    expect(f.onSameMap).toHaveBeenCalledExactlyOnceWith('izlude');
    expect(f.preflight.check).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
  });
  it('checks the target map before sending a single map-level warp with original 0/0 semantics', async () => {
    const f = fixture();
    const result = f.api.request('ein_fild04');
    expect(f.preflight.check).toHaveBeenCalledExactlyOnceWith({ outset: ['ein_fild04', 0, 0] });
    expect(f.send).not.toHaveBeenCalled();
    f.pending[0]!.resolve({ approved: true });
    expect(await result).toBe(true);
    expect(f.send).toHaveBeenCalledExactlyOnceWith('ein_fild04');
    expect(f.onError).not.toHaveBeenCalled();
  });

  it('normalizes a known map resource suffix without substituting a different map or NPC position', async () => {
    const f = fixture();
    const result = f.api.request(' EIN_FILD04.GAT ');
    f.pending[0]!.resolve({ approved: true });
    expect(await result).toBe(true);
    expect(f.preflight.check).toHaveBeenCalledExactlyOnceWith({ outset: ['ein_fild04', 0, 0] });
    expect(f.send).toHaveBeenCalledExactlyOnceWith('ein_fild04');
  });

  it.each(['map', 'profile'])('does not send when the source %s changes while resources are pending', async field => {
    const f = fixture(); const result = f.api.request('ein_fild04');
    if (field === 'map') f.setMap('geffen.gat'); else f.setProfile('3:3');
    f.pending[0]!.resolve({ approved: true });
    expect(await result).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.onError.mock.calls[0]?.[0]).toMatchObject({ message: '当前地图或区服已变化，请重新选择地点。' });
  });

  it('does not send or report errors from an old request after closing the world map', async () => {
    const f = fixture(); const result = f.api.request('ein_fild04');
    f.api.cancelPending();
    f.pending[0]!.resolve({ approved: true });
    expect(await result).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.preflight.cancel).toHaveBeenCalledTimes(2);
  });

  it('lets only the newest target send even if the previous check completes later', async () => {
    const f = fixture(); const first = f.api.request('ein_fild04'), second = f.api.request('payon');
    f.pending[1]!.resolve({ approved: true });
    expect(await second).toBe(true);
    f.pending[0]!.resolve({ approved: true });
    expect(await first).toBe(false);
    expect(f.send).toHaveBeenCalledExactlyOnceWith('payon');
  });

  it('reports an actual validation error once and keeps the current map unchanged', async () => {
    const f = fixture(); const result = f.api.request('ein_fild04');
    const error = new Error('无法读取地图资源：data/ein_fild04.gnd');
    f.pending[0]!.reject(error);
    expect(await result).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('requires explicit approval and allows a failed target to be retried', async () => {
    const f = fixture(); const failed = f.api.request('ein_fild04');
    f.pending[0]!.resolve({ approved: false });
    expect(await failed).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    const retried = f.api.request('ein_fild04'); f.pending[1]!.resolve({ approved: true });
    expect(await retried).toBe(true);
    expect(f.send).toHaveBeenCalledExactlyOnceWith('ein_fild04');
    expect(f.onError).toHaveBeenCalledTimes(1);
  });

  it('silences cancellation errors and stale failures', async () => {
    const f = fixture(); const aborted = f.api.request('ein_fild04');
    const abort = new Error('abort'); abort.name = 'AbortError';
    f.pending[0]!.reject(abort); expect(await aborted).toBe(false);
    const stale = f.api.request('ein_fild04'); f.api.cancelPending();
    f.pending[1]!.reject(new Error('old failure')); expect(await stale).toBe(false);
    expect(f.onError).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it.each(['', '../ein_fild04', 'bad/map', 'invalid map', 'a'.repeat(17)])('rejects malformed map identifiers before checking resources: %s', async mapid => {
    const f = fixture(); expect(await f.api.request(mapid)).toBe(false);
    expect(f.preflight.check).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.onError).toHaveBeenCalledTimes(1);
  });

  it('does not begin a check when the source map is loading or has been cleared on logout', async () => {
    const f = fixture(); f.setMap('');
    expect(await f.api.request('ein_fild04')).toBe(false);
    expect(f.preflight.check).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.onError.mock.calls[0]?.[0]).toMatchObject({ message: '当前地图尚未就绪，请稍后重新选择。' });
  });

  it('reports a native send failure without claiming that the world map should be hidden', async () => {
    const f = fixture(); f.send.mockImplementation(() => { throw new Error('socket unavailable'); });
    const result = f.api.request('ein_fild04'); f.pending[0]!.resolve({ approved: true });
    expect(await result).toBe(false);
    expect(f.onError.mock.calls[0]?.[0]).toMatchObject({ message: 'socket unavailable' });
  });

  it('shows the chosen display name and starts no resource checks before explicit confirmation', async () => {
    const f = fixture(true), result = f.api.request(' EIN_FILD04.GAT ', '艾音布罗克原野');
    expect(f.prompts[0]?.message).toBe('是否传送到艾音布罗克原野？\nein_fild04');
    expect(f.preflight.check).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    f.prompts[0]!.yes(); await Promise.resolve();
    expect(f.preflight.check).toHaveBeenCalledExactlyOnceWith({ outset: ['ein_fild04', 0, 0] });
    f.pending[0]!.resolve({ approved: true });
    expect(await result).toBe(true); expect(f.send).toHaveBeenCalledExactlyOnceWith('ein_fild04');
  });

  it.each(['cancel', 'remove', 'close'])('does not check or send when confirmation ends by %s', async action => {
    const f = fixture(true), result = f.api.request('ein_fild04');
    const prompt = f.prompts[0]!;
    if (action === 'cancel') prompt.no();
    if (action === 'remove') prompt.popup.remove();
    if (action === 'close') f.api.cancelPending();
    expect(await result).toBe(false);
    prompt.yes(); await Promise.resolve();
    expect(f.preflight.check).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    if (action === 'close') expect(prompt.popup.remove).toHaveBeenCalledOnce();
  });

  it.each(['map', 'profile'])('rejects an approval from a previous %s before any resource check', async field => {
    const f = fixture(true), result = f.api.request('ein_fild04');
    if (field === 'map') f.setMap('geffen.gat'); else f.setProfile('3:3');
    f.prompts[0]!.yes();
    expect(await result).toBe(false);
    expect(f.preflight.check).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(f.onError.mock.calls[0]?.[0]).toMatchObject({ message: '当前地图或区服已变化，请重新选择地点。' });
  });

  it('retains one confirmation during repeated target clicks', async () => {
    const f = fixture(true), first = f.api.request('ein_fild04');
    expect(await f.api.request('payon')).toBe(false);
    expect(await f.api.request('ein_fild04')).toBe(false);
    expect(f.showPrompt).toHaveBeenCalledOnce(); expect(f.preflight.check).not.toHaveBeenCalled();
    f.prompts[0]!.yes(); await Promise.resolve(); f.pending[0]!.resolve({ approved: true });
    expect(await first).toBe(true); expect(f.send).toHaveBeenCalledExactlyOnceWith('ein_fild04');
  });
});
