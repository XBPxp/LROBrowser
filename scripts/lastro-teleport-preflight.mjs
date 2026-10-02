/** Validate map resources without loading a scene or sending any game packets. */
export function createLastroTeleportPreflight({ loadFile, getMap, getProfile = () => '' }) {
  if (typeof loadFile !== 'function' || typeof getMap !== 'function' || typeof getProfile !== 'function') {
    throw new TypeError('Teleport preflight requires loadFile and getMap functions');
  }

  let generation = 0;
  let active = null;
  let cachedProfile;
  const metadataCache = new Map();
  const cacheLifetime = 5 * 60 * 1000;
  const cacheLimit = 64;

  function selectProfile(profile) {
    if (cachedProfile !== profile) {
      metadataCache.clear();
      cachedProfile = profile;
    }
  }

  function failure(message, code, resource) {
    const error = new Error(message);
    error.code = code;
    if (resource) error.resource = resource;
    return error;
  }

  function cancelled() {
    const error = failure('传送检查已取消，请重新选择。', 'CANCELLED');
    error.name = 'AbortError';
    return error;
  }

  function mapName(value) {
    if (typeof value !== 'string') throw failure('地图名无效，请重新选择。', 'INVALID_MAP');
    const name = value.trim().replace(/\.gat$/i, '').toLowerCase();
    if (!/^[a-z0-9_@#-]{1,16}$/.test(name)) {
      throw failure('地图名无效，请重新选择。', 'INVALID_MAP');
    }
    return name;
  }

  function currentMap() {
    try {
      return mapName(getMap());
    } catch {
      throw failure('当前地图尚未就绪，请稍后重新选择。', 'MAP_NOT_READY');
    }
  }

  function routePoints(route) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw failure('传送路线无效，请重新选择。', 'INVALID_ROUTE');
    }
    const points = [];
    if (route.outset != null) points.push(route.outset);
    if (route.path != null) {
      if (!Array.isArray(route.path)) throw failure('传送路径无效，请重新选择。', 'INVALID_ROUTE');
      points.push(...route.path);
    }
    if (!points.length) throw failure('该传送路线没有有效目的地，请重新选择。', 'INVALID_ROUTE');
    return points.map((point) => {
      if (!Array.isArray(point) || point.length !== 3) {
        throw failure('传送地点无效，请重新选择。', 'INVALID_ROUTE');
      }
      const name = mapName(point[0]);
      const [x, y] = point.slice(1);
      if (![x, y].every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 65535)) {
        throw failure(`地图 ${name} 的坐标无效，请重新选择。`, 'INVALID_COORDINATE');
      }
      return { mapname: name, x, y };
    });
  }

  function header(buffer, signature, resource, minimum) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < minimum) {
      throw failure(`地图资源缺失或损坏：${resource}`, 'INVALID_RESOURCE', resource);
    }
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < signature.length; index++) {
      if (bytes[index] !== signature.charCodeAt(index)) {
        throw failure(`地图资源损坏：${resource}`, 'INVALID_RESOURCE', resource);
      }
    }
    const major = bytes[4];
    const minor = bytes[5];
    if (major < 1 || minor > 9) {
      throw failure(`地图资源版本无效：${resource}`, 'INVALID_RESOURCE', resource);
    }
    return { bytes, view: new DataView(buffer), version: major + minor / 10 };
  }

  function reference(bytes, offset, extension, resource) {
    if (offset < 0 || offset + 40 > bytes.byteLength) {
      throw failure(`地图资源缺失或损坏：${resource}`, 'INVALID_RESOURCE', resource);
    }
    let originalName = '';
    for (let index = offset; index < offset + 40 && bytes[index] !== 0; index++) {
      const value = bytes[index];
      if (value < 33 || value > 126) {
        throw failure(`地图资源引用无效：${resource}`, 'INVALID_REFERENCE', resource);
      }
      originalName += String.fromCharCode(value);
    }
    const name = originalName.replace(/\\/g, '/');
    const segments = name.split('/');
    if (!name || !name.toLowerCase().endsWith(`.${extension}`) || segments.some((segment) => (
      !/^[a-zA-Z0-9_@#.-]+$/.test(segment) || segment === '.' || segment === '..'
    ))) {
      throw failure(`地图资源引用无效：${resource}`, 'INVALID_REFERENCE', resource);
    }
    // The scene loader looks aliases up with the exact RSW field. Keep its case
    // and separators; the normalized copy above is only for path validation.
    return `data/${originalName}`;
  }

  function rswReferences(buffer, resource) {
    const { bytes, version } = header(buffer, 'GRSW', resource, 6);
    // These fields precede the fixed 40-byte INI, GND, GAT, and optional SRC names
    // in the same order used by the bundled RSW reader.
    const offset = 6 + (version >= 2.5 ? 4 : 0) + (version >= 2.2 ? 1 : 0);
    const minimum = offset + (version >= 1.4 ? 160 : 120);
    if (bytes.byteLength < minimum) {
      throw failure(`地图资源缺失或损坏：${resource}`, 'INVALID_RESOURCE', resource);
    }
    return {
      gnd: reference(bytes, offset + 40, 'gnd', resource),
      gat: reference(bytes, offset + 80, 'gat', resource),
    };
  }

  function dimensions(buffer, signature, resource) {
    const minimum = signature === 'GRGN' ? 26 : 14;
    const { view } = header(buffer, signature, resource, minimum);
    const width = view.getUint32(6, true);
    const height = view.getUint32(10, true);
    if (!width || !height || width > 65536 || height > 65536) {
      throw failure(`地图资源尺寸无效：${resource}`, 'INVALID_RESOURCE', resource);
    }
    if (signature === 'GRAT' && width * height > Math.floor((buffer.byteLength - 14) / 20)) {
      throw failure(`地图资源缺失或损坏：${resource}`, 'INVALID_RESOURCE', resource);
    }
    if (signature === 'GRGN') {
      const zoom = view.getFloat32(14, true);
      if (!Number.isFinite(zoom) || zoom <= 0) {
        throw failure(`地图资源损坏：${resource}`, 'INVALID_RESOURCE', resource);
      }
    }
    return { width, height };
  }

  function cancel() {
    generation++;
    if (active) {
      active.abort();
      active = null;
    }
  }

  async function check(route) {
    cancel();
    const token = generation;
    const origin = currentMap();
    const profile = String(getProfile());
    selectProfile(profile);
    const points = routePoints(route);
    let resolveAbort;
    const aborted = new Promise((resolve) => { resolveAbort = resolve; });
    const request = { abort: resolveAbort };
    active = request;

    function ensureActive() {
      if (token !== generation || active !== request) throw cancelled();
      try {
        const currentProfile = String(getProfile());
        if (currentProfile !== profile) {
          selectProfile(currentProfile);
          throw cancelled();
        }
        if (currentMap() !== origin) throw cancelled();
      } catch {
        throw cancelled();
      }
    }

    const resources = new Map();
    function read(resource) {
      ensureActive();
      if (!resources.has(resource)) {
        const loading = Promise.resolve().then(() => {
          ensureActive();
          return loadFile(resource);
        });
        resources.set(resource, Promise.race([
          loading,
          aborted.then(() => { throw cancelled(); }),
        ]).then((buffer) => {
          ensureActive();
          return buffer;
        }, (cause) => {
          ensureActive();
          const error = failure(`无法读取地图资源：${resource}`, 'RESOURCE_LOAD_FAILED', resource);
          error.cause = cause;
          throw error;
        }));
      }
      return resources.get(resource);
    }

    const stagedMetadata = new Map();
    async function validateMap(resourceMap) {
      ensureActive();
      const cached = metadataCache.get(resourceMap);
      if (cached) {
        if (cached.expires > Date.now()) {
          metadataCache.delete(resourceMap);
          metadataCache.set(resourceMap, cached);
          return cached.metadata;
        }
        metadataCache.delete(resourceMap);
      }
      const rsw = `data/${resourceMap}.rsw`;
      const { gnd, gat } = rswReferences(await read(rsw), rsw);
      const [ground, altitude] = await Promise.all([read(gnd), read(gat)]);
      const groundSize = dimensions(ground, 'GRGN', gnd);
      const { width, height } = dimensions(altitude, 'GRAT', gat);
      if (width !== groundSize.width * 2 || height !== groundSize.height * 2) {
        throw failure(`地图地形与坐标资源的尺寸不一致：${rsw}`, 'INVALID_RESOURCE', gat);
      }
      ensureActive();
      const metadata = { width, height, rsw, gnd, gat };
      // Commit only after the whole route succeeds; a failed or cancelled peer
      // must not leave freshly validated metadata behind.
      stagedMetadata.set(resourceMap, { metadata, expires: Date.now() + cacheLifetime });
      return metadata;
    }

    try {
      const names = [...new Set(points.map((point) => point.mapname))];
      // Match MapRenderer's physical instance name while retaining the full
      // server ID in the returned maps and each coordinate check.
      const physicalName = (name) => name.replace(/^(\d{3})(\d@)/, '$2').replace(/^\d{3}#/, '');
      const physicalMaps = [...new Set(names.map(physicalName))];
      const validated = new Map();
      let nextMap = 0;
      async function worker() {
        while (nextMap < physicalMaps.length) {
          ensureActive();
          const resourceMap = physicalMaps[nextMap++];
          const metadata = await validateMap(resourceMap);
          ensureActive();
          validated.set(resourceMap, metadata);
        }
      }
      await Promise.all(Array.from({ length: Math.min(2, physicalMaps.length) }, () => worker()));
      const maps = names.map((name) => {
        const metadata = validated.get(physicalName(name));
        const { width, height, gat } = metadata;
        for (const point of points) {
          if (point.mapname === name && (point.x >= width || point.y >= height)) {
            throw failure(`地图 ${name} 的坐标超出范围，请重新选择。`, 'OUT_OF_BOUNDS', gat);
          }
        }
        return { mapname: name, ...metadata };
      });
      ensureActive();
      for (const [resourceMap, cached] of stagedMetadata) {
        metadataCache.delete(resourceMap);
        metadataCache.set(resourceMap, cached);
      }
      while (metadataCache.size > cacheLimit) metadataCache.delete(metadataCache.keys().next().value);
      return { approved: true, token, maps };
    } finally {
      if (active === request) {
        active = null;
        request.abort();
      }
    }
  }

  return { check, cancel };
}
