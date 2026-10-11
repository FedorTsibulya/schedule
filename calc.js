// Расчёты календаря: ячейки, статусы дней, норма, переработка, баланс отгулов.
// Чистая логика без DOM — подключается и страницей, и тестами (tests.html).
(function (root) {
  'use strict';

  // Сутки в сетке: 34 получасовые ячейки с 7:00 до 24:00.
  // Видимая по умолчанию часть — 9:00–21:00 (ячейки 4..27).
  const START_H = 7;
  const SLOTS = 34;
  const VIS_FROM = 4;
  const VIS_TO = 28;
  const EMPTY = '.'.repeat(SLOTS);

  // Символы ячеек:
  //   '.' — могу, если нужно (план) / не отмечено (факт)
  //   'W' — работа, 'X' — не работаю, 'C' — отгул
  //   'O' — работа сверх нормы; не хранится, вычисляется для показа
  const STATUS = {
    W: 'Работа',
    O: 'Переработка',
    X: 'Не работаю',
    C: 'Отгул',
    '.': 'Могу, если нужно',
  };

  const slotOf = h => Math.round((h - START_H) * 2);
  const timeOf = i => {
    const m = START_H * 60 + i * 30;
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  };

  // ---------- Даты (строки YYYY-MM-DD, арифметика в UTC) ----------

  function parse(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const toISO = date => date.toISOString().slice(0, 10);
  function addDays(iso, n) {
    const d = parse(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
  }
  const weekday = iso => (parse(iso).getUTCDay() + 6) % 7; // 0 = понедельник
  const mondayOf = iso => addDays(iso, -weekday(iso));
  const weekDates = monday => [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i));
  function todayISO(now = new Date()) {
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  // ---------- Ячейки ----------

  function setRange(slots, from, to, ch) {
    const a = slots.split('');
    for (let i = Math.max(0, from); i < Math.min(SLOTS, to); i++) a[i] = ch;
    return a.join('');
  }
  const count = (slots, ch) => slots.split(ch).length - 1;

  // Быстрое заполнение дня. Пресет заменяет весь слой дня.
  const PRESETS = {
    full: { name: 'Полный день', ranges: [[10, 18, 'W']] },
    half: { name: 'Полдня', ranges: [[10, 14, 'W']] },
    halfComp: { name: 'Полдня отгул', ranges: [[10, 14, 'W'], [14, 18, 'C']] },
    comp: { name: 'Отгул', ranges: [[10, 18, 'C']] },
    off: { name: 'Выходной', ranges: [[7, 24, 'X']] },
    clear: { name: 'Очистить', ranges: [] },
  };
  function applyPreset(key) {
    return PRESETS[key].ranges.reduce((s, [f, t, ch]) => setRange(s, slotOf(f), slotOf(t), ch), EMPTY);
  }

  // Факт дня, который ещё не правили, равен плану — от него и отталкиваются при заполнении.
  // Явно сохранённый факт (в том числе пустой) плану больше не следует.
  function getDay(data, date) {
    const d = (data.days && data.days[date]) || {};
    const plan = d.plan || EMPTY;
    return {
      plan,
      fact: d.fact !== undefined ? d.fact : plan,
      ownFact: d.fact !== undefined,
      marks: d.marks || [],
      labels: d.labels || [],
      note: d.note || '',
    };
  }

  const isFactDone = (data, monday) => !!(data.weeks && data.weeks[monday] && data.weeks[monday].factDone);

  // ---------- Неделя ----------

  // Итоги недели по слою ('plan' | 'fact'):
  //   отгулы засчитываются в норму первыми, но не больше нормы (Cn = min(C, норма));
  //   сверх нормы = max(0, W + Cn − норма); изменение баланса = сверх нормы − Cn.
  function weekTotals(data, monday, layer) {
    const norm = data.settings.normHours;
    let w = 0, c = 0;
    for (const date of weekDates(monday)) {
      const s = getDay(data, date)[layer];
      w += count(s, 'W');
      c += count(s, 'C');
    }
    const W = w / 2, C = c / 2;
    const Cn = Math.min(C, norm);
    const inNorm = W + Cn;
    const over = Math.max(0, inNorm - norm);
    return { W, C, Cn, excessC: C - Cn, inNorm, norm, over, delta: over - Cn };
  }

  // Ячейки недели для показа: работа после остатка нормы (норма − отгулы) → 'O'.
  // Возвращает { date: slots }.
  function weekView(data, monday, layer) {
    const t = weekTotals(data, monday, layer);
    const limit = (t.norm - t.Cn) * 2;
    let n = 0;
    const out = {};
    for (const date of weekDates(monday)) {
      out[date] = getDay(data, date)[layer].replace(/W/g, () => (++n > limit ? 'O' : 'W'));
    }
    return out;
  }

  // Интервалы переработки недели: [{ date, from, to, hours }]
  function overtimeRuns(view) {
    const runs = [];
    for (const date of Object.keys(view).sort()) {
      const s = view[date];
      for (let i = 0; i < SLOTS; i++) {
        if (s[i] !== 'O') continue;
        let e = i;
        while (e + 1 < SLOTS && s[e + 1] === 'O') e++;
        runs.push({ date, from: i, to: e + 1, hours: (e + 1 - i) / 2 });
        i = e;
      }
    }
    return runs;
  }

  // Подряд идущие одинаковые ячейки в диапазоне [from, to), кроме '.'.
  function runs(slots, from = 0, to = SLOTS) {
    const out = [];
    for (let i = from; i < to; i++) {
      const ch = slots[i];
      if (ch === '.') continue;
      let e = i;
      while (e + 1 < to && slots[e + 1] === ch) e++;
      out.push({ ch, from: i, to: e + 1 });
      i = e;
    }
    return out;
  }

  // Сводный статус дня по ячейкам слоя (ячейки могут содержать 'O').
  // kind — символ для цветной точки (null — без точки).
  function dayStatus(slots, layer) {
    const w = (count(slots, 'W') + count(slots, 'O')) / 2;
    const c = count(slots, 'C') / 2;
    const wk = slots.includes('O') ? 'O' : 'W';
    if (w === 0 && c === 8) return { text: 'Отгул', kind: 'C' };
    if (w === 4 && c === 4) return { text: 'Полдня отгул', kind: 'C' };
    if (c === 0 && w === 8) return { text: 'Полный день', kind: wk };
    if (c === 0 && w === 4) return { text: 'Полдня', kind: wk };
    if (w === 0 && c === 0) {
      if (/^X+$/.test(slots.slice(VIS_FROM, VIS_TO))) return { text: 'Выходной', kind: 'X' };
      if (layer === 'fact') return { text: 'Без работы', kind: null };
      return { text: 'По запросу', kind: '.' };
    }
    const parts = [];
    if (w) parts.push(fmtHours(w));
    if (c) parts.push('отгул ' + fmtHours(c));
    return { text: 'Свой график · ' + parts.join(' + '), kind: w ? wk : 'C' };
  }

  // ---------- Баланс ----------

  // Баланс с начала учёта по неделю upTo включительно.
  //   actual   — только недели с отметкой «факт заполнен»;
  //   forecast — плюс плановые изменения недель без факта.
  function balance(data, upTo) {
    const s = data.settings;
    const start = mondayOf(s.start);
    let actual = s.startBalanceHours;
    let forecast = actual;
    const history = [];
    for (let m = start; m <= mondayOf(upTo); m = addDays(m, 7)) {
      const done = isFactDone(data, m);
      const t = weekTotals(data, m, done ? 'fact' : 'plan');
      if (done) actual += t.delta;
      forecast += t.delta;
      history.push({ monday: m, done, delta: t.delta, after: done ? actual : forecast });
    }
    return { actual, forecast, history };
  }

  // Последний понедельник, за который есть данные (или неделя today).
  function lastMonday(data, today) {
    let last = mondayOf(today);
    for (const d of Object.keys(data.days || {})) if (mondayOf(d) > last) last = mondayOf(d);
    for (const m of Object.keys(data.weeks || {})) if (m > last) last = m;
    return last;
  }

  // Часы → дни с округлением вниз до половины дня (1 день = 8 ч).
  const balanceDays = (hours, dayHours = 8) => Math.floor(hours / (dayHours / 2)) / 2;

  // ---------- Форматирование ----------

  const num = n => String(Math.round(Math.abs(n) * 100) / 100).replace('.', ',');
  const sign = n => (n < 0 ? '−' : '');
  const fmtHours = h => sign(h) + num(h) + ' ч';
  const fmtSigned = h => (h > 0 ? '+' : '') + fmtHours(h);
  function daysWord(n) {
    n = Math.abs(n);
    if (!Number.isInteger(n)) return 'дня';
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
    return 'дней';
  }
  const fmtDays = n => sign(n) + num(n) + ' ' + daysWord(n);

  root.Calc = {
    START_H, SLOTS, VIS_FROM, VIS_TO, EMPTY, STATUS, PRESETS,
    slotOf, timeOf, parse, toISO, addDays, weekday, mondayOf, weekDates, todayISO,
    setRange, count, applyPreset, getDay, isFactDone,
    weekTotals, weekView, overtimeRuns, runs, dayStatus, balance, lastMonday, balanceDays,
    num, fmtHours, fmtSigned, daysWord, fmtDays,
  };
})(typeof window !== 'undefined' ? window : globalThis);
