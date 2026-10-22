
async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiBase, UA } from './site.js';
import { cacheDir } from './paths.js';



const BASE = 'REDACTED_ENDPOINT';
const TTL = 6 * 60 * 60 * 1000;
const RETRY = 30 * 60 * 1000;

export interface MojangNews {
  id: string;
  title: string;
  text: string;
  image: string;
  link: string;
  date: string;
}

export interface MojangFeed {
  
  versions: Record<string, string>;
  news: MojangNews[];
  fetchedAt: number;
  
  translated?: boolean;
}

const CACHE_FILE = () => join(cacheDir(), 'mojang.json');

let feed: MojangFeed | null = null;
let loading: Promise<MojangFeed> | null = null;

function readCache(): MojangFeed | null {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE(), 'utf8')) as MojangFeed;
    return raw.versions && Array.isArray(raw.news) ? raw : null;
  } catch {
    return null;
  }
}


function imageUrl(path: unknown): string {
  const value = String(path ?? '');
  if (!/^\/v2\/images\/[\w.%-]+\.(?:jpe?g|png|webp)$/i.test(value)) return '';
  return BASE + value;
}

async function fetchJson(path: string): Promise<{ entries?: unknown[] }> {
  const response = await redactedFetch(BASE + path, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Mojang ответил ${response.status}`);
  return (await response.json()) as { entries?: unknown[] };
}

async function refresh(): Promise<MojangFeed> {
  const [notes, news] = await Promise.all([fetchJson('/v2/javaPatchNotes.json'), fetchJson('/v2/news.json')]);
  const versions: Record<string, string> = {};
  for (const entry of (notes.entries ?? []) as Array<{ version?: string; image?: { url?: string } }>) {
    const url = imageUrl(entry.image?.url);
    // Лента идёт от новых к старым: первая картинка версии - самая свежая.
    if (entry.version && url && !versions[entry.version]) versions[entry.version] = url;
  }
  const items: MojangNews[] = [];
  for (const entry of (news.entries ?? []) as Array<Record<string, any>>) {
    // Только новости про Java Edition: Dungeons и Bedrock нашим игрокам ни к чему.
    if (!Array.isArray(entry.newsType) || !entry.newsType.includes('Java')) continue;
    const image = imageUrl(entry.newsPageImage?.url);
    const link = String(entry.readMoreLink ?? '');
    if (!image || !/^https:\/\/(www\.)?minecraft\.net\//.test(link)) continue;
    items.push({
      id: String(entry.id ?? link),
      title: String(entry.title ?? ''),
      text: String(entry.text ?? ''),
      image,
      link,
      date: String(entry.date ?? ''),
    });
    if (items.length >= 6) break;
  }
  const translated = await translate(items);
  const fresh = { versions, news: items, fetchedAt: Date.now(), translated };
  try { writeFileSync(CACHE_FILE(), JSON.stringify(fresh), 'utf8'); } catch { /* не записали кэш - не беда */ }
  return fresh;
}

/** Подставляет русские заголовки и подписи с нашего сайта. true - перевод пришёл. */
async function translate(items: MojangNews[]): Promise<boolean> {
  try {
    // Первый запрос после свежей новости ждёт перевода на сайте, поэтому таймаут побольше.
    const response = await redactedFetch(`${apiBase()}/api/launcher/mojang-news`, { headers: UA, signal: AbortSignal.timeout(40_000) });
    const body = (await response.json()) as { ok?: boolean; items?: Record<string, { title?: string; text?: string }> };
    if (!body.ok || !body.items) return false;
    let all = true;
    for (const item of items) {
      const ru = body.items[item.id];
      if (!ru?.title) { all = false; continue; }
      item.title = ru.title;
      item.text = ru.text || item.text;
    }
    return all;
  } catch {
    return false;
  }
}

/** Лента: из памяти, с диска или из сети. Без сети и без кэша - пустая, обложки останутся свои. */
export async function get(): Promise<MojangFeed> {
  feed ??= readCache();
  const age = feed ? Date.now() - feed.fetchedAt : Infinity;
  if (feed && age < (feed.translated ? TTL : RETRY)) return feed;
  loading ??= refresh()
    .then((fresh) => (feed = fresh))
    .catch(() => feed ?? { versions: {}, news: [], fetchedAt: 0 })
    .finally(() => { loading = null; });
  return loading;
}
