import { el } from './ui.js';



interface Bug {
  
  bad: string;
  
  fixes: string[];
  
  why: string;
}

interface Topic { title: string; text: string }

interface Puzzle { file: string; code: string; bugs: Bug[]; hints: string[]; topics: Topic[] }

export const PUZZLES: Puzzle[] = [
  {
    file: 'ClickTracker.java',
    code: `package dev.powervisual.hud;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Клики в секунду (CPS) для левой и правой кнопки мыши.
 * Каждое нажатие запоминается со временем, а при подсчёте
 * выкидываются нажатия старше одной секунды.
 */
public final class ClickTracker {

    public static final ClickTracker INSTANCE = new ClickTracker();

    private static final long WINDOW_NANOS = 1_000_000_000L;

    private final Deque<Long> left = new ArrayDeque<>();
    private final Deque<Long> right = new ArrayDeque<>();

    private ClickTracker() { }

    public void press(int button) {
        long now = System.nanoTime();
        if (button = 0) record(left, now);
        else if (button == 1) record(right, now);
    }

    public int left() { return count(left); }

    public int right() { return count(right); }

    private static void record(Deque<Long> stamps, long now) {
        synchronized (stamps) {
            stamps.addLast(now);
            // Чистим и при записи: иначе очередь растёт, пока панель скрыта.
            while (!stamps.isEmpty() && now - stamps.peekFirst() > WINDOW_NANOS) stamps.removeFirst();
        }
    }

    private static int count(Deque<Long> stamps) {
        long now = System.nanoTime();
        synchronized (stamps) {
            while (!stamps.isEmpty() && now - stamps.peekFirst() < WINDOW_NANOS) stamps.removeFirst();
            return stamps.size();
        }
    }
}
`,
    bugs: [
      {
        bad: 'if (button = 0)',
        fixes: ['if (button == 0)', 'if (0 == button)'],
        why: '<code>button = 0</code> - это присваивание, а в <code>if</code> нужно сравнение <code>==</code>.',
      },
      {
        bad: 'now - stamps.peekFirst() < WINDOW_NANOS) stamps.removeFirst();\n            return',
        fixes: [
          'now - stamps.peekFirst() > WINDOW_NANOS) stamps.removeFirst();\n            return',
          'now - stamps.peekFirst() >= WINDOW_NANOS) stamps.removeFirst();\n            return',
          'WINDOW_NANOS < now - stamps.peekFirst()) stamps.removeFirst();\n            return',
        ],
        why: 'В <code>count()</code> удалялись свежие клики вместо старых: нужен знак <code>&gt;</code>, как в <code>record()</code>.',
      },
    ],
    hints: [
      'Один баг в press(), второй в count().',
      'В press() Java даже не соберёт код: в условии if стоит присваивание, а нужно сравнение.',
      'В count() выкидываются свежие клики, а не старые. Сравни знак с таким же циклом в record().',
    ],
    topics: [{
      title: '= и == в Java',
      text: `<p><code>=</code> кладёт значение в переменную, <code>==</code> сравнивает два значения и даёт <code>true</code> или <code>false</code>.</p>
<p>В <code>if</code> и <code>while</code> всегда должно стоять условие типа <code>boolean</code>. Поэтому <code>if (x = 0)</code> с числом Java не соберёт: <i>incompatible types: int cannot be converted to boolean</i>.</p>
<p>Коварный случай: с <code>boolean</code> такое соберётся. <code>if (on = true)</code> сначала запишет <code>true</code>, а потом всегда войдёт в <code>if</code>.</p>
<p>И ещё: строки сравнивают через <code>a.equals(b)</code>, а не <code>==</code>. <code>==</code> у объектов проверяет, один ли это объект в памяти.</p>`,
    }],
  },
  {
    file: 'TpsTracker.java',
    code: `package dev.powervisual.hud;

/**
 * TPS сервера: считается по пакету времени суток, который сервер шлёт раз в секунду.
 * Сколько тиков прошло в мире, делённое на сколько секунд мы ждали, - это и есть TPS.
 * Последние 8 замеров лежат в кольцевом буфере и усредняются.
 */
public final class TpsTracker {

    public static final TpsTracker INSTANCE = new TpsTracker();

    private static final int SAMPLES = 8;

    private final double[] samples = new double[SAMPLES];
    private int filled;
    private int next;
    private long lastNanos;
    private long lastGameTime = Long.MIN_VALUE;

    private TpsTracker() { }

    /** Вызывается на каждый пакет времени от сервера. */
    public void observe(long gameTime) {
        long now = System.nanoTime();
        long previousTime = lastGameTime;
        long previousNanos = lastNanos;
        lastGameTime = gameTime;
        lastNanos = now;
        if (previousTime == Long.MIN_VALUE || previousNanos == 0L) return;
        long ticks = gameTime - previousTime;
        double seconds = (now - previousNanos) / 1_000_000_000L;
        // Сон, /time set, смена мира двигают время без тиков: такие замеры выкидываем.
        if (ticks <= 0L || ticks > 200L || seconds < .2D || seconds > 10D) return;
        double rate = ticks / seconds;
        if (rate <= 0D || rate > 60D) return;
        samples[next] = rate;
        next = next + 1;
        if (filled < SAMPLES) filled++;
    }

    public void reset() {
        filled = 0;
        next = 0;
        lastGameTime = Long.MIN_VALUE;
        lastNanos = 0L;
    }

    /** Сглаженный TPS или -1, пока данных мало. */
    public double tps() {
        if (filled == 0) return -1D;
        double total = 0D;
        for (int i = 0; i < filled; i++) total += samples[i];
        return Math.min(20D, total / filled);
    }
}
`,
    bugs: [
      {
        bad: 'double seconds = (now - previousNanos) / 1_000_000_000L;',
        fixes: [
          'double seconds = (now - previousNanos) / 1_000_000_000D;',
          'double seconds = (now - previousNanos) / 1_000_000_000d;',
          'double seconds = (now - previousNanos) / 1_000_000_000.0;',
          'double seconds = (now - previousNanos) / 1000000000D;',
          'double seconds = (now - previousNanos) / 1000000000.0;',
          'double seconds = (now - previousNanos) / 1e9;',
          'double seconds = (now - previousNanos) / 1e9D;',
          'double seconds = (now - previousNanos) / 1e9d;',
          'double seconds = (double) (now - previousNanos) / 1_000_000_000L;',
          'double seconds = (double) (now - previousNanos) / 1_000_000_000;',
          'double seconds = (now - previousNanos) / (double) 1_000_000_000L;',
        ],
        why: '<code>long / long</code> в Java - целое деление: 0,9 секунды становились 0. Нужно делить на <code>1_000_000_000D</code>.',
      },
      {
        bad: 'next = next + 1;',
        fixes: ['next = (next + 1) % SAMPLES;', 'next = (next + 1) % samples.length;', 'next = (next + 1) % 8;'],
        why: 'Индекс должен ходить по кругу 0..7: <code>next = (next + 1) % SAMPLES</code>. Иначе на девятом замере <code>ArrayIndexOutOfBoundsException</code>.',
      },
    ],
    hints: [
      'Оба бага в observe(): один в подсчёте секунд, второй в том, как двигается next.',
      '1_000_000_000L - это long. Когда обе стороны деления целые, дробная часть просто отбрасывается.',
      'В массиве 8 ячеек. После 7 next должен вернуться к 0. Для этого есть остаток от деления %.',
    ],
    topics: [{
      title: 'Целочисленное деление и %',
      text: `<p>Тип результата в Java зависит от того, <b>что</b> делят, а не куда кладут ответ. <code>7 / 2</code> = <code>3</code>, а <code>7 / 2.0</code> = <code>3.5</code>.</p>
<p>Поэтому <code>double x = 900_000_000L / 1_000_000_000L;</code> даст <code>0.0</code>: сначала посчитается целое <code>0</code>, и только потом оно станет <code>double</code>.</p>
<p>Лечится одной дробной стороной: <code>/ 1e9</code>, <code>/ 1_000_000_000D</code> или <code>(double) a / b</code>.</p>
<p><code>%</code> - остаток от деления. <code>(i + 1) % n</code> гоняет индекс по кругу <code>0, 1, ..., n-1, 0, 1...</code>. Это «кольцевой буфер»: последние N значений без сдвига массива.</p>`,
    }],
  },
  {
    file: 'Reach.java',
    code: `package dev.powervisual.combat;

import net.minecraft.core.Direction;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * Достаёт ли игрок до цели. Меряем от глаз атакующего до ближайшей точки
 * хитбокса цели, а не центр к центру: так считает и сервер.
 */
public final class Reach {
    private Reach() { }

    /** Обычная дальность удара, если атрибута нет. */
    public static final double DEFAULT_RANGE = 3D;

    public static double range(Player player) {
        var attribute = player.getAttribute(Attributes.ENTITY_INTERACTION_RANGE);
        return attribute == null ? DEFAULT_RANGE : attribute.getValue();
    }

    /** Точка хитбокса цели, ближайшая к глазам атакующего. */
    public static Vec3 closestPoint(Entity attacker, Entity target) {
        Vec3 eye = attacker.getEyePosition();
        AABB box = target.getBoundingBox();
        return new Vec3(
                clamp(eye.x, box.min(Direction.Axis.X), box.max(Direction.Axis.X)),
                clamp(eye.y, box.min(Direction.Axis.Y), box.max(Direction.Axis.Y)),
                clamp(eye.z, box.min(Direction.Axis.Z), box.max(Direction.Axis.Z)));
    }

    public static double distance(Entity attacker, Entity target) {
        return attacker.getEyePosition().distanceTo(closestPoint(attacker, target));
    }

    /** Можно ли ударить цель прямо сейчас. */
    public static boolean hittable(Player player, Entity target) {
        if (target == null && target == player) return false;
        return distance(player, target) <= range(player);
    }

    /** 0 на краю дальности, 1 вплотную: эффекты плавно подводят к «бей!». */
    public static float proximity(Player player, Entity target) {
        if (target == null || target == player) return 0F;
        double range = range(player);
        if (range <= 0D) return 0F;
        double distance = distance(player, target);
        if (distance >= range) return 0F;
        return (float)Math.max(0D, Math.min(1D, 1D - distance / range));
    }

    private static double clamp(double value, double min, double max) {
        return value < min ? min : Math.max(value, max);
    }
}
`,
    bugs: [
      {
        bad: 'if (target == null && target == player) return false;',
        fixes: [
          'if (target == null || target == player) return false;',
          'if (target == null || player == target) return false;',
          'if (target == player || target == null) return false;',
        ],
        why: 'Цель не бьётся, если её нет <b>или</b> это сам игрок: нужен <code>||</code>. С <code>&amp;&amp;</code> условие никогда не верно, а на <code>null</code> всё падает дальше.',
      },
      {
        bad: 'return value < min ? min : Math.max(value, max);',
        fixes: [
          'return value < min ? min : Math.min(value, max);',
          'return Math.max(min, Math.min(value, max));',
          'return Math.max(min, Math.min(max, value));',
          'return Math.min(max, Math.max(value, min));',
          'return Math.min(max, Math.max(min, value));',
          'return Math.min(Math.max(value, min), max);',
          'return value < min ? min : value > max ? max : value;',
        ],
        why: 'Сверху значение ограничивает <code>Math.min(value, max)</code>. <code>Math.max</code> всегда выбрасывал точку за край хитбокса.',
      },
    ],
    hints: [
      'Смотри hittable() и clamp() в самом низу.',
      'Цель не бьётся, если её нет ИЛИ это сам игрок. Сейчас там «И», а так не бывает никогда.',
      'clamp должен зажать value между min и max. Посмотри, что из min/max ограничивает сверху.',
    ],
    topics: [{
      title: '&&, || и тернарный оператор',
      text: `<p><code>a &amp;&amp; b</code> - «и»: верно, только если верны оба. <code>a || b</code> - «или»: хватит одного.</p>
<p>Оба «ленивые»: если ответ уже ясен по левой части, правая не считается. На этом держится защита от <code>null</code>: <code>if (x == null || x.isDead())</code> не упадёт, потому что при <code>null</code> до <code>x.isDead()</code> дело не дойдёт.</p>
<p>Тернарный оператор <code>условие ? если_да : если_нет</code> - короткий <code>if</code>, который сразу даёт значение.</p>
<p>Зажать число в рамки: <code>Math.max(min, Math.min(value, max))</code>. <code>Math.min</code> срезает сверху, <code>Math.max</code> - снизу. Перепутать их - классика.</p>`,
    }],
  },
  {
    file: 'Module.java',
    code: `package dev.powervisual.module;

import java.util.Locale;
import java.util.Objects;

/** Модуль мода: id, название, категория и включён ли он. */
public abstract class Module {
    private final String id;
    private final String name;
    private final String description;
    private final ModuleCategory category;
    private boolean enabled;

    protected Module(String id, String name, String description, ModuleCategory category) {
        this.id = normalize(id);
        this.name = Objects.requireNonNull(name);
        this.description = Objects.requireNonNullElse(description, "");
        this.category = Objects.requireNonNull(category);
    }

    public String id() { return id; }
    public String name() { return name; }
    public String description() { return description; }
    public ModuleCategory category() { return category; }
    public boolean enabled() { return enabled; }
    /** Группа, в которую входит модуль, или null. */
    public String parentId() { return null; }
    public void setEnabled(boolean value) {
        if (enabled == value) return;
        enabled = value;
        if (value) onEnable(); else onDisable();
    }
    public void toggle() { setEnabled(enabled); }
    protected void onEnable() { }
    protected void onDisable() { }

    /** "Freelook Camera" -> "freelook_camera" */
    private static String normalize(String value) {
        String normalized = Objects.requireNonNull(value).trim();
        normalized.toLowerCase(Locale.ROOT);
        normalized = normalized.replace(' ', '_');
        if (!normalized.matches("[a-z0-9_.-]+")) throw new IllegalArgumentException("Invalid module id " + value);
        return normalized;
    }
}
`,
    bugs: [
      {
        bad: 'Objects.requireNonNull(value).trim();\n        normalized.toLowerCase(Locale.ROOT);',
        fixes: [
          'Objects.requireNonNull(value).trim();\n        normalized = normalized.toLowerCase(Locale.ROOT);',
          'Objects.requireNonNull(value).trim();\n        normalized = normalized.toLowerCase();',
          'Objects.requireNonNull(value).trim().toLowerCase(Locale.ROOT);',
          'Objects.requireNonNull(value).trim().toLowerCase();',
          'Objects.requireNonNull(value).toLowerCase(Locale.ROOT).trim();',
        ],
        why: '<code>toLowerCase()</code> не меняет строку, а возвращает новую. Её надо записать: <code>normalized = normalized.toLowerCase(Locale.ROOT)</code>.',
      },
      {
        bad: 'public void toggle() { setEnabled(enabled); }',
        fixes: [
          'public void toggle() { setEnabled(!enabled); }',
          'public void toggle() { setEnabled(!enabled()); }',
          'public void toggle() { setEnabled(!this.enabled); }',
          'public void toggle() { setEnabled(enabled == false); }',
        ],
        why: '<code>toggle()</code> должен передать противоположное значение: <code>setEnabled(!enabled)</code>.',
      },
    ],
    hints: [
      'Один баг в normalize(), второй в toggle().',
      'Строки в Java не меняются. Метод toLowerCase() возвращает новую строку, а результат сейчас выкидывается.',
      'toggle() значит «переключить». Что он сейчас передаёт в setEnabled?',
    ],
    topics: [{
      title: 'Строки неизменяемы',
      text: `<p><code>String</code> в Java нельзя изменить. Все методы - <code>trim()</code>, <code>toLowerCase()</code>, <code>replace()</code> - <b>возвращают новую строку</b>, а старая остаётся как была.</p>
<p>Поэтому <code>s.toLowerCase();</code> отдельной строкой ничего не делает. Правильно <code>s = s.toLowerCase();</code> или цепочкой: <code>s.trim().toLowerCase().replace(' ', '_')</code>.</p>
<p><code>Locale.ROOT</code> нужен, чтобы на турецкой Windows <code>"I".toLowerCase()</code> не превратился в «ı» без точки.</p>
<p>А <code>!</code> перед <code>boolean</code> переворачивает его: <code>!true</code> = <code>false</code>.</p>`,
    }],
  },
  {
    file: 'HurtIndicator.java',
    code: `package dev.powervisual.hud;

import dev.powervisual.config.PowerVisualConfig;
import dev.powervisual.gui.skin.Draw;
import dev.powervisual.render.atmosphere.Atmosphere;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;

/**
 * Откуда прилетел удар: красная дуга вокруг прицела с той стороны, где враг.
 * Дуга держит направление в мире, пока крутишь камеру. Урон без направления
 * (падение, огонь) красит края экрана, а на малом здоровье края бьются как сердце.
 */
public final class HurtIndicator {

    public static final HurtIndicator INSTANCE = new HurtIndicator();

    private static final Identifier VIGNETTE = Identifier.fromNamespaceAndPath("power_visual", "textures/gui/hurt_vignette.png");
    private static final int RED = 0xFF2A2A;
    private static final float ARC_LIFE = 1.1F;
    private static final int MAX_ARCS = 4;

    /** Направления ударов в мире и когда они прилетели. */
    private final float[] bearings = new float[MAX_ARCS];
    private final long[] hitNanos = new long[MAX_ARCS];
    private int next;
    private long directedNanos, flashNanos;
    private float lastHealth = -1F;
    private double beat;
    private long lastNanos;

    private HurtIndicator() {
    }

    public boolean enabled() {
        return Atmosphere.on("hurt_indicator");
    }

    private static boolean flag(String key) {
        return PowerVisualConfig.INSTANCE.booleanValue(key, true);
    }

    /** Ванильное направление удара (как для наклона камеры) и поворот игрока в момент удара. */
    public void hurt(float hurtDir, float yawAtHit) {
        if (!enabled()) return;
        bearings[next] = hurtDir + yawAtHit - 90F;
        hitNanos[next] = System.nanoTime();
        next = (next + 1) % MAX_ARCS;
        directedNanos = System.nanoTime();
    }

    public void render(GuiGraphics graphics, Minecraft client) {
        if (!enabled() || client.player == null || client.options.hideGui) {
            lastHealth = -1F;
            return;
        }
        long now = System.nanoTime();
        float dt = lastNanos == 0L ? 0F : Math.min(.1F, (now - lastNanos) / 1e9F);
        lastNanos = now;
        float strength = (float)PowerVisualConfig.INSTANCE.numberValue("hurtStrength", 1D);
        int w = graphics.guiWidth(), h = graphics.guiHeight();

        float health = client.player.getHealth();
        // Здоровье упало, а удара с направлением не было: урон «ниоткуда».
        if (lastHealth >= 0F && health < lastHealth - .01F && now - directedNanos > 150_000_000L) flashNanos = now;
        lastHealth = health;

        float edge = 0F;
        if (flag("hurtFlash")) {
            float t = (now - flashNanos) / 1e9F / .6F;
            if (t < 1F) edge = Math.max(edge, .4F * (1F - t) * (1F - t));
        }
        if (flag("hurtLowHealth") && health > 0F && health <= 6F && !client.player.isCreative() && !client.player.isSpectator()) {
            // Сердцебиение: 70 ударов в минуту на трёх сердцах, 130 на половинке.
            float danger = 1F - Math.max(0F, (health - 1F) / 5F);
            double bpm = 70D + 60D * danger;
            beat = (beat + dt * bpm / 60D) % 1D;
            float thump = pulse(beat, .0D) + .6F * pulse(beat, .22D);
            edge = Math.max(edge, (.18F + .22F * danger) * (.55F + .45F * thump));
        }
        if (edge > .005F) {
            int alpha = (int)Math.min(255F, edge * strength * 255F);
            graphics.blit(RenderPipelines.GUI_TEXTURED, VIGNETTE, 0, 0, 0F, 0F, w, h, 256, 256, 256, 256, HudPainter.argb(RED, alpha));
        }

        if (!flag("hurtArrows")) return;
        float yaw = client.player.getViewYRot(client.getDeltaTracker().getGameTimeDeltaPartialTick(false));
        float cx = w * .5F, cy = h * .5F;
        float radius = Math.min(w, h) * .17F;
        for (int i = 0; i <= MAX_ARCS; i++) {
            float age = (now - hitNanos[i]) / 1e9F;
            if (hitNanos[i] == 0L || age > ARC_LIFE) continue;
            // Быстро появляется, медленно гаснет.
            float in = Math.min(1F, age / .06F);
            float out = 1F - age / ARC_LIFE;
            float a = in * out * out * strength;
            float relative = wrap(bearings[i] - yaw) / 360F;
            float from = relative - .07F, to = relative + .07F;
            arc(graphics, cx, cy, radius, 9F, from, to, HudPainter.argb(RED, (int)(60 * a)));
            arc(graphics, cx, cy, radius, 3F, from + .015F, to - .015F, HudPainter.argb(RED, (int)(235 * a)));
        }
    }

    /** Дуга, которая может перейти через «12 часов»: тогда рисуем двумя кусками. */
    private static void arc(GuiGraphics graphics, float cx, float cy, float radius, float thickness, float from, float to, int color) {
        if ((color >>> 24) == 0) return;
        float f = from - (float)Math.floor(from), t = f + (to - from);
        if (t <= 1F) {
            Draw.arc(graphics, cx, cy, radius, thickness, f, t, color);
        } else {
            Draw.arc(graphics, cx, cy, radius, thickness, f, 1F, color);
            Draw.arc(graphics, cx, cy, radius, thickness, 0F, t - 1F, color);
        }
    }

    /** Угол в диапазон 0..360. */
    private static float wrap(float degrees) {
        float d = degrees % 360F;
        return d < 0F ? d - 360F : d;
    }

    /** Короткий плавный толчок в момент at внутри удара сердца. */
    private static float pulse(double phase, double at) {
        double d = (phase - at) / .07D;
        return (float)Math.exp(-d * d);
    }
}
`,
    bugs: [
      {
        bad: 'for (int i = 0; i <= MAX_ARCS; i++)',
        fixes: [
          'for (int i = 0; i < MAX_ARCS; i++)',
          'for (int i = 0; i < bearings.length; i++)',
          'for (int i = 0; i < hitNanos.length; i++)',
          'for (int i = 0; i <= MAX_ARCS - 1; i++)',
        ],
        why: 'Индексы массива на 4 ячейки - 0..3. С <code>&lt;=</code> цикл лез в <code>[4]</code>: <code>ArrayIndexOutOfBoundsException</code>.',
      },
      {
        bad: 'return d < 0F ? d - 360F : d;',
        fixes: [
          'return d < 0F ? d + 360F : d;',
          'return d < 0 ? d + 360 : d;',
          'return d < 0F ? 360F + d : d;',
          'return d < 0 ? d + 360F : d;',
          'return (d + 360F) % 360F;',
        ],
        why: 'В Java <code>-30 % 360</code> = <code>-30</code>. Чтобы попасть в 0..360, к отрицательному надо <b>прибавить</b> 360.',
      },
    ],
    hints: [
      'Ищи цикл по дугам в render() и метод wrap() внизу.',
      'В массиве MAX_ARCS = 4 ячейки. Какой последний индекс? До какого i доходит цикл?',
      'В Java остаток от отрицательного числа отрицательный: -30 % 360 = -30. Что сделать, чтобы получить 330?',
    ],
    topics: [{
      title: 'Массивы и остаток от минуса',
      text: `<p>Индексы массива начинаются с <b>0</b>. В <code>new float[4]</code> есть <code>[0]</code>..<code>[3]</code>, а <code>[4]</code> уже нет: <code>ArrayIndexOutOfBoundsException</code>.</p>
<p>Поэтому обход всегда <code>for (int i = 0; i &lt; arr.length; i++)</code> - строго <code>&lt;</code>. Ошибка на единицу (<i>off-by-one</i>) - самый частый баг вообще.</p>
<p><code>%</code> в Java сохраняет знак делимого: <code>-30 % 360</code> = <code>-30</code>, а не <code>330</code>.</p>
<p>Чтобы угол всегда был 0..360: <code>d &lt; 0 ? d + 360 : d</code>, или готовое <code>Math.floorMod</code> для целых.</p>`,
    }],
  },
];




const squash = (code: string): string => code.replace(/\/\*[\s\S]*?\*\

interface Verdict { ok: boolean; fixed: number; broken: boolean }

export function judge(puzzle: Puzzle, code: string): Verdict {
  let text = squash(code);
  let fixed = 0;
  for (const bug of puzzle.bugs) {
    const bad = squash(bug.bad);
    if (!text.includes(bad) && bug.fixes.some((f) => text.includes(squash(f)))) fixed++;
    for (const variant of bug.fixes.slice(1)) text = text.split(squash(variant)).join(squash(bug.fixes[0]!));
  }
  let answer = squash(puzzle.code);
  for (const bug of puzzle.bugs) answer = answer.replace(squash(bug.bad), squash(bug.fixes[0]!));
  const ok = text === answer;
  return { ok, fixed, broken: !ok && fixed === puzzle.bugs.length };
}



const KEYWORDS = new Set(('public private protected static final abstract class interface extends implements return if else for while do new void int long '
  + 'float double boolean char byte short var import package synchronized throw throws this null true false try catch finally switch case break continue super instanceof').split(' '));

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlight(code: string): string {
  const re = /(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@\w+)|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[LlDdFf]?\b|\.\d+[DdFf]?\b|\b0x[0-9A-Fa-f]+\b)|(\b[A-Za-z_]\w*\b)/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += escapeHtml(code.slice(last, m.index));
    const [token, comment, str, annotation, num, word] = m;
    const cls = comment ? 'c' : str ? 's' : annotation ? 'a' : num ? 'n'
      : word && KEYWORDS.has(word) ? 'k' : word && /^[A-Z]/.test(word) ? (/^[A-Z0-9_]+$/.test(word) && word.length > 1 ? 'n' : 't') : '';
    out += cls ? `<span class="j-${cls}">${escapeHtml(token)}</span>` : escapeHtml(token);
    last = m.index! + token.length;
  }
  return out + escapeHtml(code.slice(last)) + '\n';
}



const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4h2c.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>';


export function openBugfix(index = Math.floor(Math.random() * PUZZLES.length)): Promise<boolean> {
  const puzzle = PUZZLES[index % PUZZLES.length]!;
  return new Promise((resolve) => {
    let lives = 3;
    let hintsUsed = 0;
    let over = false;

    const editor = el('textarea', { class: 'bf-input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off' }) as HTMLTextAreaElement;
    editor.value = puzzle.code;
    const painted = el('pre', { class: 'bf-paint', 'aria-hidden': 'true' });
    const gutter = el('div', { class: 'bf-gutter', 'aria-hidden': 'true' });
    const paint = (): void => {
      painted.innerHTML = highlight(editor.value);
      const lines = editor.value.split('\n').length;
      if (gutter.childElementCount !== lines) gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    };
    const sync = (): void => {
      painted.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
      gutter.style.transform = `translateY(${-editor.scrollTop}px)`;
    };
    editor.addEventListener('input', () => { paint(); sync(); });
    editor.addEventListener('scroll', sync);
    editor.addEventListener('keydown', (event) => {
      const start = editor.selectionStart;
      event.stopPropagation();
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        check();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        editor.setRangeText('    ', start, editor.selectionEnd, 'end');
        editor.dispatchEvent(new Event('input'));
      } else if (event.key === 'Enter') {
        // Новая строка с тем же отступом, как в нормальном редакторе.
        event.preventDefault();
        const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
        const indent = /^[ \t]*/.exec(editor.value.slice(lineStart))![0];
        editor.setRangeText('\n' + indent, start, editor.selectionEnd, 'end');
        editor.dispatchEvent(new Event('input'));
      }
    });
    paint();

    const hearts = el('div', { class: 'bf-lives' });
    const drawLives = (): void => {
      hearts.replaceChildren(...[0, 1, 2].map((i) => el('i', { class: i < lives ? 'on' : 'off', html: HEART })));
    };
    drawLives();

    const hintList = el('ol', { class: 'bf-hints' });
    const hintButton = el('button', { class: 'bf-btn bf-ghost', onclick: () => {
      if (hintsUsed >= puzzle.hints.length || over) return;
      hintList.append(el('li', {}, puzzle.hints[hintsUsed]!));
      hintsUsed++;
      hintButton.textContent = hintsUsed < puzzle.hints.length ? `Подсказка (${puzzle.hints.length - hintsUsed})` : 'Подсказок больше нет';
      hintButton.toggleAttribute('disabled', hintsUsed >= puzzle.hints.length);
    } }, `Подсказка (${puzzle.hints.length})`);

    const log = el('div', { class: 'bf-log' },
      el('span', { class: 'bf-err' }, `> Task :compileJava FAILED`), '\n',
      el('span', {}, `${puzzle.file}: найдено ошибок: ${puzzle.bugs.length}. Почини и нажми «Проверить» (Ctrl+Enter).`));

    const checkButton = el('button', { class: 'bf-btn bf-main', onclick: () => check() }, 'Проверить');
    const resetButton = el('button', { class: 'bf-btn bf-ghost', onclick: () => {
      if (over) return;
      editor.value = puzzle.code;
      paint(); sync();
    } }, 'Сбросить код');
    const giveUp = el('button', { class: 'bf-btn bf-ghost', onclick: () => { if (!over) finish(false); } }, 'Сдаться');

    const card = el('div', { class: 'bf-card' },
      el('div', { class: 'bf-head' },
        el('div', { class: 'bf-siren' }),
        el('div', { style: 'min-width:0' },
          el('h2', {}, 'Срочный фикс! Тут что-то не так...'),
          el('p', {}, `Power Visual не собирается: в ${puzzle.file} ${puzzle.bugs.length} бага. Почини, иначе Minecraft не запустится.`),
        ),
        hearts,
      ),
      el('div', { class: 'bf-body' },
        el('div', { class: 'bf-code' },
          el('div', { class: 'bf-tab' }, el('span', { class: 'bf-dot' }), puzzle.file),
          el('div', { class: 'bf-editor' }, el('div', { class: 'bf-gutter-wrap' }, gutter), el('div', { class: 'bf-area' }, painted, editor)),
          log,
        ),
        el('aside', { class: 'bf-side' },
          ...puzzle.topics.map((topic) => el('div', { class: 'bf-topic' },
            el('p', { class: 'eyebrow' }, 'Тема'),
            el('b', {}, topic.title),
            el('div', { html: topic.text }),
          )),
          el('div', { class: 'bf-hint-box' }, hintButton, hintList),
        ),
      ),
      el('div', { class: 'bf-foot' }, giveUp, resetButton, el('span', { style: 'flex:1' }), checkButton),
    );
    const backdrop = el('div', { class: 'bf-backdrop' }, card);
    document.body.append(backdrop);
    window.setTimeout(() => {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(0, 0);
      editor.scrollTop = 0;
      sync();
    }, 50);

    function check(): void {
      if (over) return;
      const verdict = judge(puzzle, editor.value);
      if (verdict.ok) { finish(true); return; }
      lives--;
      drawLives();
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      const left = puzzle.bugs.length - verdict.fixed;
      const what = verdict.broken
        ? 'Баги починены, но сломалось что-то ещё. Нажми «Сбросить код», если запутался.'
        : `Починено ${verdict.fixed} из ${puzzle.bugs.length}, осталось ${left}.`;
      log.replaceChildren(
        el('span', { class: 'bf-err' }, '> Task :compileJava FAILED'), '\n',
        el('span', {}, what), '\n',
        el('span', { class: 'bf-dim' }, lives > 0 ? `Жизней осталось: ${lives}.` : 'Жизни кончились.'),
      );
      if (lives <= 0) window.setTimeout(() => finish(false), 700);
    }

    function finish(won: boolean): void {
      over = true;
      editor.readOnly = true;
      for (const b of [checkButton, resetButton, giveUp, hintButton]) b.setAttribute('disabled', '');
      const close = (): void => {
        backdrop.classList.add('out');
        window.setTimeout(() => { backdrop.remove(); resolve(won); }, 250);
      };
      if (won) {
        log.replaceChildren(
          el('span', { class: 'bf-ok' }, '> Task :compileJava'), '\n',
          el('span', { class: 'bf-ok' }, `BUILD SUCCESSFUL in ${(0.6 + Math.random()).toFixed(1)}s`), '\n',
          el('span', {}, 'Красавчик. Запускаю Minecraft...'),
        );
        card.classList.add('won');
        window.setTimeout(close, 1800);
        return;
      }
      log.replaceChildren(el('span', { class: 'bf-err' }, 'BUILD FAILED'), '\n', el('span', {}, 'Minecraft не запустился. Следующий клик по «Играть» запустит его как обычно.'));
      card.querySelector('.bf-side')!.replaceChildren(
        el('div', { class: 'bf-topic' },
          el('p', { class: 'eyebrow' }, 'Что было сломано'),
          ...puzzle.bugs.map((bug) => el('div', { class: 'bf-answer' },
            el('pre', { class: 'bf-bad', html: highlight(bug.bad.trim()) }),
            el('pre', { class: 'bf-good', html: highlight(bug.fixes[0]!.trim()) }),
            el('p', { html: bug.why }),
          )),
        ),
      );
      card.querySelector('.bf-foot')!.replaceChildren(el('span', { style: 'flex:1' }), el('button', { class: 'bf-btn bf-main', onclick: close }, 'Понятно'));
    }
  });
}
