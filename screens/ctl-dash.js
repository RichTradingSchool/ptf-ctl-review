// 동업자 컨트롤러 '현황' 탭 화면(대표 결정 2026-11-23 — config ctlDash가 켜진 빌드만, screens/ctl.js가 탭 하나로 붙임). 계산은 lib/ctl-dash.js.
// 기간(오늘·이번 주·이번 달·전체) → 가입자·활성화·거래·수수료와 커미션·포지션 카드(하루별 작은 막대) → (대표 보기 all) 동업자별 비교 → 회원 목록(검색·정렬).
// 받기는 탭이 보일 때만 — 처음·현황 탭을 누를 때와 60초마다. DOM은 createElement·textContent만(CSP — style 속성 없음: 막대 높이는 CSS 칸 ctl-db-h0~h20)
import { CTL_DASH_TEXT as T } from '../lib/ctl-dash-text.js';
import { CTL_TEXT } from '../lib/ctl-text.js';
import { DASH_PERIODS, DASH_SORTS, DASH_EXS, dashModel, barLevels, dayKey } from '../lib/ctl-dash.js';
import { fmtUsd } from '../lib/ctl-view.js';
import { fmtHM } from '../lib/auto-view.js';

export const DASH_REFRESH_MS = 60000;
export const DASH_ROWS_MAX = 200;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt0 = (v) => (num(v) ? Math.round(v).toLocaleString('en-US') : T.dash);
const signed = (v) => (num(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtUsd(Math.abs(v))}` : T.dash);
const tone = (v) => (num(v) && v > 0 ? 'good' : num(v) && v < 0 ? 'bad' : '');

// load: () => Promise<{ ok:true, now, all, … } | { ok:false, error, auth? }> — 앱은 ctl-client dash()
export function createCtlDash({ doc = globalThis.document, load, now = () => Date.now(), onAuth = () => {}, refreshMs = DASH_REFRESH_MS }) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const chip = (cls, text, on, onClick) => {
    const b = el('button', `ui-chip ${cls}${on ? ' on' : ''}`, text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!!on));
    b.addEventListener('click', onClick);
    return b;
  };
  // 칸 하나(휴대폰 카드에서만 보이는 칸 이름 + 값) — PC 표는 머리 줄
  const cell = (cls, label, value, extra = null) => {
    const c = el('span', cls);
    if (label) c.append(el('span', 'ctl-db-lab', label));
    c.append(el('span', 'ctl-db-cv', value));
    if (extra) c.append(extra);
    return c;
  };
  const S = { period: 'today', owner: null, q: '', sort: 'join', data: null, err: null, at: 0, seq: 0, busy: false };

  // ── 뼈대(한 번 — 검색 칸은 다시 그리지 않음: 글을 넣는 동안 초점이 남게) ──
  const node = el('div', 'ctl-dash');
  const head = el('div', 'ctl-db-head');
  const periods = el('div', 'ctl-db-periods');
  periods.setAttribute('role', 'group');
  const asOf = el('span', 'ctl-db-asof');
  head.append(periods, asOf);
  const owners = el('div', 'ctl-db-owners');
  const msg = el('p', 'ctl-db-msg');
  msg.setAttribute('role', 'status');
  const cards = el('div', 'ctl-db-cards');
  const partners = el('section', 'ctl-db-sec ctl-db-partners');
  const list = el('section', 'ctl-db-sec ctl-db-list');
  const listHead = el('h3', 'ctl-db-title', T.sec.list);
  const tools = el('div', 'ctl-db-tools');
  const search = el('input', 'ctl-db-search');
  search.type = 'search';
  search.setAttribute('placeholder', T.search);
  search.setAttribute('aria-label', T.search);
  search.setAttribute('autocomplete', 'off');
  search.setAttribute('spellcheck', 'false');
  search.addEventListener('input', () => { S.q = String(search.value || ''); renderList(); });
  const sorts = el('div', 'ctl-db-sorts');
  tools.append(search, sorts);
  const listBox = el('div', 'ctl-db-rows');
  list.append(listHead, tools, listBox);
  node.append(head, owners, msg, cards, partners, list);

  let model = null;
  const compute = () => { model = S.data ? dashModel(S.data, { period: S.period, owner: S.owner, q: S.q, sort: S.sort }) : null; };

  function renderChips() {
    periods.replaceChildren(...DASH_PERIODS.map((p) => {
      const b = chip('ctl-db-period', T.periods[p], S.period === p, () => { S.period = p; render(); });
      b.dataset.period = p;
      return b;
    }));
    sorts.replaceChildren(...DASH_SORTS.map((k) => {
      const b = chip('ctl-db-sort', T.sorts[k], S.sort === k, () => { S.sort = k; renderList(); renderChips(); });
      b.dataset.sort = k;
      return b;
    }));
    const showOwners = !!(S.data && S.data.all && model && model.owners.length);
    owners.hidden = !showOwners;
    if (!showOwners) { owners.replaceChildren(); return; }
    owners.replaceChildren(
      chip('ctl-db-owner', T.ownerAll, S.owner == null, () => { S.owner = null; render(); }),
      ...model.owners.map((o) => {
        const b = chip('ctl-db-owner', o, S.owner === o, () => { S.owner = o; render(); });
        b.dataset.owner = o;
        return b;
      }),
    );
  }
  const stat = (label, value, cls = '') => {
    const s = el('div', `ctl-db-stat${cls ? ` ${cls}` : ''}`);
    s.append(el('span', 'ctl-db-k', label), el('span', 'ctl-db-v', value));
    return s;
  };
  const tag = (isExact) => el('span', `ctl-db-tag ${isExact ? 'exact' : 'est'}`, isExact ? T.fee.exact : T.fee.est);
  function barsNode(bars, label, fmtV) {
    const box = el('div', 'ctl-db-chart');
    const levels = barLevels(bars);
    const row = el('div', 'ctl-db-bars');
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', label);
    bars.forEach((b, i) => {
      const bar = el('span', `ctl-db-bar ctl-db-h${levels[i]}${b.out ? ' out' : ''}`);
      bar.setAttribute('title', `${b.d.slice(5)} · ${fmtV(b.v)}`);
      row.append(bar);
    });
    const axis = el('div', 'ctl-db-axis');
    axis.append(el('span', null, bars.length ? bars[0].d.slice(5) : ''), el('span', 'ctl-db-axis-k', label), el('span', null, bars.length ? bars[bars.length - 1].d.slice(5) : ''));
    box.append(row, axis);
    return box;
  }
  function card(key, ...kids) {
    const c = el('section', `ctl-db-sec ctl-db-card ctl-db-card-${key}`); // ctl-db-fee 같은 목록 칸 이름과 겹치지 않게
    c.append(el('h3', 'ctl-db-title', T.sec[key]), ...kids);
    return c;
  }
  const grid = (...items) => { const g = el('div', 'ctl-db-grid'); g.append(...items); return g; };
  function renderCards() {
    const m = model;
    // 가입자
    const su = card('signup',
      grid(stat(T.total, T.people(m.signup.total), 'big'), stat(T.newIn, T.people(m.signup.newN), 'big accent'),
        ...DASH_EXS.map((x) => stat(CTL_TEXT.ex[x], `${T.people(m.signup.byEx[x].total)} · ${T.newIn} ${m.signup.byEx[x].newN}`, `ex ${x}`))),
      barsNode(m.signup.bars, T.perDay, (v) => T.people(v)));
    // 활성화(지금 모습)
    const A = T.act;
    const ac = card('act', grid(stat(A.activated, T.people(m.act.activated), 'big'), stat(A.newAct, m.act.newAct == null ? T.dash : T.people(m.act.newAct), 'big accent'),
      stat(A.funded, T.people(m.act.funded)), stat(A.low, T.people(m.act.low), m.act.low ? 'warn' : ''), stat(A.auto, T.people(m.act.auto)),
      stat(A.withPos, T.people(m.act.withPos)), ...(m.act.unknown ? [stat(A.unknown, T.people(m.act.unknown), 'dim')] : [])));
    // 거래(Trade History)
    const R = T.trade;
    const who = (xs) => (xs.length ? xs.map((x) => `${T.tail(x.tail)} ${signed(x.pnl)}`).join(' · ') : R.none);
    const tr = card('trade', grid(stat(R.n, T.count(m.trade.n), 'big'), stat(R.vol, T.usdt(fmt0(m.trade.vol)), 'big'),
      stat(R.traders, T.people(m.trade.traders)), stat(R.api, m.trade.apiPct == null ? T.dash : T.pct(m.trade.apiPct)),
      stat(R.pnl, T.usdt(signed(m.trade.pnl)), `wide ${tone(m.trade.pnl)}`)),
    stat(R.syms, m.trade.syms.length ? m.trade.syms.map((x) => T.sym(x.s, x.pct)).join(' · ') : R.none, 'line'),
    stat(R.top, who(m.trade.top), 'line good'), stat(R.bottom, who(m.trade.bottom), 'line bad'));
    // 수수료·커미션 — 수수료는 거래 내역 값, 커미션은 거래소마다 정확·추정 꼬리표
    const commSum = stat(T.fee.comm, m.fee.total == null ? T.dash : T.usdt(fmtUsd(m.fee.total)), 'big accent');
    if (m.fee.anyEst) commSum.append(tag(false));
    const exStats = DASH_EXS.map((x) => {
      const f = m.fee.byEx[x];
      const s = stat(CTL_TEXT.ex[x], T.exLine(fmtUsd(f.fee), f.comm == null ? T.fee.none : fmtUsd(f.comm)), `ex ${x}`);
      if (f.comm != null) s.append(tag(f.exact));
      return s;
    });
    const notes = [el('p', 'ctl-db-note', [T.feeNote, m.fee.anyEst ? T.estNote : T.exactNote].join(' · '))];
    if (m.fee.missing.length) notes.push(el('p', 'ctl-db-note warn', T.missing(m.fee.missing)));
    const fe = card('fee', grid(stat(T.fee.fee, T.usdt(fmtUsd(m.fee.fee)), 'big'), commSum, ...exStats), barsNode(m.fee.bars, T.commPerDay, (v) => fmtUsd(v)), ...notes);
    // 포지션(거래소 스냅숏)
    const P = T.pos;
    const p = m.positions;
    const po = p ? card('pos', grid(stat(P.members, T.people(p.members), 'big'), stat(P.val, T.usdt(fmt0(p.val)), 'big'),
      stat(P.side, T.side(p.long, p.short)), stat(P.upnl, p.upnl == null ? T.dash : T.usdt(signed(p.upnl)), tone(p.upnl))),
    stat(P.syms, p.syms.length ? p.syms.map(T.posSym).join(' · ') : T.trade.none, 'line'),
    el('p', 'ctl-db-note', `${P.note} · ${T.asOf(fmtHM(p.at))}`)) : card('pos', el('p', 'ctl-db-note', P.none));
    cards.replaceChildren(su, ac, tr, fe, po);
  }
  function renderPartners() {
    const ps = model.partners;
    partners.hidden = !ps;
    if (!ps) { partners.replaceChildren(); return; }
    const P = T.pcols;
    const hrow = el('div', 'ctl-db-prow head');
    for (const t of [P.o, P.rate, P.total, P.newN, P.activated, P.n, P.vol, P.fee, P.comm]) hrow.append(el('span', null, t));
    const rows = ps.map((x) => {
      const r = el('div', `ctl-db-prow${S.owner != null && S.owner === x.o ? ' on' : ''}`);
      r.dataset.owner = x.o || '';
      r.append(
        el('span', 'ctl-db-po', x.o || T.noOwner),
        cell('ctl-db-prate', null, x.rate == null ? T.dash : T.rate(x.rate, x.apiRate)),
        cell('ctl-db-pc', P.total, T.people(x.total)), cell('ctl-db-pc', P.newN, T.people(x.newN)), cell('ctl-db-pc', P.activated, T.people(x.activated)),
        cell('ctl-db-pc', P.n, T.count(x.n)), cell('ctl-db-pc', P.vol, fmt0(x.vol)), cell('ctl-db-pc', P.fee, fmtUsd(x.fee)),
        cell('ctl-db-pc ctl-db-pcomm', P.comm, x.comm == null ? T.dash : fmtUsd(x.comm), x.comm != null && x.est ? tag(false) : null),
      );
      return r;
    });
    partners.replaceChildren(el('h3', 'ctl-db-title', T.sec.partners), hrow, ...rows);
  }
  function renderList() {
    if (!S.data) { listBox.replaceChildren(); return; }
    compute();
    const C = T.cols;
    const hrow = el('div', 'ctl-db-hrow');
    for (const t of [C.uid, C.ex, C.join, C.band, C.auto, C.n, C.vol, C.fee, C.comm]) hrow.append(el('span', null, t));
    const kids = [hrow];
    if (!model.rows.length) kids.push(el('p', 'ctl-empty', T.noRows));
    for (const r of model.rows.slice(0, DASH_ROWS_MAX)) {
      const row = el('div', 'ctl-db-row');
      row.dataset.h = r.h;
      const uid = el('span', 'ctl-db-uid');
      uid.append(el('span', 'ctl-db-uidv', r.uid || CTL_TEXT.uidWait));
      if (S.data.all && S.owner == null) uid.append(el('span', 'ctl-db-ro', r.o || T.noOwner));
      if (r.act === false) uid.append(el('span', 'ctl-db-noact', T.noAct));
      const auto = r.auto === true ? T.auto.on : r.auto === false ? T.auto.off : T.auto.none;
      row.append(uid, cell(`ctl-db-ex ${r.ex}`, null, CTL_TEXT.ex[r.ex]), cell('ctl-db-join', C.join, num(r.joinAt) ? dayKey(r.joinAt).slice(2) : T.dash),
        cell(`ctl-db-band ${r.band}`, C.band, T.bands[r.band]), cell(`ctl-db-auto${r.auto === true ? ' good' : ''}`, C.auto, auto),
        cell('ctl-db-n', C.n, String(r.n)), cell('ctl-db-vol', C.vol, fmt0(r.vol)), cell('ctl-db-fee', C.fee, fmtUsd(r.fee)),
        cell('ctl-db-comm', C.comm, r.comm == null ? T.dash : fmtUsd(r.comm)));
      kids.push(row);
    }
    if (model.rows.length > DASH_ROWS_MAX) kids.push(el('p', 'ctl-db-more', T.rowsMore(model.rows.length - DASH_ROWS_MAX)));
    listBox.replaceChildren(...kids);
  }
  function render() {
    compute();
    renderChips();
    if (!S.data) {
      msg.textContent = S.err ? T.err[S.err] || T.err.down : T.loading;
      asOf.textContent = '';
      for (const n of [cards, partners, listBox]) n.replaceChildren();
      partners.hidden = true;
      list.hidden = true;
      return;
    }
    msg.textContent = S.err ? T.err[S.err] || T.err.down : '';
    asOf.textContent = T.asOf(fmtHM(S.data.now));
    list.hidden = false;
    renderCards();
    renderPartners();
    renderList();
  }

  async function refresh(force = false) {
    if (S.busy) return;
    if (!force && S.data && now() - S.at < refreshMs) return;
    S.busy = true;
    S.seq += 1;
    const mine = S.seq;
    let r;
    try {
      r = await load();
    } catch {
      r = { ok: false, error: 'down' };
    }
    if (mine !== S.seq) return; // 그 사이 reset(로그아웃·다른 동업자) — 늦은 답은 버림
    S.busy = false;
    if (r && r.auth) { onAuth(); return; }
    if (r && r.ok) {
      S.data = { now: r.now, all: r.all, rates: r.rates, exact: r.exact, members: r.members, days: r.days, syms: r.syms, comm: r.comm, pos: r.pos };
      S.err = null;
      S.at = now();
      if (!r.all) S.owner = null;
      else if (S.owner != null && !r.members.some((m) => m.o === S.owner)) S.owner = null;
    } else S.err = (r && r.error) || 'down';
    render();
  }
  // 로그인 세션 하나가 만든 것을 모두 비움(screens/ctl.js resetSession과 같은 결 — 다음 동업자에게 앞 범위 UID·금액이 남지 않게)
  function reset() {
    S.seq += 1;
    S.busy = false;
    S.data = null;
    S.err = null;
    S.at = 0;
    S.period = 'today';
    S.owner = null;
    S.q = '';
    S.sort = 'join';
    search.value = '';
    for (const n of [cards, partners, listBox, owners, periods, sorts]) n.replaceChildren();
    asOf.textContent = '';
    msg.textContent = '';
  }
  return { node, render, refresh, reset, state: () => ({ period: S.period, owner: S.owner, q: S.q, sort: S.sort, loaded: !!S.data, err: S.err }) };
}
