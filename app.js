// Интерфейс календаря: неделя/месяц, план/факт, редактирование, итоги и баланс.
(function () {
  'use strict';

  const C = window.Calc;
  const S = window.Storage;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const WD = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
  const WD_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTH_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const LABEL_COLORS = ['#8e24aa', '#00897b', '#f4511e', '#3949ab', '#6d4c41', '#039be5', '#7cb342', '#d81b60', '#546e7a'];
  const COLOR_VAR = { W: '--work', O: '--over', X: '--off', C: '--comp', '.': '--maybe' };
  const ROW = 22;
  const SAVE_DELAY = 2500;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  };

  const narrowMQ = matchMedia('(max-width: 760px)');
  const today = C.todayISO();

  const state = {
    data: null,
    sha: null,
    // В воскресенье по умолчанию показываем следующую неделю — её как раз планируют
    anchor: C.weekday(today) === 6 ? C.addDays(today, 1) : today,
    view: 'week',
    layer: null,          // null — выбирается автоматически по неделе
    owner: false,
    edit: false,
    save: 'idle',         // idle | dirty | saving | saved | error
    saveMsg: '',
    saveCode: '',
    fold: store.get('schedule.fold', { early: true, late: true }),
    pop: null,
    drag: null,
  };

  // ---------- Вспомогательное ----------

  const settings = () => state.data.settings;
  const labelById = id => state.data.labels.find(l => l.id === id);
  const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#9aa0a6');
  const dayNum = iso => +iso.slice(8);
  const monthIdx = iso => +iso.slice(5, 7) - 1;
  const year = iso => +iso.slice(0, 4);
  const short = iso => `${dayNum(iso)} ${MONTH_SHORT[monthIdx(iso)]}`;

  function autoLayer(monday) {
    return C.isFactDone(state.data, monday) || C.addDays(monday, 6) < today ? 'fact' : 'plan';
  }
  const layerOf = monday => state.layer || autoLayer(monday);
  const currentLayer = () => layerOf(C.mondayOf(state.anchor));

  function shownDates() {
    if (narrowMQ.matches) return [0, 1, 2].map(i => C.addDays(state.anchor, i));
    return C.weekDates(C.mondayOf(state.anchor));
  }

  function rangeTitle(a, b) {
    if (year(a) !== year(b)) return `${dayNum(a)} ${MONTH_GEN[monthIdx(a)]} ${year(a)} – ${dayNum(b)} ${MONTH_GEN[monthIdx(b)]} ${year(b)}`;
    if (monthIdx(a) !== monthIdx(b)) return `${dayNum(a)} ${MONTH_GEN[monthIdx(a)]} – ${dayNum(b)} ${MONTH_GEN[monthIdx(b)]} ${year(b)}`;
    return `${dayNum(a)} – ${dayNum(b)} ${MONTH_GEN[monthIdx(b)]} ${year(b)}`;
  }
  const weekRange = monday => {
    const sun = C.addDays(monday, 6);
    return monthIdx(monday) === monthIdx(sun)
      ? `${dayNum(monday)}–${dayNum(sun)} ${MONTH_SHORT[monthIdx(sun)]}`
      : `${short(monday)} – ${short(sun)}`;
  };

  function fmtUpdated(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `обновлено ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Ячейки недели с вычисленной переработкой, с кэшем на один рендер
  let viewCache = {};
  function viewOf(date, layer) {
    const monday = C.mondayOf(date);
    const key = monday + layer;
    if (!viewCache[key]) viewCache[key] = C.weekView(state.data, monday, layer);
    return viewCache[key][date];
  }

  const swatch = kind => (kind ? `<i style="background:var(${COLOR_VAR[kind]})"></i>` : '');
  const labelChip = (l, extra = '') => `<span class="chip"${extra}><i style="background:${safeColor(l.color)}"></i>${esc(l.name)}</span>`;

  // ---------- Изменение данных ----------

  function dayObj(date) {
    return state.data.days[date] || (state.data.days[date] = {});
  }
  function cleanupDay(date) {
    const d = state.data.days[date];
    if (!d) return;
    if (!d.plan || d.plan === C.EMPTY) delete d.plan;
    // Факт, совпадающий с планом, не храним — он и так берётся из плана.
    // Исключение — недели с заполненным фактом: там он зафиксирован.
    if (d.fact === (d.plan || C.EMPTY) && !C.isFactDone(state.data, C.mondayOf(date))) delete d.fact;
    if (!d.marks || !d.marks.length) delete d.marks;
    if (!d.labels || !d.labels.length) delete d.labels;
    if (!d.note) delete d.note;
    if (!Object.keys(d).length) delete state.data.days[date];
  }

  let saveTimer = null;
  function changed() {
    state.data.updatedAt = new Date().toISOString();
    state.save = 'dirty';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, SAVE_DELAY);
    render();
  }

  let saving = null;
  async function doSave() {
    if (saving) { await saving; if (state.save !== 'dirty') return; }
    state.save = 'saving';
    renderHeader();
    const snapshot = JSON.parse(JSON.stringify(state.data));
    saving = S.save(snapshot, state.sha).then(sha => {
      state.sha = sha;
      if (state.save === 'saving') state.save = 'saved';
    }).catch(e => {
      state.save = 'error';
      state.saveCode = e.code || '';
      state.saveMsg = e.message || 'Ошибка сохранения';
    }).finally(() => { saving = null; renderHeader(); });
    await saving;
  }

  window.addEventListener('beforeunload', e => {
    if (state.save === 'dirty' || state.save === 'saving') { e.preventDefault(); e.returnValue = ''; }
  });

  function setSlots(date, layer, from, to, ch) {
    const base = C.getDay(state.data, date)[layer];
    const d = dayObj(date);
    d[layer] = C.setRange(base, from, to, ch);
    cleanupDay(date);
    changed();
  }

  // ---------- Шапка ----------

  function renderHeader() {
    const d = state.data;
    const title = (d && settings().title) || 'Расписание';
    document.title = title;
    const name = title.split(':').pop().trim();
    let right = '';
    if (state.owner) {
      const st = {
        idle: '', dirty: '<span class="pill warn">Есть несохранённые изменения</span>',
        saving: '<span class="pill warn">Сохраняю…</span>', saved: '<span class="pill">Сохранено ✓</span>',
        error: `<span class="pill err">${esc(state.saveMsg)}</span>`,
      }[state.save];
      right += st;
      if (state.save === 'error' && state.saveCode === 'conflict') right += '<button class="btn small" data-act="reload">Обновить страницу</button>';
      if (state.save === 'error' && state.saveCode !== 'conflict') right += '<button class="btn small" data-act="retry">Повторить</button>';
      right += state.edit
        ? '<button class="btn small primary" data-act="edit">✓ Готово</button>'
        : '<button class="btn small" data-act="edit">✎ Редактировать</button>';
      if (S.mode() === 'github') right += '<button class="linkbtn" data-act="logout">Выйти</button>';
    } else if (S.mode() === 'github') {
      right += '<button class="linkbtn" data-act="login" title="Вход для владельца">✎ Вход</button>';
    }
    $('header').innerHTML = `
      <div class="logo">${esc(name.charAt(0).toUpperCase() || 'Р')}</div>
      <div><h1>${esc(title)}</h1><div class="updated">${d ? fmtUpdated(d.updatedAt) : ''}</div></div>
      <div class="spacer"></div>${right}`;
  }

  function renderBanner() {
    const b = $('banner');
    if (S.mode() === 'local') {
      b.hidden = false;
      b.innerHTML = 'Локальный режим: изменения сохраняются только в этом браузере.' +
        ' <button class="btn small" data-act="reset-local">Сбросить к файлу данных</button>';
    } else b.hidden = true;
  }

  function renderToolbar() {
    let title;
    if (state.view === 'month') title = `${MONTH_NOM[monthIdx(state.anchor)]} ${year(state.anchor)}`;
    else { const ds = shownDates(); title = rangeTitle(ds[0], ds[ds.length - 1]); }
    const layer = currentLayer();
    $('toolbar').innerHTML = `
      <button class="btn" data-act="today">Сегодня</button>
      <button class="nav" data-act="prev" aria-label="Назад">‹</button>
      <button class="nav" data-act="next" aria-label="Вперёд">›</button>
      <span class="range">${title}</span>
      <div class="spacer"></div>
      <div class="seg" role="group" aria-label="Слой">
        <button data-act="layer" data-v="plan" class="${layer === 'plan' ? 'on' : ''}">План</button>
        <button data-act="layer" data-v="fact" class="${layer === 'fact' ? 'on' : ''}">Факт</button>
      </div>
      <div class="seg" role="group" aria-label="Вид">
        <button data-act="view" data-v="week" class="${state.view === 'week' ? 'on' : ''}">${narrowMQ.matches ? '3 дня' : 'Неделя'}</button>
        <button data-act="view" data-v="month" class="${state.view === 'month' ? 'on' : ''}">Месяц</button>
      </div>`;
  }

  // ---------- Неделя ----------

  function blockHtml(r, vFrom) {
    const time = `${C.timeOf(r.from)}–${C.timeOf(r.to)}`;
    const dark = r.ch === 'C';
    return `<div class="blk${dark ? ' dark' : ''}" style="top:${(r.from - vFrom) * ROW + 1}px;height:${(r.to - r.from) * ROW - 2}px;background:var(${COLOR_VAR[r.ch]})"><b>${C.STATUS[r.ch]}</b><br>${time}</div>`;
  }

  function renderWeek() {
    const dates = shownDates();
    const vFrom = state.fold.early ? C.VIS_FROM : 0;
    const vTo = state.fold.late ? C.VIS_TO : C.SLOTS;

    let h = `<div class="grid${state.edit ? ' editing' : ''}" style="--cols:${dates.length}"><div></div>`;
    for (const date of dates) {
      const layer = layerOf(C.mondayOf(date));
      const s = viewOf(date, layer);
      const day = C.getDay(state.data, date);
      const st = C.dayStatus(s, layer);
      const chips = [`<span class="chip">${swatch(st.kind)}${esc(st.text)}</span>`];
      for (const id of day.labels) { const l = labelById(id); if (l) chips.push(labelChip(l)); }
      for (const m of day.marks) { const l = labelById(m.label); if (l) chips.push(`<span class="chip"><i style="background:${safeColor(l.color)}"></i>${esc(l.name)} ${C.timeOf(m.from)}</span>`); }
      h += `<div class="dh${date === today ? ' today' : ''}${state.edit ? ' editable' : ''}" ${state.edit ? `data-act="day" data-date="${date}"` : ''}>
        <div class="wd">${WD[C.weekday(date)]}</div><div class="dn">${dayNum(date)}</div>
        <div class="chips">${chips.join('')}</div>${day.note ? `<div class="note">${esc(day.note)}</div>` : ''}</div>`;
    }

    const foldRow = (key, label, from, to) => {
      const open = !state.fold[key];
      let r = `<div class="fold g" data-act="fold" data-v="${key}" title="${open ? 'Свернуть' : 'Развернуть'}">${label} ${open ? '▾' : '▸'}</div>`;
      for (const date of dates) {
        const s = viewOf(date, layerOf(C.mondayOf(date))).slice(from, to);
        const busy = !open && (/[^.]/.test(s) || C.getDay(state.data, date).marks.some(m => m.from < to && m.to > from));
        r += `<div class="fold">${busy ? '<span class="dot" title="Есть отметки"></span>' : ''}</div>`;
      }
      return r;
    };
    h += foldRow('early', '7–9', 0, C.VIS_FROM);

    let gut = `<div class="gut" style="height:${(vTo - vFrom) * ROW}px">`;
    for (let s = vFrom + 2; s < vTo; s += 2) gut += `<span style="top:${(s - vFrom) * ROW}px">${C.timeOf(s)}</span>`;
    h += gut + '</div>';

    for (const date of dates) {
      const layer = layerOf(C.mondayOf(date));
      const s = viewOf(date, layer);
      let col = `<div class="col ${layer}" data-date="${date}" data-vfrom="${vFrom}" data-vto="${vTo}" style="height:${(vTo - vFrom) * ROW}px">`;
      for (const r of C.runs(s, vFrom, vTo)) col += blockHtml(r, vFrom);
      for (const m of C.getDay(state.data, date).marks) {
        const l = labelById(m.label);
        const a = Math.max(m.from, vFrom), b = Math.min(m.to, vTo);
        if (l && b > a) col += `<div class="mk" style="top:${(a - vFrom) * ROW + 1}px;height:${(b - a) * ROW - 2}px;background:${safeColor(l.color)}" title="${esc(l.name)}"></div>`;
      }
      h += col + '</div>';
    }
    h += foldRow('late', '21–24', C.VIS_TO, C.SLOTS) + '</div>';
    $('cal').innerHTML = h;
  }

  // ---------- Месяц ----------

  function renderMonth() {
    const first = state.anchor.slice(0, 8) + '01';
    const start = C.mondayOf(first);
    const m = monthIdx(first);
    const narrow = narrowMQ.matches;
    let h = '<div class="month">' + WD.map(w => `<div class="mh">${w}</div>`).join('') + (narrow ? '' : '<div class="mh" style="text-align:right">Неделя</div>');
    for (let mon = start; monthIdx(mon) === m || mon === start; mon = C.addDays(mon, 7)) {
      const layer = layerOf(mon);
      for (const date of C.weekDates(mon)) {
        const s = viewOf(date, layer);
        const day = C.getDay(state.data, date);
        // Пустой день в месяце не подписываем, чтобы не рябило
        const st = s === C.EMPTY ? { text: '', kind: null } : C.dayStatus(s, layer);
        const labels = [...day.labels, ...day.marks.map(x => x.label)].map(labelById).filter(Boolean);
        const uniq = [...new Map(labels.map(l => [l.id, l])).values()];
        h += `<button class="mc${monthIdx(date) !== m ? ' other' : ''}${date === today ? ' today' : ''}" data-act="goto" data-date="${date}">
          <span class="md">${dayNum(date)}</span>
          <div class="chips">${st.text ? `<span class="chip">${swatch(st.kind)}${esc(st.text)}</span>` : ''}${uniq.map(l => labelChip(l)).join('')}</div>
          <div class="dots">${st.kind ? swatch(st.kind) : ''}${uniq.map(l => `<i style="background:${safeColor(l.color)}"></i>`).join('')}</div>
          ${day.note ? `<div class="note">${esc(day.note)}</div>` : ''}</button>`;
      }
      h += weekSummaryCell(mon);
    }
    $('cal').innerHTML = h + '</div>';
  }

  function weekSummaryCell(mon) {
    if (mon < C.mondayOf(settings().start)) return '<div class="mw"><span class="sub">до начала учёта</span></div>';
    const done = C.isFactDone(state.data, mon);
    const t = C.weekTotals(state.data, mon, done ? 'fact' : 'plan');
    return `<div class="mw"><span class="sub">${weekRange(mon)}</span><span><b>${C.fmtSigned(t.delta)}</b><span class="sub">${done ? 'факт ✓' : 'по плану'}</span></span></div>`;
  }

  // ---------- Панель итогов ----------

  function breakdownHtml(monday, layer) {
    const t = C.weekTotals(state.data, monday, layer);
    const runs = C.overtimeRuns(C.weekView(state.data, monday, layer));
    const row = (a, b, cls = '') => `<div class="br ${cls}"><span>${a}</span><span>${b}</span></div>`;
    const compLabel = t.excessC ? `${C.fmtHours(t.Cn)} <small>из ${C.fmtHours(t.C)}</small>` : C.fmtHours(t.Cn);
    return `<details class="why" ${store.get('schedule.whyOpen', false) ? 'open' : ''} data-remember="schedule.whyOpen">
      <summary>Из чего сложилось изменение баланса${layer === 'plan' ? ' (прогноз по плану)' : ''}</summary>
      ${row('Работа', C.fmtHours(t.W))}
      ${row('+ Отгулы (идут в норму)', compLabel)}
      ${row('= Засчитано в норму', C.fmtHours(t.inNorm), 'sum')}
      ${row('− Норма недели', C.fmtHours(t.norm))}
      ${row('= Сверх нормы', C.fmtHours(t.over) + (t.inNorm < t.norm ? ' <small>(недоработка не учитывается)</small>' : ''), 'sum')}
      ${row('− Списано на отгулы', C.fmtHours(t.Cn))}
      ${row('= Изменение баланса', C.fmtSigned(t.delta), 'total')}
      ${runs.length ? `<div class="where">Сверх нормы на сетке (малиновое):<br>${runs.map(r =>
        `${WD[C.weekday(r.date)].charAt(0)}${WD[C.weekday(r.date)].charAt(1).toLowerCase()} ${dayNum(r.date)} · ${C.timeOf(r.from)}–${C.timeOf(r.to)} · ${C.fmtHours(r.hours)}`).join('<br>')}</div>` : ''}
    </details>`;
  }

  function renderPanel() {
    const d = state.data;
    const monday = C.mondayOf(state.anchor);
    const layer = currentLayer();
    const startMon = C.mondayOf(settings().start);
    const p = C.weekTotals(d, monday, 'plan');
    const f = C.weekTotals(d, monday, 'fact');
    const done = C.isFactDone(d, monday);
    const dayH = settings().dayHours;
    const now = C.balance(d, C.lastMonday(d, today));
    const nowActual = now.actual;
    let h = `<h2>Итоги недели <span style="font-weight:400;color:var(--muted)">${weekRange(monday)}</span></h2>`;

    if (monday < startMon) {
      h += `<p class="sub">Учёт начинается с недели ${weekRange(startMon)}.</p>`;
    } else {
      h += `<table>
        <tr><th></th><th>План</th><th>Факт</th></tr>
        <tr><td>Работа</td><td>${C.fmtHours(p.W)}</td><td>${C.fmtHours(f.W)}</td></tr>
        <tr><td>Отгулы</td><td>${C.fmtDays(p.C / dayH)}</td><td>${C.fmtDays(f.C / dayH)}</td></tr>
        <tr><td>Изменение баланса</td><td>${C.fmtSigned(p.delta)}</td><td>${done ? `<b>${C.fmtSigned(f.delta)}</b>` : '—'}</td></tr>
      </table>`;
      const t = layer === 'plan' ? p : f;
      if (t.excessC) {
        h += `<div class="warnbox">Отгулов больше нормы недели: лишние ${C.fmtHours(t.excessC)} не спишутся с баланса — отметьте их как выходной.</div>`;
      }
      h += breakdownHtml(monday, layer);
      if (state.owner && state.edit) {
        h += `<label class="done ${done ? 'yes' : 'no'}"><input type="checkbox" data-act="factdone" ${done ? 'checked' : ''}>Факт за неделю заполнен</label>`;
        if (layer === 'fact') h += '<button class="btn small" data-act="reset-week">Вернуть факт недели к плану</button>';
      } else {
        h += done
          ? '<div class="done yes">✓ Факт за неделю заполнен</div>'
          : '<div class="done no">Факт за неделю ещё не заполнен — неделя не входит в баланс</div>';
      }
      const wb = C.balance(d, monday);
      h += `<div class="bal">
        <div class="sub">Доступно отгулов сейчас</div>
        <div class="big">${C.fmtDays(C.balanceDays(nowActual, dayH))}</div>
        <div class="sub">${C.fmtHours(nowActual)}</div>
        <div class="next">${done
          ? `После этой недели: <b>${C.fmtDays(C.balanceDays(wb.actual, dayH))}</b> <span class="sub">(${C.fmtHours(wb.actual)})</span>`
          : `Прогноз на конец недели: <b>${C.fmtDays(C.balanceDays(wb.forecast, dayH))}</b> <span class="sub">(${C.fmtHours(wb.forecast)}, если всё пойдёт по плану)</span>`}</div>
      </div>`;
    }

    h += `<details class="why hist"><summary>История баланса</summary>
      <div class="br"><span>Начальный баланс</span><span>${C.fmtHours(settings().startBalanceHours)}</span></div>
      ${now.history.map(x => `<div class="br ${x.done ? '' : 'fc'}"><span>${weekRange(x.monday)} ${x.done ? '✓' : '· прогноз'}</span><span>${C.fmtSigned(x.delta)} → ${C.fmtHours(x.after)}</span></div>`).join('')}
    </details>`;

    h += '<h3>Обозначения</h3><div class="legend">' +
      ['W', 'X', '.', 'C', 'O'].map(k => `<div><span class="sw" style="background:var(${COLOR_VAR[k]})"></span>${C.STATUS[k]}</div>`).join('') + '</div>';

    if (d.labels.length) {
      h += '<h3>Метки</h3>';
      h += state.owner && state.edit
        ? d.labels.map(l => `<div class="lbl-row">${labelChip(l)}<button class="x" data-act="label-del" data-id="${esc(l.id)}" title="Удалить метку">✕</button></div>`).join('')
        : `<div class="chips">${d.labels.map(l => labelChip(l)).join('')}</div>`;
    }
    $('panel').innerHTML = h;
  }

  // ---------- Рендер ----------

  function render() {
    if (!state.data) return;
    viewCache = {};
    renderHeader();
    renderBanner();
    renderToolbar();
    state.view === 'month' ? renderMonth() : renderWeek();
    renderPanel();
    if (state.pop) renderPop();
  }

  // ---------- Всплывающие меню ----------

  function openPop(pop, x, y) {
    state.pop = { ...pop, x, y };
    renderPop();
  }
  function closePop() {
    state.pop = null;
    $('pop').hidden = true;
    const sel = document.querySelector('.sel');
    if (sel) sel.remove();
  }

  function labelPicker(selected, act) {
    const p = state.pop;
    const chips = state.data.labels.map(l =>
      `<button class="chip pick${selected.includes(l.id) ? ' on' : ''}" data-act="${act}" data-id="${esc(l.id)}"><i style="background:${safeColor(l.color)}"></i>${esc(l.name)}</button>`).join('');
    const color = p.newColor || LABEL_COLORS[state.data.labels.length % LABEL_COLORS.length];
    return `<div class="chips">${chips || '<span class="sub">Меток пока нет</span>'}</div>
      <div class="pop-sub">Новая метка</div>
      <input type="text" id="newLabelName" maxlength="40" placeholder="Например, «Встреча»">
      <div class="colors">${LABEL_COLORS.map(c => `<button data-act="new-color" data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}" aria-label="Цвет ${c}"></button>`).join('')}</div>
      <div class="row-end"><button class="btn small" data-act="new-label" data-for="${act}">Добавить метку</button></div>`;
  }

  function renderPop() {
    const p = state.pop;
    const el = $('pop');
    const date = p.date;
    const wd = C.weekday(date);
    const layer = layerOf(C.mondayOf(date));
    let h = '';
    if (p.type === 'range') {
      h += `<div class="pop-title">${WD_FULL[wd]}, ${dayNum(date)} ${MONTH_GEN[monthIdx(date)]} · ${C.timeOf(p.a)}–${C.timeOf(p.b)}</div>`;
      if (p.picker) {
        h += '<div class="pop-sub">Метка на интервал</div>' + labelPicker([], 'mark');
      } else {
        const opts = ['W', 'X', 'C', '.'];
        h += `<div class="pop-sub">${layer === 'plan' ? 'План' : 'Факт'}</div><div class="opts">` + opts.map(ch =>
          `<button class="opt" data-act="set" data-ch="${ch}"><span class="sw" style="background:var(${ch === '.' && layer === 'fact' ? '--none);box-shadow:inset 0 0 0 1px var(--line)' : COLOR_VAR[ch]})"></span>${ch === '.' ? (layer === 'plan' ? 'Могу, если нужно' : 'Очистить') : C.STATUS[ch]}</button>`).join('') +
          '<button class="opt wide" data-act="picker">🏷 Метка на интервал…</button></div>';
      }
    } else {
      const day = C.getDay(state.data, date);
      h += `<div class="pop-title">${WD_FULL[wd]}, ${dayNum(date)} ${MONTH_GEN[monthIdx(date)]}</div>`;
      h += `<div class="pop-sub">Быстро заполнить ${layer === 'plan' ? 'план' : 'факт'}</div><div class="opts">` +
        Object.entries(C.PRESETS).map(([k, v]) => `<button class="opt" data-act="preset" data-k="${k}">${v.name}</button>`).join('') +
        (layer === 'fact' && day.ownFact ? '<button class="opt wide" data-act="reset-day">Вернуть как в плане</button>' : '') + '</div>';
      if (day.marks.length) {
        h += '<div class="pop-sub">Метки на интервалах</div>' + day.marks.map((m, i) => {
          const l = labelById(m.label);
          return l ? `<div class="lbl-row">${labelChip(l)}<span class="sub">${C.timeOf(m.from)}–${C.timeOf(m.to)}</span><button class="x" data-act="mark-del" data-i="${i}" title="Убрать">✕</button></div>` : '';
        }).join('');
      }
      h += '<div class="pop-sub">Метки на весь день</div>' + labelPicker(day.labels, 'day-label');
      h += `<div class="pop-sub">Заметка</div><textarea id="noteInput" maxlength="300" placeholder="Например, «на связи только в Telegram»">${esc(day.note)}</textarea>
        <div class="row-end"><button class="btn small primary" data-act="note-save">Сохранить заметку</button></div>`;
    }
    h += '<div class="row-end"><button class="btn small" data-act="pop-close">Закрыть</button></div>';
    el.innerHTML = h;
    el.hidden = false;
    const w = el.offsetWidth, ht = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(p.x, innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(p.y, innerHeight - ht - 8)) + 'px';
  }

  function addLabel() {
    const input = $('newLabelName');
    const name = input.value.trim();
    if (!name) { input.focus(); return null; }
    const existing = state.data.labels.find(l => l.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const id = 'l' + Date.now().toString(36);
    state.data.labels.push({ id, name, color: state.pop.newColor || LABEL_COLORS[state.data.labels.length % LABEL_COLORS.length] });
    state.pop.newColor = null;
    return id;
  }

  function applyMark(id) {
    const p = state.pop;
    const d = dayObj(p.date);
    d.marks = (d.marks || []).concat({ from: p.a, to: p.b, label: id });
    closePop();
    changed();
  }

  function toggleDayLabel(id) {
    const d = dayObj(state.pop.date);
    const set = new Set(d.labels || []);
    set.has(id) ? set.delete(id) : set.add(id);
    d.labels = [...set];
    cleanupDay(state.pop.date);
    changed();
  }

  // ---------- Действия ----------

  function navigate(dir) {
    if (state.view === 'month') {
      const [y, m] = state.anchor.split('-').map(Number);
      const nm = new Date(Date.UTC(y, m - 1 + dir, 1));
      state.anchor = C.toISO(nm);
    } else {
      state.anchor = C.addDays(state.anchor, dir * (narrowMQ.matches ? 3 : 7));
    }
    state.layer = null;
  }

  function onAction(act, el, e) {
    const p = state.pop;
    switch (act) {
      case 'prev': navigate(-1); break;
      case 'next': navigate(1); break;
      case 'today': state.anchor = today; state.layer = null; break;
      case 'layer': state.layer = el.dataset.v; break;
      case 'view': state.view = el.dataset.v; break;
      case 'goto': state.view = 'week'; state.anchor = el.dataset.date; state.layer = null; break;
      case 'fold':
        state.fold[el.dataset.v] = !state.fold[el.dataset.v];
        store.set('schedule.fold', state.fold);
        break;
      case 'edit': state.edit = !state.edit; closePop(); break;
      case 'login': openLogin(); return;
      case 'logout':
        if (!confirm('Выйти из режима владельца на этом устройстве? Токен будет удалён из браузера.')) return;
        S.setToken('');
        state.owner = false; state.edit = false;
        break;
      case 'reload': location.reload(); return;
      case 'retry': doSave(); return;
      case 'reset-local':
        if (!confirm('Удалить локальные изменения и загрузить данные из файла?')) return;
        S.resetLocal(); location.reload(); return;
      case 'day':
        if (!state.edit) return;
        openPop({ type: 'day', date: el.dataset.date }, e.clientX, e.clientY);
        return;
      case 'factdone': {
        const monday = C.mondayOf(state.anchor);
        const dates = C.weekDates(monday);
        if (el.checked) {
          // Фиксируем факт: дальнейшие правки плана этой недели баланс не меняют
          for (const date of dates) {
            const fact = C.getDay(state.data, date).fact;
            if (fact !== C.EMPTY) dayObj(date).fact = fact;
          }
          state.data.weeks[monday] = { factDone: true };
          state.layer = 'fact';
        } else {
          delete state.data.weeks[monday];
        }
        dates.forEach(cleanupDay);
        changed();
        return;
      }
      case 'reset-week': {
        if (!confirm('Вернуть факт всей недели к плану? Ваши правки факта за эту неделю пропадут.')) return;
        for (const date of C.weekDates(C.mondayOf(state.anchor))) {
          if (state.data.days[date]) delete state.data.days[date].fact;
          cleanupDay(date);
        }
        changed();
        return;
      }
      case 'label-del': {
        const l = labelById(el.dataset.id);
        if (!l || !confirm(`Удалить метку «${l.name}» со всех дней?`)) return;
        state.data.labels = state.data.labels.filter(x => x.id !== l.id);
        for (const date of Object.keys(state.data.days)) {
          const d = state.data.days[date];
          if (d.labels) d.labels = d.labels.filter(id => id !== l.id);
          if (d.marks) d.marks = d.marks.filter(m => m.label !== l.id);
          cleanupDay(date);
        }
        changed();
        return;
      }
      // --- в меню ---
      case 'pop-close': closePop(); return;
      case 'set': {
        const layer = layerOf(C.mondayOf(p.date));
        setSlots(p.date, layer, p.a, p.b, el.dataset.ch);
        closePop();
        return;
      }
      case 'picker': p.picker = true; renderPop(); return;
      case 'mark': applyMark(el.dataset.id); return;
      case 'new-color': p.newColor = el.dataset.c; {
        const name = $('newLabelName').value; renderPop(); $('newLabelName').value = name;
      } return;
      case 'new-label': {
        const id = addLabel();
        if (!id) return;
        if (el.dataset.for === 'mark') applyMark(id); else toggleDayLabel(id);
        return;
      }
      case 'preset': {
        const layer = layerOf(C.mondayOf(p.date));
        dayObj(p.date)[layer] = C.applyPreset(el.dataset.k);
        cleanupDay(p.date);
        changed();
        return;
      }
      case 'reset-day': {
        delete dayObj(p.date).fact;
        cleanupDay(p.date);
        changed();
        return;
      }
      case 'mark-del': {
        const d = dayObj(p.date);
        d.marks.splice(+el.dataset.i, 1);
        cleanupDay(p.date);
        changed();
        return;
      }
      case 'day-label': toggleDayLabel(el.dataset.id); return;
      case 'note-save': {
        dayObj(p.date).note = $('noteInput').value.trim();
        cleanupDay(p.date);
        closePop();
        changed();
        return;
      }
      default: return;
    }
    render();
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    const pop = $('pop');
    if (state.pop && !pop.contains(e.target) && !(el && el.dataset.act === 'day')) {
      closePop();
      if (!el) return;
    }
    if (!el || el.dataset.act === 'factdone') return;
    onAction(el.dataset.act, el, e);
  });
  document.addEventListener('change', e => {
    if (e.target.dataset && e.target.dataset.act === 'factdone') onAction('factdone', e.target, e);
  });
  document.addEventListener('toggle', e => {
    const key = e.target.dataset && e.target.dataset.remember;
    if (key) store.set(key, e.target.open);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.pop) closePop();
  });

  // ---------- Выделение интервала протягиванием ----------

  function slotAt(col, clientY) {
    const vFrom = +col.dataset.vfrom, vTo = +col.dataset.vto;
    const y = clientY - col.getBoundingClientRect().top;
    return Math.max(vFrom, Math.min(vTo - 1, vFrom + Math.floor(y / ROW)));
  }
  function drawSel() {
    const g = state.drag;
    let sel = g.col.querySelector('.sel');
    if (!sel) { sel = document.createElement('div'); sel.className = 'sel'; g.col.appendChild(sel); }
    const a = Math.min(g.a, g.b), b = Math.max(g.a, g.b) + 1;
    const vFrom = +g.col.dataset.vfrom;
    sel.style.top = (a - vFrom) * ROW + 'px';
    sel.style.height = (b - a) * ROW + 'px';
  }

  $('cal').addEventListener('pointerdown', e => {
    const col = e.target.closest('.col');
    if (!col || !state.edit || e.button > 0) return;
    e.preventDefault();
    if (state.pop) closePop();
    const s = slotAt(col, e.clientY);
    state.drag = { col, date: col.dataset.date, a: s, b: s };
    col.setPointerCapture(e.pointerId);
    drawSel();
  });
  $('cal').addEventListener('pointermove', e => {
    const g = state.drag;
    if (!g) return;
    const s = slotAt(g.col, e.clientY);
    if (s !== g.b) { g.b = s; drawSel(); }
  });
  function endDrag(e) {
    const g = state.drag;
    if (!g) return;
    state.drag = null;
    if (e.type === 'pointercancel') { const sel = g.col.querySelector('.sel'); if (sel) sel.remove(); return; }
    // click, который придёт следом, не должен закрыть только что открытое меню
    const stop = ev => { ev.stopPropagation(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 0);
    openPop({ type: 'range', date: g.date, a: Math.min(g.a, g.b), b: Math.max(g.a, g.b) + 1 }, e.clientX + 8, e.clientY + 8);
  }
  $('cal').addEventListener('pointerup', endDrag);
  $('cal').addEventListener('pointercancel', endDrag);

  // ---------- Вход владельца ----------

  function openLogin() {
    $('loginErr').textContent = '';
    $('tokenInput').value = '';
    $('login').showModal();
  }
  $('loginCancel').addEventListener('click', () => $('login').close());
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const token = $('tokenInput').value.trim();
    $('loginOk').disabled = true;
    $('loginErr').textContent = 'Проверяю токен…';
    try {
      if (!(await S.verifyToken(token))) {
        $('loginErr').textContent = 'Токен не даёт права записи в этот репозиторий.';
        return;
      }
      S.setToken(token);
      const { data, sha } = await S.load();
      state.data = data; state.sha = sha;
      state.owner = true; state.edit = true;
      $('login').close();
      render();
    } catch {
      $('loginErr').textContent = 'Не удалось проверить токен. Проверьте подключение к интернету.';
    } finally {
      $('loginOk').disabled = false;
    }
  });

  // ---------- Запуск ----------

  narrowMQ.addEventListener('change', () => { closePop(); render(); });

  async function init() {
    try {
      const { data, sha } = await S.load();
      data.labels = data.labels || [];
      data.days = data.days || {};
      data.weeks = data.weeks || {};
      state.data = data;
      state.sha = sha;
      state.owner = S.mode() === 'local' || !!S.getToken();
      render();
    } catch (e) {
      $('cal').innerHTML = `<div class="loading">Не удалось загрузить расписание: ${esc(e.message)}. Обновите страницу чуть позже.</div>`;
    }
  }
  init();
})();
