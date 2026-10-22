
async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import { BrowserWindow } from 'electron';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { load, update, MS_CLIENT_ID, type Account } from './store.js';



const AUTHORIZE_URL = 'REDACTED_ENDPOINT';
const TOKEN_URL = 'REDACTED_ENDPOINT';

const REDIRECT_URI = 'REDACTED_ENDPOINT';
const XBL_URL = 'REDACTED_ENDPOINT';
const XSTS_URL = 'REDACTED_ENDPOINT';
const MC_LOGIN_URL = 'REDACTED_ENDPOINT';
const MC_PROFILE_URL = 'REDACTED_ENDPOINT';
const SCOPE = 'XboxLive.signin offline_access';


function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = ((hash[6] as number) & 0x0f) | 0x30;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function addOffline(name: string): Account {
  const clean = name.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) {
    throw new Error('Ник: 3-16 символов, латиница, цифры и подчёркивание.');
  }
  // Ник разработчика - только с лицензией. Окно-розыгрыш показывает интерфейс (src/prank.ts).
  if (clean.toLowerCase() === 'drpowerx') throw new Error('Этот ник занят.');
  const account: Account = {
    id: randomUUID(),
    name: clean,
    uuid: offlineUuid(clean),
    kind: 'offline',
  };
  update((data) => {
    // Тот же ник второй раз не добавляем - заменяем старую запись.
    data.accounts = data.accounts.filter((a) => !(a.kind === 'offline' && a.name === clean));
    data.accounts.push(account);
    data.selectedAccount = account.id;
  });
  return account;
}

export function remove(id: string): void {
  update((data) => {
    data.accounts = data.accounts.filter((a) => a.id !== id);
    if (data.selectedAccount === id) data.selectedAccount = data.accounts[0]?.id ?? null;
  });
}

export function select(id: string): void {
  update((data) => {
    if (data.accounts.some((a) => a.id === id)) data.selectedAccount = id;
  });
}

function current(): Account | null {
  const data = load();
  return data.accounts.find((a) => a.id === data.selectedAccount) ?? null;
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clientId(): string {
  // В старых launcher.json это поле пустое - тогда берём встроенный id.
  return load().settings.msClientId.trim() || MS_CLIENT_ID;
}

/**
 * Открывает страницу входа Microsoft в отдельном окне и ждёт код авторизации.
 *
 * Окно без preload и без доступа к Node: страница не может дотянуться до лаунчера, а пароль
 * вводится на сайте Microsoft и через лаунчер не проходит. Вместо client secret используется PKCE.
 *
 * Локальный сервер не нужен: переход на REDIRECT_URI отменяется в последний момент,
 * а код к этому времени уже лежит в адресе.
 */
function authorize(parent: BrowserWindow | null): Promise<{ code: string; verifier: string }> {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  const url = `${AUTHORIZE_URL}?` + new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  return new Promise((resolve, reject) => {
    const window_ = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      autoHideMenuBar: true,
      title: 'Вход через Microsoft',
      backgroundColor: '#ffffff',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'ms-signin' },
    });

    let settled = false;
    const finish = (error: Error | null, result?: { code: string; verifier: string }) => {
      if (settled) return;
      settled = true;
      // destroy, а не close: иначе сработает 'closed' и отменит уже успешный вход.
      if (!window_.isDestroyed()) window_.destroy();
      if (error) reject(error); else resolve(result!);
    };

    // true - адрес оказался нашим возвратом, переход надо отменить.
    const inspect = (raw: string): boolean => {
      // Сравниваем разобранный адрес целиком, а не начало строки: «...nativeclient.evil» не наш возврат.
      let parsed: URL;
      try { parsed = new URL(raw); } catch { return false; }
      if (parsed.origin + parsed.pathname !== REDIRECT_URI) return false;
      const params = parsed.searchParams;
      const error = params.get('error');
      if (error) {
        finish(new Error(
          error === 'access_denied'
            ? 'Доступ не выдан - вход отменён на странице Microsoft.'
            : params.get('error_description') ?? error,
        ));
      } else if (params.get('state') !== state) {
        finish(new Error('Ответ Microsoft не совпал с запросом. Попробуй войти ещё раз.'));
      } else {
        const code = params.get('code');
        if (code) finish(null, { code, verifier });
        else finish(new Error('Microsoft не вернул код авторизации.'));
      }
      return true;
    };

    // Нужны оба события: редирект приходит в 'will-redirect', отправка формы - в 'will-navigate'.
    window_.webContents.on('will-redirect', (event, raw) => { if (inspect(raw)) event.preventDefault(); });
    window_.webContents.on('will-navigate', (event, raw) => { if (inspect(raw)) event.preventDefault(); });
    window_.on('closed', () => finish(new Error('Вход отменён.')));

    void window_.loadURL(url).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/**
 * Сколько ждём ответа от серверов Microsoft, Xbox и Mojang. Без предела вход мог висеть вечно:
 * кнопка крутится, а сервер просто молчит. 20 секунд с запасом хватает даже на медленную сеть.
 */
const NET_TIMEOUT = 20_000;

/** Полный вход: окно Microsoft, затем Xbox, затем профиль Minecraft. */
export async function signInMicrosoft(parent: BrowserWindow | null): Promise<Account> {
  const { code, verifier } = await authorize(parent);

  const response = await redactedFetch(TOKEN_URL, {
    signal: AbortSignal.timeout(NET_TIMEOUT),
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      scope: SCOPE,
    }),
  });
  const body = (await response.json()) as Record<string, string | number>;
  if (!response.ok) throw new Error(String(body.error_description ?? 'Microsoft отклонил вход.'));

  return await minecraftAccount(
    String(body.access_token),
    String(body.refresh_token ?? ''),
    Number(body.expires_in ?? 3600),
  );
}

/** Токен Microsoft → токен Xbox Live → токен XSTS (+ uhs, идентификатор пользователя Xbox). */
async function xboxChain(msAccessToken: string): Promise<{ token: string; uhs: string }> {
  const xbl = await redactedFetch(XBL_URL, {
    signal: AbortSignal.timeout(NET_TIMEOUT),
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'REDACTED_ENDPOINT',
      TokenType: 'JWT',
    }),
  });
  if (!xbl.ok) throw new Error('Xbox Live отклонил вход.');
  const xblBody = (await xbl.json()) as { Token: string; DisplayClaims: { xui: { uhs: string }[] } };

  const xsts = await redactedFetch(XSTS_URL, {
    signal: AbortSignal.timeout(NET_TIMEOUT),
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblBody.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  });
  if (xsts.status === 401) {
    const body = (await xsts.json().catch(() => ({}))) as { XErr?: number };
    // По XErr различаем «нет профиля Xbox» и «детский аккаунт» - чинятся они по-разному.
    if (body.XErr === 2148916233) {
      throw new Error('У этой учётной записи Microsoft нет профиля Xbox. Зайди на xbox.com и создай его.');
    }
    if (body.XErr === 2148916238) {
      throw new Error('Детская учётная запись: её нужно добавить в семью на account.microsoft.com.');
    }
    throw new Error(`Xbox отказал во входе (XErr ${body.XErr ?? '?'}).`);
  }
  if (!xsts.ok) throw new Error(`XSTS отклонил вход (${xsts.status}).`);
  const xstsBody = (await xsts.json()) as { Token: string; DisplayClaims: { xui: { uhs: string }[] } };

  const uhs = xstsBody.DisplayClaims.xui[0]?.uhs ?? xblBody.DisplayClaims.xui[0]?.uhs;
  if (!uhs) throw new Error('Xbox не вернул идентификатор пользователя.');
  return { token: xstsBody.Token, uhs };
}

/** Из токена Microsoft получает аккаунт Minecraft и сохраняет его выбранным. */
async function minecraftAccount(
  msAccessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<Account> {
  const { token, uhs } = await xboxChain(msAccessToken);

  const login = await redactedFetch(MC_LOGIN_URL, {
    signal: AbortSignal.timeout(NET_TIMEOUT),
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${token}` }),
  });
  if (!login.ok) {
    // Показываем ответ Mojang: из него понятно, какой именно отказ. Секретов в нём нет.
    const detail = (await login.text()).slice(0, 300);
    throw new Error(`Minecraft не принял токен Xbox (${login.status}). ${detail}`);
  }
  const loginBody = (await login.json()) as { access_token: string };

  const profile = await redactedFetch(MC_PROFILE_URL, {
    signal: AbortSignal.timeout(NET_TIMEOUT),
    headers: { authorization: `Bearer ${loginBody.access_token}` },
  });
  if (profile.status === 404) throw new Error('На этом аккаунте нет купленного Minecraft.');
  if (!profile.ok) throw new Error('Не удалось прочитать профиль Minecraft.');
  const profileBody = (await profile.json()) as { id: string; name: string };

  const account: Account = {
    id: profileBody.id,
    name: profileBody.name,
    uuid: profileBody.id,
    kind: 'microsoft',
    accessToken: loginBody.access_token,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  update((data) => {
    data.accounts = data.accounts.filter((a) => a.id !== account.id);
    data.accounts.push(account);
    data.selectedAccount = account.id;
  });
  return account;
}

/** Продлевает сессию Microsoft по refresh-токену. null - нужно войти заново. */
async function refreshMicrosoft(account: Account): Promise<Account | null> {
  if (account.kind !== 'microsoft' || !account.refreshToken) return null;

  const response = await redactedFetch(TOKEN_URL, {
    signal: AbortSignal.timeout(NET_TIMEOUT),
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId(),
      scope: SCOPE,
      refresh_token: account.refreshToken,
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as Record<string, string | number>;
  try {
    return await minecraftAccount(
      String(body.access_token),
      String(body.refresh_token ?? account.refreshToken),
      Number(body.expires_in ?? 3600),
    );
  } catch {
    return null;
  }
}

/** Живой токен Minecraft для аккаунта Microsoft: если сессия истекает, сначала продлевает. */
export async function microsoftToken(id: string): Promise<string> {
  const account = load().accounts.find((a) => a.id === id);
  if (!account || account.kind !== 'microsoft') throw new Error('Это не аккаунт Microsoft.');
  const fresh = account.expiresAt && account.expiresAt - 120_000 > Date.now()
    ? account
    : await refreshMicrosoft(account);
  if (!fresh?.accessToken) throw new Error('Сессия Microsoft истекла. Войди в аккаунт заново.');
  return fresh.accessToken;
}

/** Выбранный аккаунт для запуска игры. Если сессия истекает (запас 2 минуты) - сначала продлевает. */
export async function forLaunch(): Promise<Account | null> {
  const account = current();
  if (!account) return null;
  if (account.kind === 'offline') return account;
  if (account.expiresAt && account.expiresAt - 120_000 > Date.now()) return account;
  return (await refreshMicrosoft(account)) ?? account;
}
