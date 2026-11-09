import * as db from './db.js';
import {
  DEFAULT_RIVER_SETTINGS, WEATHER, LEVEL_WORDS, CLARITY, AKA, SIZE_FEEL, JIAI, SPOTS, TICKET_TYPES, TACKLE_FIELDS,
  newTrip, normalizeTrip, sortTrips, formatDate, formatLevel, tripCost, tackleSummary, yen, has, num, uid, todayISO, seasonOf,
} from './model.js';
import { emptyQuery, isEmptyQuery, filterTrips, describeQuery } from './search.js';
import { summarize, seasons } from './stats.js';
import { seasonXlsx } from './export.js';
import { shareTrip, downloadBlob } from './share.js';

const APP_VERSION = '1.0.0';

const state = {
  trips: [],
  presets: [],
  rivers: DEFAULT_RIVER_SETTINGS,
  query: emptyQuery(),
  currentId: null,
  onLeave: null,
};

// ---------- 小さなヘルパー ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}
function readValue(el) {
  if (el.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value;
}

function riverSetting(name) {
  return state.rivers.find((r) => r.name === name);
}
function riverNames() {
  return uniq([...state.rivers.map((r) => r.name), ...state.trips.map((t) => t.river)]);
}

// ---------- 画面の枠 ----------
function mount(topHtml) {
  $('#top').innerHTML = topHtml;
  const root = document.createElement('div');
  root.className = 'view';
  $('#view').replaceChildren(root);
  $('#view').scrollTop = 0;
  return root;
}

function setActiveTab(name) {
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
}

// ---------- フォーム部品 ----------
const field = (label, inner, cls = '') => `<label class="field ${cls}"><span class="lbl">${label}</span>${inner}</label>`;
const group = (label, inner, cls = '') => `<div class="field ${cls}"><span class="lbl">${label}</span>${inner}</div>`;

function input(obj, path, attrs = '') {
  const v = getPath(obj, path);
  return `<input data-path="${path}" value="${esc(v ?? '')}" ${attrs}>`;
}
function numInput(obj, path, attrs = '') {
  return input(obj, path, `type="number" inputmode="decimal" ${attrs}`);
}
function chips(obj, path, options, multi = false) {
  const v = getPath(obj, path);
  const on = (o) => (multi ? (v || []).includes(o) : v === o);
  return `<div class="chips" data-path="${path}" data-mode="${multi ? 'multi' : 'single'}">${options
    .map((o) => `<button type="button" class="chip${on(o) ? ' on' : ''}" data-chip="${esc(o)}">${esc(o)}</button>`)
    .join('')}</div>`;
}
function stepper(obj, path, unit) {
  return `<div class="stepper">
    <button type="button" class="step" data-step="-1" data-for="${path}" aria-label="減らす">−</button>
    ${input(obj, path, 'type="number" inputmode="numeric" min="0"')}
    <span class="unit">${unit}</span>
    <button type="button" class="step" data-step="1" data-for="${path}" aria-label="増やす">＋</button>
  </div>`;
}
const datalist = (id, values) => `<datalist id="${id}">${uniq(values).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;

// チップ・ステッパーの共通処理。変更があれば onChange(path) を呼ぶ
function bindControls(root, obj, onChange) {
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const box = chip.closest('.chips');
      const path = box.dataset.path;
      const val = chip.dataset.chip;
      if (box.dataset.mode === 'multi') {
        const arr = [...(getPath(obj, path) || [])];
        const i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else arr.push(val);
        // 選択肢の並び順を保つ
        const order = $$('.chip', box).map((c) => c.dataset.chip);
        arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        setPath(obj, path, arr);
        chip.classList.toggle('on', i < 0);
      } else {
        const next = getPath(obj, path) === val ? '' : val;
        setPath(obj, path, next);
        $$('.chip', box).forEach((c) => c.classList.toggle('on', c.dataset.chip === next));
      }
      onChange(path);
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const path = step.dataset.for;
      const next = Math.max(0, num(getPath(obj, path)) + Number(step.dataset.step));
      setPath(obj, path, next);
      const el = $(`input[data-path="${path}"]`, root);
      if (el) el.value = next;
      onChange(path);
    }
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-path]');
    if (!el || el.classList.contains('chips')) return;
    setPath(obj, el.dataset.path, readValue(el));
    onChange(el.dataset.path);
  });
}

// ---------- カード表示 ----------
function visibleTrips() {
  return sortTrips(filterTrips(state.trips, state.query));
}

function dl(rows) {
  const r = rows.filter(([, v]) => v);
  if (!r.length) return '';
  return `<dl class="kv">${r.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function cardHtml(t) {
  const rs = riverSetting(t.river);
  const levelText = esc(formatLevel(t));
  const levelLink = rs?.url ? ` <a class="mini-link" href="${esc(rs.url)}" target="_blank" rel="noopener">水位ページ</a>` : '';
  const afterMissing = !has(t.count);
  const cost = tripCost(t);
  const tk = TACKLE_FIELDS.filter(([k]) => t.tackle?.[k]).map(([k, label]) => [label, esc(t.tackle[k])]);

  return `<article class="card" data-id="${t.id}">
    <header class="card-head">
      <div class="card-date">${formatDate(t.date)}</div>
      <div class="card-river">${esc(t.river || '河川未入力')}</div>
      ${t.point ? `<div class="card-point">${esc(t.point)}</div>` : ''}
    </header>
    ${afterMissing ? `<a class="after-banner" href="#/edit/${t.id}?tab=after">釣行後の記録がまだです　入力する ›</a>` : ''}
    <section class="catch">
      <div class="catch-count"><b>${has(t.count) ? esc(t.count) : '-'}</b><span>匹</span></div>
      <div class="catch-side">
        <div>最大 <b>${has(t.maxSize) ? esc(t.maxSize) : '-'}</b> cm</div>
        <div>バラシ ${has(t.bare) ? esc(t.bare) : '-'}</div>
        ${t.sizeFeel ? `<div class="tag">${esc(t.sizeFeel)}</div>` : ''}
      </div>
    </section>
    ${dl([
      ['時合', esc((t.jiai || []).join('・'))],
      ['釣れた場所', esc((t.spots || []).join('・'))],
      ['時間', t.startTime || t.endTime ? `${esc(t.startTime || '?')}〜${esc(t.endTime || '?')}` : ''],
    ])}
    <h3>状況</h3>
    ${dl([
      ['天気', esc([t.weather, has(t.airTemp) ? `気温 ${t.airTemp}℃` : '', has(t.waterTemp) ? `水温 ${t.waterTemp}℃` : ''].filter(Boolean).join('　'))],
      ['水位', levelText ? levelText + levelLink : ''],
      ['濁り', esc(t.clarity)],
      ['垢', esc(t.aka)],
    ]) || '<p class="muted">未入力</p>'}
    ${tk.length ? `<h3>仕掛け</h3>${dl(tk)}` : ''}
    ${cost || t.otori?.shop ? `<h3>オトリ・費用</h3>${dl([
      ['オトリ', esc([t.otori?.shop, has(t.otori?.count) ? `${t.otori.count}匹` : '', has(t.otori?.cost) ? yen(t.otori.cost) : ''].filter(Boolean).join('　'))],
      ['遊漁券', esc([t.ticket?.type, has(t.ticket?.cost) ? yen(t.ticket.cost) : ''].filter(Boolean).join('　'))],
      ['その他', has(t.otherCost) ? yen(t.otherCost) : ''],
      ['合計', cost ? `<b>${yen(cost)}</b>` : ''],
    ])}` : ''}
    ${t.memo ? `<h3>メモ</h3><p class="memo">${esc(t.memo)}</p>` : ''}
    ${t.photos?.length ? `<div class="photos">${t.photos.map((p) => `<img data-src="${p.data}" alt="釣行の写真">`).join('')}</div>` : ''}
    <div class="card-actions">
      <a class="btn" href="#/edit/${t.id}">編集</a>
      <button type="button" class="btn line" data-act="share">LINEで送る</button>
    </div>
  </article>`;
}

function viewCards() {
  setActiveTab('cards');
  const list = visibleTrips();
  const searching = !isEmptyQuery(state.query);
  let idx = list.findIndex((t) => t.id === state.currentId);
  if (idx < 0) idx = list.length - 1;

  const root = mount(`
    <button class="icon-btn" data-nav="-1" aria-label="前の釣行">‹</button>
    <div class="top-title"><div>鮎日記</div><div class="pos" id="pos"></div></div>
    <button class="icon-btn" data-nav="1" aria-label="次の釣行">›</button>`);

  if (searching) {
    root.insertAdjacentHTML('beforeend', `<div class="search-banner">
      <span>🔍 ${esc(describeQuery(state.query))}（${list.length}件）</span>
      <button type="button" class="link" data-act="clear-search">解除</button></div>`);
  }

  if (!list.length) {
    root.insertAdjacentHTML('beforeend', searching
      ? `<div class="empty"><p>条件に合う釣行がありません。</p><a class="btn" href="#/search">条件を変える</a></div>`
      : `<div class="empty"><div class="empty-fish">🐟</div><p>まだ釣行の記録がありません。</p><p class="muted">川に入る前に「釣行前」を、上がったら「釣行後」を入力します。</p><a class="btn primary" href="#/new">最初の釣行を記録する</a></div>`);
    $('#pos').textContent = '';
  } else {
    root.insertAdjacentHTML('beforeend', `<div class="deck${searching ? ' with-banner' : ''}" id="deck">${list.map(cardHtml).join('')}</div>`);
  }

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'clear-search') {
      state.query = emptyQuery();
      viewCards();
    } else if (act === 'share') {
      const id = e.target.closest('.card').dataset.id;
      const t = state.trips.find((x) => x.id === id);
      toast('画像を作成中…');
      const r = await shareTrip(t);
      if (r === 'downloaded') toast('画像を保存しました。LINEから送ってください');
    }
  });

  const deck = $('#deck');
  const update = () => {
    if (!deck) return;
    const i = Math.max(0, Math.min(list.length - 1, Math.round(deck.scrollLeft / deck.clientWidth)));
    state.currentId = list[i]?.id;
    $('#pos').textContent = `${i + 1} / ${list.length}`;
    $$('[data-nav]').forEach((b) => (b.disabled = (b.dataset.nav === '-1' && i === 0) || (b.dataset.nav === '1' && i === list.length - 1)));
    // 写真は表示中の前後だけ読み込む
    [...deck.children].forEach((card, j) => {
      if (Math.abs(j - i) <= 1) $$('img[data-src]', card).forEach((img) => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
    });
  };
  $$('[data-nav]').forEach((b) => {
    b.disabled = !deck;
    b.onclick = () => deck?.scrollBy({ left: Number(b.dataset.nav) * deck.clientWidth, behavior: 'smooth' });
  });
  if (deck) {
    let raf;
    deck.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
    requestAnimationFrame(() => {
      deck.style.scrollBehavior = 'auto';
      deck.scrollLeft = idx * deck.clientWidth;
      deck.style.scrollBehavior = '';
      update();
    });
  }
}

// ---------- 入力・編集 ----------
async function resizeImage(file, max = 1280, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function latestOtherTrip(id) {
  return sortTrips(state.trips.filter((t) => t.id !== id && Object.values(t.tackle || {}).some(Boolean))).pop();
}

function viewEdit(id, tab = 'before') {
  setActiveTab(id ? '' : 'new');
  const existing = id && state.trips.find((t) => t.id === id);
  if (id && !existing) { location.hash = '#/'; return; }
  const trip = existing ? clone(existing) : newTrip();
  let isNew = !existing;
  let dirty = false;
  let timer;

  const root = mount(`
    <a class="icon-btn" href="#/" aria-label="戻る">‹</a>
    <div class="top-title"><div>${isNew ? '新しい釣行' : '釣行の編集'}</div><div class="pos" id="save-status">${isNew ? '入力すると自動保存' : '保存済み'}</div></div>
    <button class="btn small primary" id="done">完了</button>`);

  const setStatus = (s) => { const el = $('#save-status'); if (el) el.textContent = s; };

  async function save() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    trip.updatedAt = new Date().toISOString();
    await db.put('trips', clone(trip));
    const i = state.trips.findIndex((t) => t.id === trip.id);
    if (i >= 0) state.trips[i] = clone(trip); else state.trips.push(clone(trip));
    state.currentId = trip.id;
    if (isNew) {
      isNew = false;
      history.replaceState(null, '', `#/edit/${trip.id}?tab=${tab}`);
      db.requestPersist();
    }
    setStatus('保存済み');
  }
  const touch = () => {
    dirty = true;
    setStatus('保存中…');
    clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  state.onLeave = save;

  const riverChips = state.rivers.map((r) => r.name);
  const tackleValues = (k) => [...state.trips.map((t) => t.tackle?.[k]), ...state.presets.map((p) => p.tackle?.[k])];

  root.innerHTML = `
    <div class="seg" role="tablist">
      <button type="button" data-tab="before" class="${tab === 'before' ? 'on' : ''}">釣行前</button>
      <button type="button" data-tab="after" class="${tab === 'after' ? 'on' : ''}">釣行後</button>
    </div>

    <form class="form" autocomplete="off" onsubmit="return false">
    <div class="pane" data-pane="before" ${tab === 'before' ? '' : 'hidden'}>
      <div class="row2">
        ${field('日付', input(trip, 'date', 'type="date" required'))}
        ${field('開始時刻', input(trip, 'startTime', 'type="time"'))}
      </div>
      ${group('河川', `${chips(trip, 'river', riverChips)}${input(trip, 'river', 'list="dl-river" placeholder="その他の河川は入力"')}`)}
      ${field('ポイント', input(trip, 'point', 'list="dl-point" placeholder="例: 仕七川小学校前"'))}

      <h3>状況</h3>
      ${group('天気', chips(trip, 'weather', WEATHER))}
      <div class="row2">
        ${field('気温', `<div class="with-unit">${numInput(trip, 'airTemp', 'step="0.1"')}<span>℃</span></div>`)}
        ${field('水温', `<div class="with-unit">${numInput(trip, 'waterTemp', 'step="0.1"')}<span>℃</span></div>`)}
      </div>
      ${group('水位', chips(trip, 'levelWord', LEVEL_WORDS))}
      <div class="row2">
        ${group('水位（数値）', `<div class="with-unit">
            <button type="button" class="sign" data-act="sign" aria-label="プラスマイナス切替">±</button>
            ${numInput(trip, 'levelCm', 'step="1" placeholder="例: -15"')}<span>cm</span></div>`)}
        ${field('観測所', input(trip, 'station', 'list="dl-station" placeholder="例: 仕出"'))}
      </div>
      <div id="level-link"></div>
      ${group('濁り', chips(trip, 'clarity', CLARITY))}
      ${group('垢の状態', chips(trip, 'aka', AKA))}

      <h3>仕掛け</h3>
      <div class="tools">
        <button type="button" class="btn small" data-act="copy-last">前回の仕掛け</button>
        <select id="preset-select" class="btn small">
          <option value="">プリセットから…</option>
          ${state.presets.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn small" data-act="save-preset">プリセットに保存</button>
      </div>
      ${TACKLE_FIELDS.map(([k, label, ph]) => field(label, input(trip, `tackle.${k}`, `list="dl-t-${k}" placeholder="${esc(ph)}"`))).join('')}

      <h3>オトリ・遊漁券</h3>
      ${field('オトリ店', input(trip, 'otori.shop', 'list="dl-shop"'))}
      <div class="row2">
        ${field('オトリ数', `<div class="with-unit">${numInput(trip, 'otori.count', 'inputmode="numeric" min="0"')}<span>匹</span></div>`)}
        ${field('オトリ代', `<div class="with-unit">${numInput(trip, 'otori.cost', 'inputmode="numeric" min="0"')}<span>円</span></div>`)}
      </div>
      ${group('遊漁券', chips(trip, 'ticket.type', TICKET_TYPES))}
      ${field('遊漁券代', `<div class="with-unit">${numInput(trip, 'ticket.cost', 'inputmode="numeric" min="0"')}<span>円</span></div>`)}

      <button type="button" class="btn wide" data-tab="after">釣行後の入力へ ›</button>
    </div>

    <div class="pane" data-pane="after" ${tab === 'after' ? '' : 'hidden'}>
      ${field('終了時刻', input(trip, 'endTime', 'type="time"'))}
      ${group('匹数', stepper(trip, 'count', '匹'), 'big')}
      <div class="row2">
        ${field('最大サイズ', `<div class="with-unit">${numInput(trip, 'maxSize', 'step="0.1" min="0"')}<span>cm</span></div>`)}
        ${group('バラシ', stepper(trip, 'bare', ''))}
      </div>
      ${group('サイズ感', chips(trip, 'sizeFeel', SIZE_FEEL))}
      ${group('時合（複数可）', chips(trip, 'jiai', JIAI, true))}
      ${group('釣れた場所（複数可）', chips(trip, 'spots', SPOTS, true))}
      ${field('その他費用（交通費など）', `<div class="with-unit">${numInput(trip, 'otherCost', 'inputmode="numeric" min="0"')}<span>円</span></div>`)}
      ${field('メモ', `<textarea data-path="memo" rows="5" placeholder="垢の付き具合、追い気、次回への反省など">${esc(trip.memo)}</textarea>`)}
      ${group('写真', `<div class="photo-edit" id="photo-edit"></div>
        <label class="btn small"><input type="file" accept="image/*" multiple hidden id="photo-input">写真を追加</label>`)}

      <button type="button" class="btn wide danger" data-act="delete">この釣行を削除</button>
    </div>
    </form>
    ${datalist('dl-river', riverNames())}
    <datalist id="dl-point"></datalist>
    ${datalist('dl-station', [...state.rivers.map((r) => r.station), ...state.trips.map((t) => t.station)])}
    ${datalist('dl-shop', state.trips.map((t) => t.otori?.shop))}
    ${TACKLE_FIELDS.map(([k]) => datalist(`dl-t-${k}`, tackleValues(k))).join('')}
  `;

  const refreshInputs = () => {
    $$('input[data-path], textarea[data-path]', root).forEach((el) => {
      const v = getPath(trip, el.dataset.path);
      if (document.activeElement !== el) el.value = v ?? '';
    });
    $$('.chips', root).forEach((box) => {
      const v = getPath(trip, box.dataset.path);
      $$('.chip', box).forEach((c) => c.classList.toggle('on', box.dataset.mode === 'multi' ? (v || []).includes(c.dataset.chip) : v === c.dataset.chip));
    });
  };

  const refreshRiver = () => {
    const points = state.trips.filter((t) => t.river === trip.river && t.id !== trip.id).map((t) => t.point);
    $('#dl-point', root).innerHTML = uniq(points).map((p) => `<option value="${esc(p)}">`).join('');
    const rs = riverSetting(trip.river);
    $('#level-link', root).innerHTML = rs?.url
      ? `<a class="btn small level-btn" href="${esc(rs.url)}" target="_blank" rel="noopener">🌊 ${esc(rs.station || trip.river)}の水位を確認</a>`
      : '';
  };

  const renderPhotos = () => {
    $('#photo-edit', root).innerHTML = trip.photos.map((p) => `
      <div class="thumb"><img src="${p.data}" alt=""><button type="button" data-act="del-photo" data-id="${p.id}" aria-label="写真を削除">×</button></div>`).join('');
  };

  let prevRiver = trip.river;
  bindControls(root, trip, (path) => {
    if (path === 'river') {
      // 河川に観測所が設定されていれば自動で入れる（手で変えた値は上書きしない）
      const prevDefault = riverSetting(prevRiver)?.station || '';
      const nextDefault = riverSetting(trip.river)?.station || '';
      if (!trip.station || trip.station === prevDefault) trip.station = nextDefault;
      prevRiver = trip.river;
      refreshInputs();
      refreshRiver();
    }
    touch();
  });

  root.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      $$('.seg button', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      $$('.pane', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
      if (!isNew) history.replaceState(null, '', `#/edit/${trip.id}?tab=${tab}`);
      $('#view').scrollTop = 0;
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'sign') {
      if (has(trip.levelCm)) { trip.levelCm = -Number(trip.levelCm); refreshInputs(); touch(); }
      else { const el = $('input[data-path="levelCm"]', root); el.focus(); }
    } else if (act === 'copy-last') {
      const last = latestOtherTrip(trip.id);
      if (!last) return toast('前回の仕掛けがありません');
      trip.tackle = { ...trip.tackle, ...clone(last.tackle) };
      refreshInputs(); touch();
      toast(`${formatDate(last.date)}の仕掛けを入れました`);
    } else if (act === 'save-preset') {
      if (!Object.values(trip.tackle).some(Boolean)) return toast('仕掛けを入力してから保存してください');
      const name = prompt('プリセットの名前', trip.tackle.mainLine || '');
      if (!name) return;
      const p = { id: uid(), name, tackle: clone(trip.tackle) };
      await db.put('presets', p);
      state.presets.push(p);
      $('#preset-select', root).insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.name)}</option>`);
      toast('プリセットに保存しました');
    } else if (act === 'del-photo') {
      trip.photos = trip.photos.filter((p) => p.id !== e.target.dataset.id);
      renderPhotos(); touch();
    } else if (act === 'delete') {
      if (isNew && !dirty) { location.hash = '#/'; return; }
      if (!confirm(`${formatDate(trip.date)} ${trip.river} の釣行を削除しますか？`)) return;
      clearTimeout(timer);
      dirty = false;
      state.onLeave = null;
      await db.del('trips', trip.id);
      state.trips = state.trips.filter((t) => t.id !== trip.id);
      state.currentId = null;
      toast('削除しました');
      location.hash = '#/';
    }
  });

  $('#preset-select', root).addEventListener('change', (e) => {
    const p = state.presets.find((x) => x.id === e.target.value);
    e.target.value = '';
    if (!p) return;
    trip.tackle = { ...trip.tackle, ...clone(p.tackle) };
    refreshInputs(); touch();
    toast(`「${p.name}」を入れました`);
  });

  $('#photo-input', root).addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    toast('写真を取り込み中…');
    for (const f of files) {
      try { trip.photos.push({ id: uid(), data: await resizeImage(f) }); } catch { toast('読み込めない写真がありました'); }
    }
    renderPhotos(); touch();
  });

  $('#done').addEventListener('click', async () => {
    await save();
    state.onLeave = null;
    if (state.trips.some((t) => t.id === trip.id)) state.currentId = trip.id;
    location.hash = '#/';
  });

  refreshRiver();
  renderPhotos();
}

// ---------- 検索 ----------
function viewSearch() {
  setActiveTab('search');
  const q = { ...emptyQuery(), ...state.query };
  const root = mount(`<div class="top-title"><div>検索</div><div class="pos" id="hit"></div></div>`);
  const seasonOpts = seasons(state.trips);

  root.innerHTML = `
    <form class="form" autocomplete="off" onsubmit="return false">
      ${field('キーワード', input(q, 'text', 'type="search" placeholder="ポイント・仕掛け・メモなど（空白でAND）"'))}
      ${group('河川', chips(q, 'river', riverNames()))}
      <div class="row2">
        ${field('シーズン', `<select data-path="season"><option value="">すべて</option>${seasonOpts.map((y) => `<option value="${y}" ${String(q.season) === String(y) ? 'selected' : ''}>${y}年</option>`).join('')}</select>`)}
        ${field('匹数', `<div class="with-unit">${numInput(q, 'minCount', 'inputmode="numeric" min="0"')}<span>匹以上</span></div>`)}
      </div>
      <div class="row2">
        ${field('期間（から）', input(q, 'from', 'type="date"'))}
        ${field('期間（まで）', input(q, 'to', 'type="date"'))}
      </div>
      ${group('水位', chips(q, 'levelWord', LEVEL_WORDS))}
      ${group('濁り', chips(q, 'clarity', CLARITY))}
      ${group('垢の状態', chips(q, 'aka', AKA))}
      <div class="tools">
        <button type="button" class="btn primary" data-act="show">カードで見る</button>
        <button type="button" class="btn" data-act="clear">条件をクリア</button>
      </div>
    </form>
    <ul class="result-list" id="results"></ul>`;

  const refresh = () => {
    const list = sortTrips(filterTrips(state.trips, q)).reverse();
    $('#hit').textContent = `${list.length}件`;
    $('#results', root).innerHTML = list.slice(0, 100).map((t) => `
      <li><button type="button" data-open="${t.id}">
        <span class="r-date">${formatDate(t.date)}</span>
        <span class="r-main">${esc(t.river)} ${esc(t.point)}</span>
        <span class="r-num">${has(t.count) ? esc(t.count) + '匹' : '-'}${has(t.maxSize) ? ` / ${esc(t.maxSize)}cm` : ''}</span>
      </button></li>`).join('') || '<li class="muted">該当なし</li>';
  };

  bindControls(root, q, refresh);
  root.addEventListener('change', (e) => {
    if (e.target.matches('select[data-path]')) { setPath(q, e.target.dataset.path, e.target.value); refresh(); }
  });
  root.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (open || act === 'show') {
      state.query = { ...q };
      state.currentId = open ? open.dataset.open : null;
      location.hash = '#/';
    } else if (act === 'clear') {
      state.query = emptyQuery();
      viewSearch();
    }
  });
  refresh();
}

// ---------- シーズンまとめ ----------
function viewSeason(season) {
  setActiveTab('season');
  const years = seasons(state.trips);
  const year = Number(season) || years[0] || new Date().getFullYear();
  const trips = state.trips.filter((t) => seasonOf(t) === year);
  const s = summarize(trips);

  const root = mount(`<div class="top-title"><div>シーズンまとめ</div></div>
    <select id="season-select" class="top-select" aria-label="シーズン">
      ${(years.length ? years : [year]).map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}年</option>`).join('')}
    </select>`);

  const table = (head, rows) => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">データなし</p>';

  root.innerHTML = trips.length ? `
    <div class="tiles">
      <div class="tile"><span>釣行回数</span><b>${s.tripCount}</b>回</div>
      <div class="tile"><span>総匹数</span><b>${s.totalCount}</b>匹</div>
      <div class="tile"><span>平均</span><b>${s.avgCount}</b>匹/回</div>
      <div class="tile"><span>最大サイズ</span><b>${s.maxSize ?? '-'}</b>cm</div>
      <div class="tile"><span>総バラシ</span><b>${s.totalBare}</b>匹</div>
      <div class="tile"><span>1匹あたり</span><b>${s.costPerFish === null ? '-' : s.costPerFish.toLocaleString()}</b>円</div>
    </div>
    ${s.maxTrip ? `<p class="note">最大：${formatDate(s.maxTrip.date)} ${esc(s.maxTrip.river)} ${esc(s.maxTrip.point)}</p>` : ''}
    ${s.bestTrip ? `<p class="note">最多：${esc(s.bestTrip.count)}匹（${formatDate(s.bestTrip.date)} ${esc(s.bestTrip.river)}）</p>` : ''}
    <p class="note">費用合計：${yen(s.totalCost)}</p>

    <h3>河川別</h3>
    ${table(['河川', '回数', '匹数', '平均', '最大'], s.byRiver.map((r) => [esc(r.river), r.trips, r.count, r.avg, r.max]))}
    <h3>月別</h3>
    ${table(['月', '回数', '匹数', '平均', '最大'], s.byMonth.map((r) => [`${r.month}月`, r.trips, r.count, r.avg, r.max]))}
    <h3>水位（数値）別</h3>
    ${table(['河川・観測所', '水位', '回数', '平均', '最大'], s.byLevel.map((r) => [esc(r.river + (r.station ? `・${r.station}` : '')), r.range, r.trips, r.avg, r.max]))}

    <button type="button" class="btn primary wide" id="export">📊 ${year}シーズンをExcelで出力</button>
  ` : `<div class="empty"><p>${year}年の釣行はまだありません。</p></div>`;

  $('#season-select').addEventListener('change', (e) => { location.hash = `#/season/${e.target.value}`; });
  $('#export', root)?.addEventListener('click', () => {
    const bytes = seasonXlsx(trips, year);
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `鮎日記_${year}シーズン.xlsx`);
    toast('Excelファイルを保存しました');
  });
}

// ---------- 設定 ----------
function viewSettings() {
  setActiveTab('settings');
  const root = mount(`<div class="top-title"><div>設定</div></div>`);

  const render = () => {
    root.innerHTML = `
      <h3>河川と水位ページ</h3>
      <p class="muted">ここにある河川は入力画面でワンタップ選択できます。観測所は河川を選んだときに自動で入ります。</p>
      <div class="river-list">
        ${state.rivers.map((r, i) => `
          <div class="river-item" data-i="${i}">
            <div class="row2">
              ${field('河川名', `<input data-rf="name" value="${esc(r.name)}">`)}
              ${field('観測所', `<input data-rf="station" value="${esc(r.station)}" placeholder="未設定">`)}
            </div>
            ${field('水位ページURL', `<input data-rf="url" type="url" value="${esc(r.url)}" placeholder="https://...">`)}
            <div class="tools">
              ${r.url ? `<a class="btn small" href="${esc(r.url)}" target="_blank" rel="noopener">開いて確認</a>` : ''}
              <button type="button" class="btn small danger" data-act="del-river">この河川を外す</button>
            </div>
          </div>`).join('')}
      </div>
      <button type="button" class="btn small" data-act="add-river">＋ 河川を追加</button>

      <h3>仕掛けプリセット</h3>
      ${state.presets.length ? `<ul class="preset-list">${state.presets.map((p) => `
        <li><div><b>${esc(p.name)}</b><div class="muted">${esc(tackleSummary(p.tackle))}</div></div>
        <button type="button" class="btn small danger" data-act="del-preset" data-id="${p.id}">削除</button></li>`).join('')}</ul>`
        : '<p class="muted">入力画面の「仕掛け」欄にある「プリセットに保存」から登録できます。</p>'}

      <h3>バックアップ</h3>
      <p class="muted">記録はこのスマホの中だけに保存されています。機種変更やブラウザのデータ削除に備えて、ときどき書き出してください。（現在 ${state.trips.length} 件）</p>
      <div class="tools">
        <button type="button" class="btn" data-act="backup">書き出す</button>
        <label class="btn"><input type="file" accept="application/json,.json" hidden id="restore">読み込む</label>
      </div>

      <h3>このアプリについて</h3>
      <p class="muted">鮎日記 v${APP_VERSION}<br>Androidでは Chrome のメニューから「ホーム画面に追加」（または「アプリをインストール」）すると、アプリとして使えます。電波のない河原でも動きます。</p>
    `;
  };

  const saveRivers = async () => { await db.setKV('rivers', state.rivers); };

  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-rf]');
    if (!el) return;
    const i = Number(el.closest('.river-item').dataset.i);
    state.rivers[i][el.dataset.rf] = el.value.trim();
    saveRivers();
  });
  root.addEventListener('change', (e) => { if (e.target.closest('[data-rf="url"]')) render(); });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (act === 'add-river') {
      state.rivers.push({ name: '', station: '', url: '' });
      await saveRivers(); render();
      $$('.river-item input[data-rf="name"]', root).pop()?.focus();
    } else if (act === 'del-river') {
      const i = Number(btn.closest('.river-item').dataset.i);
      if (!confirm(`「${state.rivers[i].name || '（無名）'}」をボタンから外しますか？（過去の記録は消えません）`)) return;
      state.rivers.splice(i, 1);
      await saveRivers(); render();
    } else if (act === 'del-preset') {
      const p = state.presets.find((x) => x.id === btn.dataset.id);
      if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return;
      await db.del('presets', p.id);
      state.presets = state.presets.filter((x) => x.id !== p.id);
      render();
    } else if (act === 'backup') {
      const data = { app: 'ayu-nikki', version: 1, exportedAt: new Date().toISOString(), trips: state.trips, presets: state.presets, rivers: state.rivers };
      downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `鮎日記_バックアップ_${todayISO()}.json`);
      toast('バックアップを保存しました');
    }
  });

  root.addEventListener('change', async (e) => {
    if (e.target.id !== 'restore') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'ayu-nikki' || !Array.isArray(data.trips)) throw new Error('format');
      if (!confirm(`${data.trips.length}件の釣行を読み込みます。同じ記録は上書きされます。よろしいですか？`)) return;
      const trips = data.trips.map(normalizeTrip);
      await db.putMany('trips', trips);
      if (Array.isArray(data.presets)) await db.putMany('presets', data.presets);
      if (Array.isArray(data.rivers) && data.rivers.length) { state.rivers = data.rivers; await saveRivers(); }
      await load();
      toast(`${trips.length}件を読み込みました`);
      render();
    } catch {
      toast('バックアップファイルを読み込めませんでした');
    }
  });

  render();
}

// ---------- ルーティング ----------
async function route() {
  if (state.onLeave) {
    const fn = state.onLeave;
    state.onLeave = null;
    await fn();
  }
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  switch (parts[0]) {
    case 'new': return viewEdit(null, 'before');
    case 'edit': return viewEdit(parts[1], params.get('tab') || 'before');
    case 'search': return viewSearch();
    case 'season': return viewSeason(parts[1]);
    case 'settings': return viewSettings();
    default: return viewCards();
  }
}

async function load() {
  state.trips = (await db.getAll('trips')).map(normalizeTrip);
  state.presets = await db.getAll('presets');
  state.rivers = await db.getKV('rivers', clone(DEFAULT_RIVER_SETTINGS));
}

async function start() {
  try {
    await load();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><p>データを読み込めませんでした。</p><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  // 画面を閉じる・アプリを切り替えるときも保存する
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') state.onLeave?.(); });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const deck = $('#deck');
    if (deck && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      deck.scrollBy({ left: (e.key === 'ArrowLeft' ? -1 : 1) * deck.clientWidth, behavior: 'smooth' });
    }
  });
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
