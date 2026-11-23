// 동업자 컨트롤러 '현황' 탭(대표 결정 2026-11-23 — 설계 docs/superpowers/specs/2026-11-23-ptf-ctl-dash-design.md) 계산 — DOM 없음
// (screens/ctl-dash.js가 그린다, 시험은 이것을 바로 부름). config ctlDash가 true인 빌드만 쓴다(기본 false — 회원 빌드·지금 컨트롤러는 이 길을 열지 않음).
// - 허브 답 GET /v1/ctl/dash(hub/lib/ctl-routes.js dashList ← ctl-dash-store.js — 대표 PC floor-sync가 파트너 관리 화면에서 새 줄만 보낸 것을 쌓은 값) 꼴:
//   { ok, v:1, now, all, rates:{ox,tb}, exact:{ox,tb}, members, days, syms, comm, pos }
//   members = 그 동업자 범위 회원(규칙 27 — 대표 all이면 전체) { h, uid, o, ex, joinAt, act, actAt, bal, auto, pos }
//   days = 회원·하루(한국 날짜)마다 Trade History 모음 { h, d, n(매매 수), vol, fee(낸 거래 수수료 — 정확), feeApi(api 몫), pnl, api(api 매매 수) }
//   syms = 하루·종목마다 { d, s, n, vol } · comm = Commission Distribution Records 하루 모음 { ex, o, d, kind:'perp'|'api', usdt } | null
//   pos = Current Positions 스냅숏 { at, rows:[{ h, s, dir, val, lev, upnl }] } | null · rates = Partner Commission 비율 { o, rate, apiRate }
// - 커미션: 정확 = 지급 기록(exact[ex]), 없으면 추정 = (수수료 − api 수수료) × 그 동업자 일반 비율 + api 수수료 × API 비율(꼬리표 '추정')
// - 기간은 한국 시각: 오늘·이번 주(월요일부터)·이번 달(1일부터)·전체. 금액·UID는 이 화면(동업자 범위)에만 — 위·아래 회원은 UID 끝 4자리만
export const DASH_PERIODS = Object.freeze(['today', 'week', 'month', 'all']);
export const DASH_SORTS = Object.freeze(['join', 'bal', 'n', 'vol', 'fee']);
export const DASH_EXS = Object.freeze(['ox', 'tb']);
export const DASH_BANDS = Object.freeze(['b0', 'b1', 'b2', 'b3', 'unknown']); // 50 미만·50~500·500~5천·5천 이상·모름
export const DASH_BAND_EDGES = Object.freeze([50, 500, 5000]);
export const DASH_LOW_BAL = 50; // 잔고 50 미만(동업자판 nofund·컨트롤러 필터와 같은 50 USDT)
export const DASH_MIN_BARS = 7; // 하루별 막대는 적어도 7일(기간 밖 날은 흐리게)
export const DASH_MAX_BARS = 90;
export const DASH_TOP_N = 3;
export const DASH_SYM_N = 5;
export const DASH_KEYS = Object.freeze(['ok', 'v', 'now', 'all', 'rates', 'exact', 'members', 'days', 'syms', 'comm', 'pos']);
export const DASH_MEMBER_KEYS = Object.freeze(['h', 'uid', 'o', 'ex', 'joinAt', 'act', 'actAt', 'bal', 'auto', 'pos']);
export const DASH_DAY_KEYS = Object.freeze(['h', 'd', 'n', 'vol', 'fee', 'feeApi', 'pnl', 'api']);
export const DASH_SYMDAY_KEYS = Object.freeze(['d', 's', 'n', 'vol']);
export const DASH_COMM_KEYS = Object.freeze(['ex', 'o', 'd', 'kind', 'usdt']);
export const DASH_POS_KEYS = Object.freeze(['h', 's', 'dir', 'val', 'lev', 'upnl']);
export const DASH_RATE_KEYS = Object.freeze(['o', 'rate', 'apiRate']);
const MEMBERS_MAX = 5000;
const ROWS_MAX = 200000;
const KST_MS = 9 * 3600000;
const DAY_MS = 86400000;
const HASH_RE = /^[0-9a-f]{64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UID_RE = /^[0-9A-Z-]{1,24}$/;
const OWNER_RE = /^[A-Za-z0-9_.@-]{1,32}$/;
const SYM_RE = /^[A-Z0-9]{1,20}$/;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => v === null || num(v);
const boolOrNull = (v) => v === null || typeof v === 'boolean';
const exact = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const round2 = (v) => Math.round(v * 100) / 100;
const ownerOk = (o) => o === null || (typeof o === 'string' && OWNER_RE.test(o));
const dayOk = (d) => typeof d === 'string' && DAY_RE.test(d);
const arrOf = (a, max, ok) => Array.isArray(a) && a.length <= max && a.every(ok);

// 한국 날짜 'YYYY-MM-DD'
export const dayKey = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);
export const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// 기간 첫날(한국 날짜) — 전체는 null
export function periodStart(period, nowMs) {
  const today = dayKey(nowMs);
  if (period === 'today') return today;
  if (period === 'week') {
    const wd = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = 일요일
    return addDays(today, -((wd + 6) % 7));
  }
  if (period === 'month') return `${today.slice(0, 8)}01`;
  return null;
}
const inPeriod = (d, start, today) => (start == null || d >= start) && d <= today;

const okRate = (r) => exact(r, DASH_RATE_KEYS) && typeof r.o === 'string' && OWNER_RE.test(r.o) && num(r.rate) && r.rate >= 0 && r.rate <= 100 && num(r.apiRate) && r.apiRate >= 0 && r.apiRate <= 100;
const okMember = (m) => exact(m, DASH_MEMBER_KEYS) && typeof m.h === 'string' && HASH_RE.test(m.h)
  && (m.uid === null || (typeof m.uid === 'string' && UID_RE.test(m.uid))) && ownerOk(m.o)
  && DASH_EXS.includes(m.ex) && numOrNull(m.joinAt) && boolOrNull(m.act) && numOrNull(m.actAt) && (m.bal === null || (num(m.bal) && m.bal >= 0))
  && boolOrNull(m.auto) && Number.isInteger(m.pos) && m.pos >= 0 && m.pos <= 50;
const okDay = (r) => exact(r, DASH_DAY_KEYS) && typeof r.h === 'string' && HASH_RE.test(r.h) && dayOk(r.d)
  && Number.isInteger(r.n) && r.n >= 0 && num(r.vol) && r.vol >= 0 && num(r.fee) && num(r.feeApi) && num(r.pnl) && Number.isInteger(r.api) && r.api >= 0 && r.api <= r.n;
const okSym = (r) => exact(r, DASH_SYMDAY_KEYS) && dayOk(r.d) && typeof r.s === 'string' && SYM_RE.test(r.s) && Number.isInteger(r.n) && r.n >= 0 && num(r.vol) && r.vol >= 0;
const okComm = (c) => exact(c, DASH_COMM_KEYS) && DASH_EXS.includes(c.ex) && typeof c.o === 'string' && OWNER_RE.test(c.o) && dayOk(c.d) && (c.kind === 'perp' || c.kind === 'api') && num(c.usdt);
const okPos = (p) => exact(p, DASH_POS_KEYS) && typeof p.h === 'string' && HASH_RE.test(p.h) && typeof p.s === 'string' && SYM_RE.test(p.s)
  && (p.dir === 'long' || p.dir === 'short') && num(p.val) && p.val >= 0 && (p.lev === null || (Number.isInteger(p.lev) && p.lev >= 1)) && numOrNull(p.upnl);

// 허브 답 → 꼴이 정확하면 정리한 사본, 아니면 null(모르는 칸이 끼면 통째로 버림 — 컨트롤러 목록과 같은 결)
export function checkDash(b) {
  if (!exact(b, DASH_KEYS) || b.ok !== true || b.v !== 1 || !num(b.now) || typeof b.all !== 'boolean') return null;
  if (!exact(b.rates, DASH_EXS) || !DASH_EXS.every((x) => arrOf(b.rates[x], 200, okRate))) return null;
  if (!exact(b.exact, DASH_EXS) || !DASH_EXS.every((x) => typeof b.exact[x] === 'boolean')) return null;
  if (!arrOf(b.members, MEMBERS_MAX, okMember)) return null;
  const hs = new Set(b.members.map((m) => m.h));
  if (hs.size !== b.members.length) return null;
  if (!arrOf(b.days, ROWS_MAX, (r) => okDay(r) && hs.has(r.h))) return null;
  if (!arrOf(b.syms, ROWS_MAX, okSym)) return null;
  if (!(b.comm === null || arrOf(b.comm, ROWS_MAX, okComm))) return null;
  if (!(b.pos === null || (exact(b.pos, ['at', 'rows']) && num(b.pos.at) && arrOf(b.pos.rows, MEMBERS_MAX * 4, (p) => okPos(p) && hs.has(p.h))))) return null;
  const copy = (a) => a.map((x) => ({ ...x }));
  return {
    now: b.now, all: b.all,
    rates: { ox: copy(b.rates.ox), tb: copy(b.rates.tb) },
    exact: { ox: b.exact.ox, tb: b.exact.tb },
    members: copy(b.members), days: copy(b.days), syms: copy(b.syms),
    comm: b.comm ? copy(b.comm) : null, pos: b.pos ? { at: b.pos.at, rows: copy(b.pos.rows) } : null,
  };
}

export function bandOf(bal) {
  if (!num(bal)) return 'unknown';
  const i = DASH_BAND_EDGES.findIndex((e) => bal < e);
  return i < 0 ? 'b3' : `b${i}`;
}
export const uidTail = (uid) => (typeof uid === 'string' && uid.length ? uid.slice(-4) : null);
// 추정 커미션 = (수수료 − api 수수료) × 일반 비율 % + api 수수료 × API 비율 % — 그 동업자 비율이 없으면 null
export const estComm = (fee, feeApi, rate) => (rate && num(fee) && num(feeApi) ? ((fee - feeApi) * rate.rate + feeApi * rate.apiRate) / 100 : null);
const addN = (a, b) => (b == null ? a : (a == null ? 0 : a) + b);

// 막대 날짜들 — 기간 첫날(전체면 자료 첫날)부터 오늘까지, 적어도 7일(앞 날은 기간 밖), 많아야 90일
function barDays(start, today, firstData) {
  let from = start != null ? start : firstData || today;
  const minFrom = addDays(today, -(DASH_MIN_BARS - 1));
  if (from > minFrom) from = minFrom;
  const maxFrom = addDays(today, -(DASH_MAX_BARS - 1));
  if (from < maxFrom) from = maxFrom;
  const out = [];
  for (let d = from; d <= today; d = addDays(d, 1)) out.push(d);
  return out;
}

// 보기 계산 — opts { period, owner(대표 보기의 동업자 거르기 — null 전체), q(UID 검색), sort }
export function dashModel(data, { period = 'today', owner = null, q = '', sort = 'join' } = {}) {
  const today = dayKey(data.now);
  const start = periodStart(DASH_PERIODS.includes(period) ? period : 'today', data.now);
  const ownerOn = data.all && owner != null;
  const members = ownerOn ? data.members.filter((m) => (m.o || '') === owner) : data.members;
  const byH = new Map(members.map((m) => [m.h, m]));
  const days = data.days.filter((r) => byH.has(r.h));
  const comm = data.comm ? data.comm.filter((c) => !ownerOn || c.o === owner) : null;
  const exactOn = (ex) => data.exact[ex] === true && comm !== null;
  const rateOf = (ex, o) => (o ? data.rates[ex].find((r) => r.o === o) || null : null);
  const firstData = [...members.map((m) => (num(m.joinAt) ? dayKey(m.joinAt) : null)), ...days.map((r) => r.d)].filter(Boolean).sort()[0] || null;
  const bars = barDays(start, today, firstData);
  const inP = (d) => inPeriod(d, start, today);

  // 가입자 — 거래소별 전체·기간 신규, 하루별 신규
  const signup = { byEx: {}, total: members.length, newN: 0 };
  for (const ex of DASH_EXS) signup.byEx[ex] = { total: 0, newN: 0 };
  const joinByDay = new Map();
  for (const m of members) {
    signup.byEx[m.ex].total += 1;
    if (!num(m.joinAt)) continue;
    const d = dayKey(m.joinAt);
    joinByDay.set(d, (joinByDay.get(d) || 0) + 1);
    if (inP(d)) { signup.byEx[m.ex].newN += 1; signup.newN += 1; }
  }
  signup.bars = bars.map((d) => ({ d, v: joinByDay.get(d) || 0, out: !inP(d) }));

  // 활성화 — 지금 모습(기간과 무관): 앱 활성화·잔고 50 이상·미만·모름·오토 켜짐·포지션 있음(앱 매매). 기간 활성화는 활성화 시각을 아는 회원만(없으면 null)
  const act = { activated: 0, funded: 0, low: 0, unknown: 0, auto: 0, withPos: 0, newAct: null };
  for (const m of members) {
    if (m.act === true) act.activated += 1;
    if (num(m.actAt)) act.newAct = (act.newAct || 0) + (inP(dayKey(m.actAt)) ? 1 : 0);
    if (!num(m.bal)) act.unknown += 1;
    else if (m.bal >= DASH_LOW_BAL) act.funded += 1;
    else act.low += 1;
    if (m.auto === true) act.auto += 1;
    if (m.pos > 0) act.withPos += 1;
  }

  // 거래(Trade History) — 회원별 기간 합·추정 커미션
  const per = new Map(members.map((m) => [m.h, { n: 0, vol: 0, fee: 0, pnl: 0, api: 0, comm: null }]));
  const estByDay = new Map(); // 하루 → 거래소 → 추정 커미션
  const feeByEx = { ox: 0, tb: 0 };
  const missing = new Set(); // 비율을 모르는 동업자(추정 못 함)
  for (const r of days) {
    const m = byH.get(r.h);
    const rate = rateOf(m.ex, m.o);
    const e = estComm(r.fee, r.feeApi, rate);
    if (e == null && r.fee) missing.add(m.o || '');
    const k = estByDay.get(r.d) || { ox: null, tb: null };
    k[m.ex] = addN(k[m.ex], e);
    estByDay.set(r.d, k);
    if (!inP(r.d)) continue;
    const p = per.get(r.h);
    p.n += r.n;
    p.vol += r.vol;
    p.fee += r.fee;
    p.pnl += r.pnl;
    p.api += r.api;
    p.comm = addN(p.comm, e);
    feeByEx[m.ex] += r.fee;
  }
  const trade = { n: 0, vol: 0, fee: 0, pnl: 0, api: 0 };
  for (const p of per.values()) { trade.n += p.n; trade.vol += p.vol; trade.fee += p.fee; trade.pnl += p.pnl; trade.api += p.api; }
  for (const k of ['vol', 'fee', 'pnl']) trade[k] = round2(trade[k]);
  trade.apiPct = trade.n ? Math.round((trade.api / trade.n) * 100) : null;
  trade.traders = [...per.values()].filter((p) => p.n > 0).length;
  const traded = members.filter((m) => per.get(m.h).n > 0).map((m) => ({ tail: uidTail(m.uid), pnl: round2(per.get(m.h).pnl) }));
  const byPnl = [...traded].sort((a, b) => b.pnl - a.pnl);
  trade.top = byPnl.filter((x) => x.pnl > 0).slice(0, DASH_TOP_N);
  trade.bottom = byPnl.filter((x) => x.pnl < 0).reverse().slice(0, DASH_TOP_N);
  // 종목 — 기간 거래량 위 다섯(그 범위 전체 모음 — 동업자 거르기는 종목 모음에 없음)
  const symG = new Map();
  for (const r of data.syms) {
    if (!inP(r.d)) continue;
    const x = symG.get(r.s) || { s: r.s, n: 0, vol: 0 };
    x.n += r.n;
    x.vol += r.vol;
    symG.set(r.s, x);
  }
  const symVol = [...symG.values()].reduce((s, x) => s + x.vol, 0);
  trade.syms = [...symG.values()].sort((a, b) => b.vol - a.vol).slice(0, DASH_SYM_N)
    .map((x) => ({ s: x.s, n: x.n, vol: round2(x.vol), pct: symVol > 0 ? Math.round((x.vol / symVol) * 100) : 0 }));

  // 수수료·커미션 — 수수료는 Trade History 값(정확), 커미션은 거래소마다 지급 기록(정확) 또는 추정, 기간 합·하루별
  const exactByDay = new Map(); // 하루 → 거래소 → 지급 합
  for (const c of comm || []) {
    const k = exactByDay.get(c.d) || { ox: 0, tb: 0 };
    k[c.ex] += c.usdt;
    exactByDay.set(c.d, k);
  }
  const dayComm = (d) => {
    let s = null;
    for (const ex of DASH_EXS) s = addN(s, exactOn(ex) ? (exactByDay.get(d) || { ox: 0, tb: 0 })[ex] : (estByDay.get(d) || { ox: null, tb: null })[ex]);
    return s;
  };
  const fee = { byEx: {}, fee: round2(trade.fee), total: null, anyEst: false, missing: [...missing].filter(Boolean).sort() };
  const periodDays = new Set([...estByDay.keys(), ...exactByDay.keys()].filter(inP));
  for (const ex of DASH_EXS) {
    let v = exactOn(ex) ? 0 : null;
    for (const d of periodDays) v = addN(v, exactOn(ex) ? (exactByDay.get(d) || { ox: 0, tb: 0 })[ex] : (estByDay.get(d) || { ox: null, tb: null })[ex]);
    if (!exactOn(ex) && v == null && data.rates[ex].length) v = 0;
    fee.byEx[ex] = { fee: round2(feeByEx[ex]), comm: v == null ? null : round2(v), exact: exactOn(ex) };
    if (!exactOn(ex) && fee.byEx[ex].comm != null) fee.anyEst = true; // 자료가 없는 거래소(투빗 캡처 전)는 추정에 세지 않음
    fee.total = addN(fee.total, fee.byEx[ex].comm);
  }
  if (fee.total != null) fee.total = round2(fee.total);
  fee.bars = bars.map((d) => ({ d, v: round2(dayComm(d) || 0), out: !inP(d) }));

  // 포지션(Current Positions 스냅숏 — 앱 밖 포지션 포함) — 없으면 null
  let positions = null;
  if (data.pos) {
    const rows = data.pos.rows.filter((p) => byH.has(p.h));
    const sym = new Map();
    for (const p of rows) {
      const x = sym.get(p.s) || { s: p.s, n: 0, val: 0, long: 0, short: 0 };
      x.n += 1;
      x.val += p.val;
      x[p.dir] += 1;
      sym.set(p.s, x);
    }
    positions = {
      at: data.pos.at, members: new Set(rows.map((p) => p.h)).size, n: rows.length,
      long: rows.filter((p) => p.dir === 'long').length, short: rows.filter((p) => p.dir === 'short').length,
      val: round2(rows.reduce((s, p) => s + p.val, 0)), upnl: rows.some((p) => p.upnl != null) ? round2(rows.reduce((s, p) => s + (p.upnl || 0), 0)) : null,
      syms: [...sym.values()].sort((a, b) => b.val - a.val).slice(0, DASH_SYM_N).map((x) => ({ ...x, val: round2(x.val) })),
    };
  }
  const posCount = new Map();
  if (data.pos) for (const p of data.pos.rows) posCount.set(p.h, (posCount.get(p.h) || 0) + 1);

  // 회원 목록 — 검색(UID 일부)·정렬
  const qq = String(q || '').trim().toUpperCase();
  let rows = members.map((m) => {
    const p = per.get(m.h);
    return { h: m.h, uid: m.uid, o: m.o, ex: m.ex, joinAt: m.joinAt, bal: m.bal, band: bandOf(m.bal), auto: m.auto, act: m.act,
      pos: data.pos ? posCount.get(m.h) || 0 : m.pos, n: p.n, vol: round2(p.vol), fee: round2(p.fee), comm: p.comm == null ? null : round2(p.comm) };
  });
  if (qq) rows = rows.filter((r) => typeof r.uid === 'string' && r.uid.includes(qq));
  const key = DASH_SORTS.includes(sort) ? sort : 'join';
  const val = (r) => (key === 'join' ? r.joinAt : r[key]);
  rows.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x == null && y == null) return String(a.uid || '').localeCompare(String(b.uid || ''));
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || String(a.uid || '').localeCompare(String(b.uid || ''));
  });

  // 대표 보기(all) — 동업자별 한 줄(비율·가입자·기간 신규·활성화·매매·거래량·수수료·커미션). 동업자 칸이 없는 회원은 '미지정'(o null)
  let partners = null;
  if (data.all) {
    const g = new Map();
    const pOf = (o) => {
      if (!g.has(o)) {
        const r = o ? rateOf('ox', o) : null;
        g.set(o, { o, rate: r ? r.rate : null, apiRate: r ? r.apiRate : null, total: 0, newN: 0, activated: 0, n: 0, vol: 0, fee: 0, comm: null, est: false });
      }
      return g.get(o);
    };
    for (const m of data.members) {
      const x = pOf(m.o || null);
      x.total += 1;
      if (num(m.joinAt) && inP(dayKey(m.joinAt))) x.newN += 1;
      if (m.act === true) x.activated += 1;
    }
    const mOf = new Map(data.members.map((m) => [m.h, m]));
    for (const r of data.days) {
      if (!inP(r.d)) continue;
      const m = mOf.get(r.h);
      const x = pOf(m.o || null);
      x.n += r.n;
      x.vol += r.vol;
      x.fee += r.fee;
      if (!(data.exact[m.ex] && data.comm)) {
        x.comm = addN(x.comm, estComm(r.fee, r.feeApi, rateOf(m.ex, m.o)));
        x.est = true;
      }
    }
    for (const c of data.comm || []) {
      if (!data.exact[c.ex] || !inP(c.d)) continue;
      if (g.has(c.o)) g.get(c.o).comm = addN(g.get(c.o).comm, c.usdt);
    }
    partners = [...g.values()].map((x) => ({ ...x, vol: round2(x.vol), fee: round2(x.fee), comm: x.comm == null ? null : round2(x.comm) }))
      .sort((a, b) => (a.o == null) - (b.o == null) || String(a.o).localeCompare(String(b.o)));
  }
  const owners = data.all ? [...new Set(data.members.map((m) => m.o || null))].filter((o) => o != null).sort() : [];
  return { today, start, signup, act, trade, fee, positions, rows, partners, owners, owner: ownerOn ? owner : null };
}

// 막대 높이 단계 0~20(CSS 칸 ctl-db-h0~h20 — style 속성 없이). 0보다 크면 적어도 1
export function barLevels(bars) {
  const max = Math.max(0, ...bars.map((b) => b.v));
  return bars.map((b) => (max <= 0 || b.v <= 0 ? 0 : Math.max(1, Math.round((b.v / max) * 20))));
}
