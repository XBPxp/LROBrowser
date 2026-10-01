// @vitest-environment jsdom
import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Phase A IWA', () => {
  it('declares an isolated, manually installed app with Direct Sockets permissions', async () => {
    const source = await readFile('public/.well-known/manifest.webmanifest', 'utf8');
    const manifest = JSON.parse(source);
    expect(manifest.name).toBe('LRO进阶客户端(Powered by LTSD.Ro)');
    expect(manifest.short_name).toBe('LRO进阶客户端');
    expect(manifest.version).toMatch(/^\d+(?:\.\d+)*$/);
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.permissions_policy['direct-sockets']).toEqual(['self']);
    expect(manifest.permissions_policy.gamepad).toEqual(['self']);
    expect(manifest.permissions_policy['cross-origin-isolated']).toEqual(['self']);
    expect(manifest.permissions_policy.autoplay).toEqual(['self']);
    expect(manifest.protocol_handlers).toEqual([
      { protocol: 'web+lastro', url: '/?protocol=%s' },
    ]);
    expect(manifest.icons).toEqual([{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }]);
    expect(manifest).not.toHaveProperty('update_manifest_url');
    expect(source).not.toMatch(/socketProxy|WebSocket|wss/i);
  });

  it('keeps the full app title consistent across the HTML and shell sources', async () => {
    const [html, shell] = await Promise.all([
      readFile('index.html', 'utf8'),
      readFile('src/app-shell.ts', 'utf8'),
    ]);
    expect(html).toContain('<title>LRO进阶客户端(Powered by LTSD.Ro)</title>');
    expect(shell).toContain("title.textContent = 'LRO进阶客户端(Powered by LTSD.Ro)';");
  });

  it('ships compact local Chinese fonts and both upstream licenses', async () => {
    const [variable, medium, bold, license, miSansLicense, notice] = await Promise.all([
      readFile('public/fonts/MiSans-VF.woff2'),
      readFile('public/fonts/LastROGlyphFallback-Medium.woff2'),
      readFile('public/fonts/LastROGlyphFallback-Bold.woff2'),
      readFile('public/fonts/OFL.txt', 'utf8'),
      readFile('public/fonts/MiSans-LICENSE.pdf'),
      readFile('public/fonts/NOTICE.txt', 'utf8'),
    ]);
    for (const font of [variable, medium, bold]) expect(font.toString('ascii', 0, 4)).toBe('wOF2');
    expect(variable.byteLength + medium.byteLength + bold.byteLength).toBeLessThan(12 * 1024 * 1024);
    expect((await readdir('public/fonts')).filter(name => /\.(?:woff2?|otf|ttf)$/i.test(name)).sort()).toEqual([
      'LastROGlyphFallback-Bold.woff2', 'LastROGlyphFallback-Medium.woff2', 'MiSans-VF.woff2',
    ]);
    expect(license).toContain('SIL OPEN FONT LICENSE');
    expect(license).toContain('Version 1.1');
    expect(miSansLicense.toString('ascii', 0, 5)).toBe('%PDF-');
    expect(notice).toContain('MiSans');
    expect(notice).toContain('LastRO Glyph Fallback');
  });

});
