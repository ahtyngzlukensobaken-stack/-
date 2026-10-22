import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('share-src');
const codeRoots = [path.join(root, 'src'), path.join(root, 'electron')];

async function files(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  }));
  return nested.flat();
}

function stripTsComments(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const ranges = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      ranges.push([scanner.getTokenPos(), scanner.getTextPos()]);
    }
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
  }
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const [start, end] = ranges[index];
    source = source.slice(0, start) + source.slice(end);
  }
  return source;
}

function redactStringTokens(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const ranges = [];
  const strings = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);
  for (;;) {
    const kind = scanner.scan();
    if (strings.has(kind)) {
      const text = scanner.getTokenText().replace(/(?:https?|wss?):\/\/[^\s'"`$\\{}()<>]+/gi, 'REDACTED_ENDPOINT');
      ranges.push([scanner.getTokenPos(), scanner.getTextPos(), text]);
    }
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
  }
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const [start, end, text] = ranges[index];
    source = source.slice(0, start) + text + source.slice(end);
  }
  return source.replace(/[–—]/g, '-');
}

const allFiles = (await Promise.all(codeRoots.map(files))).flat();
for (const file of allFiles) {
  const source = await fs.readFile(file, 'utf8');
  if (/\.(?:ts|js|cjs|d\.ts)$/.test(file)) {
    await fs.writeFile(file, redactStringTokens(stripTsComments(source)));
  } else if (file.endsWith('.css')) {
    await fs.writeFile(file, source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[–—]/g, '-'));
  } else if (file.endsWith('.html')) {
    await fs.writeFile(file, source.replace(/<!--[\s\S]*?-->/g, '').replace(/[–—]/g, '-'));
  }
}

const blockedFetch = `\nasync function redactedFetch(..._args: unknown[]): Promise<never> {\n  throw new Error('Сетевой запрос');\n}\n`;
const blockedSocket = `\nfunction redactedSocket(..._args: unknown[]): never {\n  throw new Error('Сетевое соединение');\n}\n`;
for (const file of allFiles.filter((entry) => entry.endsWith('.ts'))) {
  let source = await fs.readFile(file, 'utf8');
  if (/\bfetch\s*\(/.test(source)) {
    source = `${blockedFetch}${source.replace(/\bfetch\s*\(/g, 'redactedFetch(')}`;
  }
  if (/new WebSocket\s*\(/.test(source)) {
    source = `${blockedSocket}${source.replace(/new WebSocket\s*\(/g, 'redactedSocket(')}`;
  }
  await fs.writeFile(file, source);
}

const indexPath = path.join(root, 'src', 'index.html');
await fs.writeFile(indexPath, `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; media-src 'self' blob:; connect-src 'none'; frame-src 'none'">
  <title>Power Launcher</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./app.ts"></script>
</body>
</html>
`);

const socialPath = path.join(root, 'src', 'social.ts');
let social = await fs.readFile(socialPath, 'utf8');
social = social.replace(/const loadedFaces[\s\S]*?\n}\n\nasync function squareWebp/, `export function face(uuid: string, name: string, cls = 'fr-face'): HTMLElement {
  return el('span', { class: cls }, name.slice(0, 1).toUpperCase());
}

async function squareWebp`);
social = social.replace(/const LINK[\s\S]*?\n}\n\nfunction viewImage/, `const LINK = /$^/g;

function linkify(text: string): (string | HTMLElement)[] {
  return [text];
}

function imageOf(_body: string): string | null {
  return null;
}

function viewImage`);
await fs.writeFile(socialPath, social);

const prankPath = path.join(root, 'src', 'prank.ts');
let prank = await fs.readFile(prankPath, 'utf8');
prank = prank.replace(/export function devPrank\(\): void \{[\s\S]*?\n}\n?$/, `export function devPrank(): void {
  modal({ title: 'Недоступно', note: ' тут рик рол ес че', content: () => el('div') });
}
`);
await fs.writeFile(prankPath, prank);

const modsPath = path.join(root, 'electron', 'services', 'mods.ts');
let mods = await fs.readFile(modsPath, 'utf8');
mods = `const redactedClient = (): any => new Proxy({}, { get: () => async () => { throw new Error('Сетевой клиент .'); } });\n${mods}`
  .replace(/new ModrinthV2Client\(\)/g, 'redactedClient()')
  .replace(/new CurseforgeV1Client\('', \{ baseUrl: base \}\)/g, 'redactedClient()');
await fs.writeFile(modsPath, mods);

const presencePath = path.join(root, 'electron', 'services', 'presence.ts');
let presence = await fs.readFile(presencePath, 'utf8');
presence = `const noPresenceClient = (): any => new Proxy({}, { get: () => () => undefined });\n${presence}`
  .replace(/const CLIENT_ID\s*=\s*[^;]+;/, "const CLIENT_ID = '';")
  .replace(/new Client\(\{ clientId: CLIENT_ID \}\)/g, 'noPresenceClient()');
await fs.writeFile(presencePath, presence);

const accountsPath = path.join(root, 'electron', 'services', 'accounts.ts');
let accounts = await fs.readFile(accountsPath, 'utf8');
accounts = accounts.replace(/const MS_CLIENT_ID\s*=\s*[^;]+;/, "const MS_CLIENT_ID = '';");
await fs.writeFile(accountsPath, accounts);

const storePath = path.join(root, 'electron', 'services', 'store.ts');
let store = await fs.readFile(storePath, 'utf8');
store = store.replace(/export const MS_CLIENT_ID\s*=\s*[^;]+;/, "export const MS_CLIENT_ID = '';");
await fs.writeFile(storePath, store);

const mainPath = path.join(root, 'electron', 'main.ts');
let main = await fs.readFile(mainPath, 'utf8');
main = `const redactedOpenExternal = async (..._args: unknown[]): Promise<void> => {};\nconst redactedUpdater = new Proxy({}, { get: () => () => Promise.resolve(undefined) });\n${main}`
  .replace(/shell\.openExternal/g, 'redactedOpenExternal')
  .replace(/autoUpdater\./g, 'redactedUpdater.');
await fs.writeFile(mainPath, main);

for (const file of allFiles) {
  if (!/\.(?:ts|js|cjs|d\.ts|css|html)$/.test(file)) continue;
  const source = await fs.readFile(file, 'utf8');
  if (/(?:https?|wss?):\/\//i.test(source)) throw new Error(`external address left in ${file}`);
  if (/const\s+(?:CLIENT_ID|MS_CLIENT_ID)\s*=\s*['"][^'"]+['"]/.test(source)) {
    throw new Error(`application identifier value left in ${file}`);
  }
}
