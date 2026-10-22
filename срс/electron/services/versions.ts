
async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import {
  getVersionList,
  getLoaderArtifactListFor,
  getQuiltVersionsList,
  getForgeVersionList,
} from '@xmcl/installer';



export type Loader = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';

export interface GameVersion {
  id: string;
  type: string;
  releaseTime: string;
}


export interface LoaderVersion {
  version: string;
  stable: boolean;
  recommended: boolean;
  note?: string;
}

let gameCache: { at: number; list: GameVersion[] } | null = null;


export type Channel = 'release' | 'snapshot' | 'old';

export async function gameVersions(channel: Channel = 'release'): Promise<GameVersion[]> {
  
  if (!gameCache || Date.now() - gameCache.at > 30 * 60_000) {
    const list = await getVersionList();
    gameCache = {
      at: Date.now(),
      list: list.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
    };
  }
  if (channel === 'snapshot') return gameCache.list.filter((v) => v.type === 'snapshot');
  if (channel === 'old') return gameCache.list.filter((v) => v.type.startsWith('old_'));
  return gameCache.list.filter((v) => v.type === 'release');
}


async function neoforgeVersions(minecraft: string): Promise<LoaderVersion[]> {
  const parts = minecraft.split('.');
  if (parts[0] !== '1' || !parts[1]) return [];
  const prefix = `${parts[1]}.${parts[2] ?? '0'}.`;

  const response = await redactedFetch(
    'REDACTED_ENDPOINT',
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { versions?: string[] };

  const matching = (body.versions ?? []).filter((v) => v.startsWith(prefix)).reverse();
  return matching.map((version, index) => ({
    version,
    stable: !version.includes('beta'),
    recommended: index === 0,
  }));
}

/** Все версии выбранного загрузчика под выбранную версию Minecraft, новые первыми. */
export async function loaderVersions(loader: Loader, minecraft: string): Promise<LoaderVersion[]> {
  if (loader === 'vanilla') return [];

  if (loader === 'fabric') {
    const artifacts = await getLoaderArtifactListFor(minecraft);
    return artifacts.map((artifact, index) => ({
      version: artifact.loader.version,
      stable: artifact.loader.stable,
      recommended: index === 0,
    }));
  }

  if (loader === 'quilt') {
    // У Quilt список не зависит от версии игры: показываем все, новейшая выбрана.
    const artifacts = await getQuiltVersionsList();
    return artifacts.map((artifact, index) => ({
      version: artifact.version,
      stable: !artifact.version.includes('beta'),
      recommended: index === 0,
    }));
  }

  if (loader === 'forge') {
    const list = await getForgeVersionList({ minecraft });
    return list.versions.map((v) => ({
      version: v.version,
      stable: v.type === 'common' || v.type === 'recommended',
      recommended: v.type === 'recommended' || v.type === 'latest',
      note: v.type,
    }));
  }

  return neoforgeVersions(minecraft);
}
