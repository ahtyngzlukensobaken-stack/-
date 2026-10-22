

export interface CrashAutofix {
  kind: 'update' | 'disable';
  label: string;
  
  nameHints: string[];
}

export interface CrashReport {
  title: string;
  summary: string;
  details: string;
  
  autofixes: CrashAutofix[];
  
  reportPath?: string;
  
  steps: string[];
}


const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');


function fabricIncompatibleMods(text: string): CrashReport | null {
  if (!/Incompatible mods found|ModResolutionException/i.test(text)) return null;

  
  const solution = /Replace mod '([^']+)' \(([\w.-]+)\)[^\n]*/i.exec(text);
  const conflict = /Mod '([^']+)' \(([\w.-]+)\)[^\n]*is incompatible with[^\n]*mod '([^']+)' \(([\w.-]+)\)/i.exec(text);
  
  
  const floor = /or (?:earlier|older) of mod '([^']+)' \(([\w.-]+)\)/i.exec(text);

  const targetName = solution?.[1] ?? conflict?.[1];
  const targetId = solution?.[2] ?? conflict?.[2];
  if (!targetName || !targetId) {
    return {
      title: 'Моды поссорились друг с другом',
      summary: 'Fabric отказался запускаться из-за конфликта модов, но не смог назвать виноватого. '
        + 'Обычно помогает выключить моды, поставленные последними.',
      details: text,
      autofixes: [],
      steps: [
        'Открой сборку → вкладка «Моды» и выключи те, что ставил последними.',
        'Запусти игру: если пошла - включай моды обратно по одному, пока не найдёшь виноватого.',
      ],
    };
  }

  const otherName = conflict?.[1] === targetName ? conflict?.[3] : conflict?.[1];
  const autofixes: CrashAutofix[] = [];
  if (floor?.[1] && floor[2]) {
    autofixes.push({
      kind: 'update',
      label: `Обновить «${floor[1]}» и запустить снова`,
      nameHints: [fold(floor[1]), fold(floor[2])],
    });
  }
  // "Replace mod 'Sodium' ... with any version that is compatible with: minecraft 1.21.11" -
  // мод собран под другую версию игры, Fabric просит другую сборку этого же мода.
  if (solution?.[1] && solution[2]) {
    autofixes.push({
      kind: 'update',
      label: `Поставить подходящую версию «${solution[1]}» и запустить снова`,
      nameHints: [fold(solution[1]), fold(solution[2])],
    });
  }
  autofixes.push({
    kind: 'disable',
    label: `Отключить «${targetName}» и запустить снова`,
    nameHints: [fold(targetName), fold(targetId)],
  });

  return {
    title: 'Моды поссорились друг с другом',
    summary: otherName
      ? `Мод «${targetName}» не дружит с установленной версией «${otherName}». Можно обновить «${otherName}» `
        + `до свежей сборки либо отключить «${targetName}» и играть без него.`
      : `Мод «${targetName}» собран под другую версию игры. Можно заменить его на сборку под эту версию `
        + 'либо отключить и играть без него.',
    details: text,
    autofixes,
    steps: ['Если кнопки не помогли - выключи «' + targetName + '» во вкладке «Моды» вручную.'],
  };
}

/** Мод требует другой мод, которого нет. Самая частая ошибка после ручной установки jar. */
function missingDependency(text: string): CrashReport | null {
  const match = /requires (?:any |version )?[^\n]*?of (?:mod )?'?([^',\n]+)'?[^\n]*?, which is missing/i.exec(text)
    ?? /Missing required dependenc(?:y|ies)[^\n]*?:?\s*([\w .-]+)/i.exec(text)
    ?? /Mod ([\w .-]+) requires [^\n]+ but it is missing/i.exec(text);
  if (!match) return null;
  const needed = (match[1] ?? '').trim();

  return {
    title: 'Моду не хватает другого мода',
    summary: needed
      ? `Один из модов не запускается без «${needed}» - этого мода в сборке нет. Поставь его во вкладке «Контент», `
        + 'и игра пойдёт.'
      : 'Одному из модов нужен другой мод, которого нет в сборке.',
    details: text,
    autofixes: [],
    steps: [
      needed ? `Найди «${needed}» во вкладке «Контент» и поставь в эту сборку.` : 'Посмотри в логе, какого мода не хватает.',
      'Не хочешь ставить - выключи мод, который его требует.',
    ],
  };
}

/** Ошибка миксинов: мод лезет в код игры и не находит того, что ожидал. Почти всегда - старый мод. */
function mixinFailure(text: string): CrashReport | null {
  if (!/Mixin apply failed|MixinApplyError|MixinTransformerError|InjectionError/i.test(text)) return null;
  // "Mixin apply failed sodium.mixins.json:..." - имя файла миксинов начинается с id мода.
  const guilty = /Mixin apply failed ([\w.-]+?)[.:]/i.exec(text)?.[1]
    ?? /from mod ([\w.-]+)/i.exec(text)?.[1];

  return {
    title: guilty ? `Мод «${guilty}» не подошёл к этой версии игры` : 'Мод не подошёл к этой версии игры',
    summary: 'Мод пытается вмешаться в код игры и не находит того, что ожидал. Так бывает, когда мод собран '
      + 'под другую версию Minecraft. Помогает обновление мода, а если свежей сборки нет - отключение.',
    details: text,
    autofixes: guilty
      ? [
          { kind: 'update', label: `Обновить «${guilty}» и запустить снова`, nameHints: [fold(guilty)] },
          { kind: 'disable', label: `Отключить «${guilty}» и запустить снова`, nameHints: [fold(guilty)] },
        ]
      : [],
    steps: ['Проверь обновления во вкладке «Моды» → «Обновить всё».'],
  };
}

/** Видеокарта и драйверы. Для нашего мода про графику - самый ожидаемый вылет. */
function graphics(text: string): CrashReport | null {
  if (!/Pixel format not accelerated|Failed to create window|GLFW error|No OpenGL context|OpenGL 3\.2|EXCEPTION_ACCESS_VIOLATION[\s\S]{0,400}(nvoglv|atio|ig\dicd|opengl)/i.test(text)) {
    return null;
  }
  return {
    title: 'Не справилась видеокарта или драйвер',
    summary: 'Игра не смогла создать окно или упала внутри видеодрайвера. Код игры тут ни при чём - '
      + 'дело в драйвере видеокарты или в шейдерах, которые она не тянет.',
    details: text,
    autofixes: [],
    steps: [
      'Обнови драйвер видеокарты с сайта NVIDIA, AMD или Intel.',
      'Если в сборке стоят шейдеры - выключи их и попробуй снова.',
      'На ноутбуке проверь, что игра запускается на дискретной видеокарте, а не на встроенной.',
    ],
  };
}

/** Java слишком старая для этой версии Minecraft - дело не в модах. */
function wrongJava(text: string): CrashReport | null {
  if (!/UnsupportedClassVersionError|class file version|Unsupported major\.minor/i.test(text)) return null;
  return {
    title: 'Не та версия Java',
    summary: 'Игра запущена на слишком старой Java. Свежим версиям Minecraft нужна Java 21.',
    details: text,
    autofixes: [],
    steps: [
      'Открой «Настройки» → «Java» и выбери версию 21, если она в списке.',
      'Её нет в списке - поставь JDK 21 и нажми «Обновить список».',
    ],
  };
}

/** Не хватило памяти, выделенной игре. */
function outOfMemory(text: string): CrashReport | null {
  if (!/OutOfMemoryError|Out of Memory Error/i.test(text)) return null;
  return {
    title: 'Игре не хватило памяти',
    summary: 'Оперативки, выделенной этой сборке, не хватило. Прибавь память - ползунок на экране сборки.',
    details: text,
    autofixes: [],
    steps: [
      'Открой сборку и подними ползунок «Память» на 1-2 ГБ.',
      'Больше половины оперативки компьютера отдавать не стоит: системе тоже нужно место.',
    ],
  };
}

/** Файлы игры побились: чаще всего недокачанный или подменённый jar. */
function corruptedFiles(text: string): CrashReport | null {
  if (!/Invalid or corrupt jarfile|zip file closed|ZipException|CorruptedFileException|Failed to verify/i.test(text)) return null;
  return {
    title: 'Побились файлы игры',
    summary: 'Часть файлов скачалась не полностью или повреждена. Лаунчер умеет докачать только недостающее, '
      + 'моды и миры при этом не трогаются.',
    details: text,
    autofixes: [],
    steps: ['Нажми «Играть» ещё раз: лаунчер предложит переустановить файлы игры и докачает недостающее.'],
  };
}

const DETECTORS = [
  fabricIncompatibleMods, missingDependency, mixinFailure, graphics, wrongJava, outOfMemory, corruptedFiles,
];

/**
 * Разбирает вылет. Возвращает отчёт ВСЕГДА - даже когда причина непонятна.
 *
 * `tail` - последние строки вывода игры, `report` - текст файла crash-reports, если он есть.
 * Ищем по обоим: в файле причина написана понятнее, а в выводе видно то, что случилось до него.
 */
export function analyze(tail: string, report?: { path: string; text: string } | null, exitCode?: number): CrashReport {
  const haystack = report ? `${report.text}\n${tail}` : tail;

  for (const detector of DETECTORS) {
    const found = detector(haystack);
    if (found) return { ...found, reportPath: report?.path };
  }

  // Причину не узнали - но молчать нельзя. Отдаём то, что есть: игра закрылась, вот лог, вот что делать.
  const description = /Description: (.+)/i.exec(report?.text ?? '')?.[1]?.trim();
  return {
    title: description ? `Игра вылетела: ${description}` : 'Игра неожиданно закрылась',
    summary: report
      ? 'Игра успела написать отчёт о вылете - он ниже и в файле. Что именно сломалось, лаунчер не опознал.'
      : `Игра завершилась с ошибкой${exitCode ? ` (код ${exitCode})` : ''}, не оставив отчёта. Обычно так бывает, `
        + 'когда падение случилось совсем в начале запуска.',
    details: report?.text ?? tail,
    autofixes: [],
    reportPath: report?.path,
    steps: [
      'Выключи моды, которые ставил последними, и попробуй снова.',
      'Загляни на экран «Логи» - там весь вывод игры целиком.',
      'Если не понятно - скопируй отчёт кнопкой ниже и покажи его нам: по нему причина видна.',
    ],
  };
}
