
async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir } from './paths.js';
import { load } from './store.js';
import { cleanNews, cleanStrings } from './guards.js';



export interface NewsItem {
  slug: string;
  title: string;
  body: string;
  tag: string;
  accent: 'cosmic' | 'kawaii' | 'aurora';
  link: string;
  pinned: number;
  at: number;
}

export interface Content {
  rev: number;
  news: NewsItem[];
  strings: Record<string, string>;
  
  source: 'network' | 'cache' | 'builtin';
  fetchedAt: number;
}


const BUILTIN: Record<string, string> = {
  'app.title': 'Power Launcher',
  'play.button': 'ИГРАТЬ',
  'library.empty': 'Сборок пока нет. Создай первую - это минута.',
  'offline.warning':
    'Серверы с проверкой лицензии такой аккаунт не пустят, скины и плащи работать не будут. ' +
    'Для одиночной игры, локальной сети и офлайн-серверов - нормально.',
  'curseforge.blocked': 'Автор запретил скачивание вне CurseForge',
  'memory.hint': 'Больше половины оперативки отдавать не стоит: система и сама игра начнут мешать друг другу.',
  'news.empty': 'Новостей пока нет.',
  'maintenance': 'false',
};

const CACHE_FILE = () => join(cacheDir(), 'content.json');

let current: Content = { rev: 0, news: [], strings: { ...BUILTIN }, source: 'builtin', fetchedAt: 0 };

function readCache(): Content | null {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE(), 'utf8')) as Content;
    if (typeof raw.rev !== 'number' || !raw.strings) return null;
    return { ...raw, news: cleanNews(raw.news), strings: cleanStrings(raw.strings), source: 'cache' };
  } catch {
    return null;
  }
}


export function boot(): Content {
  const cached = readCache();
  if (cached) current = { ...cached, strings: { ...BUILTIN, ...cached.strings } };
  return current;
}

export function get(): Content {
  return current;
}


export async function refresh(): Promise<Content> {
  const base = load().settings.contentUrl.replace(/\/+$/, '');
  const url = `${base}/api/launcher/content?since=${current.rev}`;
  try {
    const response = await redactedFetch(url, {
      headers: { 'user-agent': 'PowerVisualLauncher' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return current;

    const body = (await response.json()) as {
      ok?: boolean; rev?: number; unchanged?: boolean;
      news?: NewsItem[]; strings?: Record<string, string>;
    };
    if (!body.ok) return current;

    if (body.unchanged) {
      current = { ...current, source: 'network', fetchedAt: Date.now() };
      return current;
    }

    // Ответ сайта проверяем по форме: только строки нужной длины, ссылки только https.
    // Сломанный или подменённый ответ не должен уронить окно или подсунуть file:/javascript:.
    current = {
      rev: typeof body.rev === 'number' ? body.rev : 0,
      news: cleanNews(body.news),
      strings: { ...BUILTIN, ...cleanStrings(body.strings) },
      source: 'network',
      fetchedAt: Date.now(),
    };
    try {
      writeFileSync(CACHE_FILE(), JSON.stringify(current), 'utf8');
    } catch {
      // Не смогли записать кэш - не повод ронять обновление.
    }
    return current;
  } catch {
    return current;
  }
}
