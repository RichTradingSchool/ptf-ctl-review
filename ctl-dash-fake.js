// 동업자 컨트롤러 현황 탭 검토판 전용(대표 요청 2026-11-23 — tools/ctl_dash_review_build.py가 .preview/ctl-dash-review/에만 싣는다).
// 회원 빌드(tools/build.mjs → dist·.preview/app)에는 들어가지 않는다 — app/ 밖 파일이고 빌드가 읽지 않음(test/app-ctl-dash.test.mjs).
// 앱 스크립트(type=module app.js)보다 먼저 읽히는 보통 스크립트 하나: fetch·EventSource·WebSocket·XMLHttpRequest·sendBeacon·서비스 워커 등록·IndexedDB를 바꿔
//   가짜 허브(https://fake-hub.invalid)를 이 페이지 메모리 안에서 흉내 낸다 — 같은 출처(이 검토판 정적 파일)만 진짜로 읽고 그 밖의 바깥 주소는 모두 막는다
//   (실제 허브·실행기·거래소에 닿지 않음 — index.html CSP도 connect-src 'self').
// 가짜 자료: 동업자 계정 넷(pkpk·pkpk_sub(pkpk 하위)·soos·gksa) + 동업자 칸 없는 회원 몇, 회원 96명(오렌지엑스·투빗 섞음), 30일 치 가입·거래 내역(매매 수·
//   거래량·수수료·API 몫·손익·종목)·지급 기록·포지션 — 씨앗 고정이라 열 때마다 같은 숫자. 비율은 지어낸 값. 이 꼴은 허브 /v1/ctl/dash와 같다.
//   회원 UID는 'X' + 숫자 7자리(실제 UID 꼴인 숫자만 9자리와 겹칠 수 없음). 명령은 보내지 않는다(503 exec_off — 실제 주문 없음).
// IndexedDB는 늘 메모리 흉내(이 페이지가 열려 있는 동안만 — 새로 고치면 처음부터). 화면 아래 '검토' 막대(.cdr-bar)로 로그인 흉내·커미션 정확 값(지급 기록) 있음/없음을 바꾼다.
(function () {
  'use strict';
  var G = typeof globalThis !== 'undefined' ? globalThis : window;
  var HUB = 'https://fake-hub.invalid';
  var LOCAL = (function () {
    try { return new URL(G.location.href).origin; } catch (e) { return null; }
  })();
  var PARTNERS = ['pkpk', 'soos', 'gksa']; // 로그인 흉내 계정(동업자)
  var OWNERS = ['pkpk', 'soos', 'gksa', 'pkpk_sub']; // 회원 줄의 동업자 이름(pkpk_sub는 pkpk 범위)
  var REP = 'rich'; // 대표 보기(범위 all) 흉내 아이디 — 검토판에서만
  var ACCOUNTS = { rich: 'all', pkpk: ['pkpk', 'pkpk_sub'], soos: ['soos'], gksa: ['gksa'] };
  var DAY = 86400000;
  var KST = 9 * 3600000;
  var S = { who: null, tokens: {}, exact: false, blocked: [], dashCalls: 0 };

  // ── 씨앗 고정 난수(mulberry32) ──
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var dayKey = function (ms) { return new Date(ms + KST).toISOString().slice(0, 10); };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var hex = function (R, n) { var s = ''; for (var i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(R() * 16)]; return s; };

  // ── 가짜 회원·거래 내역(열 때 한 번 — 지금 시각 기준 30일). 허브 /v1/ctl/dash 꼴(hub/lib/ctl-dash-store.js aggregate + ctl-routes dashList)과 같게 ──
  // 비율은 검토용 지어낸 값(실제 동업자 비율 아님). 투빗은 거래 내역 캡처 전이라 매매·비율·지급 기록 자리만(회원·잔고는 있음)
  var RATES = { ox: [{ o: 'gksa', rate: 70, apiRate: 60 }, { o: 'pkpk', rate: 50, apiRate: 44 }, { o: 'pkpk_sub', rate: 66, apiRate: 57 }, { o: 'soos', rate: 50, apiRate: 43 }], tb: [] };
  var SYMS = ['BTC', 'BTC', 'BTC', 'ETH', 'ETH', 'SOL', 'XRP', 'DOGE'];
  var MODEL = (function () {
    var R = rng(20261123);
    var now = Date.now();
    var today0 = Date.parse(dayKey(now) + 'T00:00:00Z') - KST; // 한국 오늘 0시(ms)
    var members = [];
    var used = {};
    for (var i = 0; i < 96; i++) {
      var o = i < 92 ? OWNERS[i % 4] : null;
      var ex = R() < 0.6 ? 'tb' : 'ox';
      var uid;
      do { uid = 'X' + String(1000000 + Math.floor(R() * 9000000)); } while (used[uid]);
      used[uid] = 1;
      // 가입: 70%는 지난 30일(최근일수록 많게), 30%는 그 앞(30~120일)
      var recent = R() < 0.7;
      var ago = recent ? Math.floor(Math.pow(R(), 1.6) * 30) : 30 + Math.floor(R() * 90);
      var joinAt = today0 - ago * DAY + Math.floor(R() * 20 * 3600000) + 2 * 3600000;
      if (joinAt > now) joinAt = now - Math.floor(R() * 3600000);
      var act = R() < 0.68;
      var bal = null;
      if (act) bal = R() < 0.18 ? r2(5 + R() * 44) : r2(Math.exp(Math.log(80) + R() * Math.log(160)));
      else if (R() < 0.3) bal = r2(R() * 40);
      var auto = act && bal != null && bal >= 50 ? R() < 0.72 : act ? false : null;
      var pos = auto ? (R() < 0.55 ? 1 : R() < 0.5 ? 2 : 0) : 0;
      members.push({ h: hex(R, 64), uid: uid, o: o, ex: ex, joinAt: joinAt, act: act, bal: bal, auto: auto, pos: pos, lean: R() - 0.42, api: R() < 0.22 });
    }
    // 거래 내역(오렌지엑스 Trade History 흉내 — 앱 매매·회원 직접 매매 모두): 잔고 50 이상 회원, 날마다 35~55% 확률로 1~6번
    var days = [];
    members.forEach(function (m) {
      if (m.ex !== 'ox' || m.bal == null || m.bal < 50) return;
      for (var k = 29; k >= 0; k--) {
        var d0 = today0 - k * DAY;
        if (d0 + DAY < m.joinAt) continue;
        if (k === 0 && R() < 0.35) continue;
        if (R() > (m.auto ? 0.55 : 0.35)) continue;
        var n = 1 + Math.floor(R() * 6);
        var vol = r2(m.bal * 0.13 * 50 * n * (0.6 + R() * 0.8));
        var fee = r2(vol * 0.0005 * (0.9 + R() * 0.2));
        var api = m.api ? n : R() < 0.1 ? 1 : 0;
        var feeApi = api === n ? fee : r2((fee * api) / n);
        var pnl = r2(vol * (m.lean * 0.004 + (R() - 0.5) * 0.006));
        days.push({ h: m.h, d: dayKey(d0 + 12 * 3600000), n: n, vol: vol, fee: fee, feeApi: feeApi, pnl: pnl, api: api, s: SYMS[Math.floor(R() * SYMS.length)] });
      }
    });
    // 지급 기록(Commission Distribution Records 흉내) — 동업자·하루·종류마다 추정의 90~110%
    var byH = {};
    members.forEach(function (m) { byH[m.h] = m; });
    var rateOf = function (o) { return RATES.ox.filter(function (r) { return r.o === o; })[0] || null; };
    var g = {};
    days.forEach(function (r) {
      var m = byH[r.h];
      var rt = rateOf(m.o);
      if (!rt) return;
      var kp = m.o + '|' + r.d + '|perp';
      var ka = m.o + '|' + r.d + '|api';
      g[kp] = (g[kp] || 0) + ((r.fee - r.feeApi) * rt.rate) / 100;
      if (r.feeApi) g[ka] = (g[ka] || 0) + (r.feeApi * rt.apiRate) / 100;
    });
    var comm = Object.keys(g).sort().map(function (k) {
      var p = k.split('|');
      return { ex: 'ox', o: p[0], d: p[1], kind: p[2], usdt: r2(g[k] * (0.9 + R() * 0.2)) };
    });
    // 포지션(Current Positions 흉내 — 앱 밖 포지션도): 오렌지엑스 회원 중 앱 포지션 수 + 가끔 하나 더
    var pos = [];
    members.forEach(function (m) {
      if (m.ex !== 'ox' || m.bal == null || m.bal < 50) return;
      var c = m.pos + (R() < 0.12 ? 1 : 0);
      for (var i = 0; i < c; i++) {
        var s = i === 0 ? 'BTC' : SYMS[3 + Math.floor(R() * 5)];
        var val = r2(m.bal * 0.13 * 50 * (0.5 + R()));
        pos.push({ h: m.h, s: s, dir: R() < 0.55 ? 'long' : 'short', val: val, lev: 50, upnl: r2(val * (R() - 0.5) * 0.02) });
      }
    });
    return { members: members, days: days, comm: comm, pos: pos, posAt: now - 4 * 60000, mark: 63600 };
  }());

  function scopeOk(who, o) {
    var sc = ACCOUNTS[who];
    return sc === 'all' || (o != null && sc.indexOf(o) >= 0);
  }
  function scopeMembers(who) {
    return MODEL.members.filter(function (m) { return scopeOk(who, m.o); });
  }
  function dashBody(who) {
    var list = scopeMembers(who);
    var hs = {};
    list.forEach(function (m) { hs[m.h] = 1; });
    var all = ACCOUNTS[who] === 'all';
    var days = MODEL.days.filter(function (r) { return hs[r.h]; });
    var sg = {};
    days.forEach(function (r) {
      var k = r.d + '|' + r.s;
      var x = sg[k] || (sg[k] = { d: r.d, s: r.s, n: 0, vol: 0 });
      x.n += r.n;
      x.vol = r2(x.vol + r.vol);
    });
    return {
      ok: true, v: 1, now: Date.now(), all: all,
      rates: { ox: RATES.ox.filter(function (r) { return scopeOk(who, r.o); }), tb: [] },
      exact: { ox: S.exact, tb: false },
      members: list.map(function (m) { return { h: m.h, uid: m.uid, o: m.o, ex: m.ex, joinAt: m.joinAt, act: m.act, actAt: null, bal: m.bal, auto: m.auto, pos: m.pos }; }),
      days: days.map(function (r) { return { h: r.h, d: r.d, n: r.n, vol: r.vol, fee: r.fee, feeApi: r.feeApi, pnl: r.pnl, api: r.api }; }),
      syms: Object.keys(sg).map(function (k) { return sg[k]; }),
      comm: S.exact ? MODEL.comm.filter(function (c) { return scopeOk(who, c.o); }) : null,
      pos: { at: MODEL.posAt, rows: MODEL.pos.filter(function (p) { return hs[p.h]; }) },
    };
  }
  // 컨트롤러 목록(지금 화면 — 회원·포지션 탭): 12칸(투빗 켜진 허브 꼴), 매매 11칸
  function membersBody(who) {
    var t = Date.now();
    var R = rng(7);
    return {
      ok: true, now: t, mark: MODEL.mark,
      members: scopeMembers(who).map(function (m) {
        var trades = [];
        for (var i = 0; i < m.pos; i++) {
          var sym = i === 0 ? 'BTC' : 'ETH';
          var side = R() < 0.6 ? 'long' : 'short';
          var dir = side === 'long' ? 1 : -1;
          var avg = r2((sym === 'BTC' ? 63600 : 3400) * (1 + (R() - 0.5) * 0.01));
          var opened = t - Math.floor(R() * 6 * 3600000);
          trades.push({ id: 'rv' + m.h.slice(0, 6) + i, symbol: sym, side: side, lev: 50, stage: 1 + Math.floor(R() * 2), avg: avg, openedAt: opened, src: 'signal',
            tp: r2(avg * (1 + dir * 0.002)), liq: r2(avg * (1 - dir * 0.018)), fills: [{ at: opened, stage: 1, px: avg }] });
        }
        return { h: m.h, uid: m.uid, o: m.o, funded: m.bal == null ? null : m.bal >= 50, enrolled: m.act && m.auto !== null,
          status: m.auto ? 'on' : m.act && m.auto !== null ? 'off' : null, auto: m.auto, symbols: m.auto ? ['BTC'] : [],
          bal: m.bal == null || !m.act ? null : { avail: r2(m.bal * 0.8), equity: m.bal, at: t - 20000 }, trades: trades, lastCheck: m.auto ? t - 15000 : null, ex: m.ex };
      }),
    };
  }
  function candles() {
    var out = [];
    var step = 300000;
    var end = Math.floor(Date.now() / step) * step;
    for (var i = 299; i >= 0; i--) {
      var t = end - i * step;
      var c = 63600 + Math.sin(i / 9) * 180 + Math.sin(i / 37) * 1100;
      out.push([t, c - 12, c + 30, c - 30, c, 12.345]);
    }
    return { ok: true, symbol: 'BTC', tf: '5m', at: Date.now(), stale: false, candles: out };
  }

  // ── 가짜 허브 길 ──
  var J = function (status, body) { return { status: status, body: body }; };
  var tokenOf = function (headers) {
    var a = headers.authorization || '';
    var m = /^Bearer (pc1\.[A-Za-z0-9_-]{43})$/.exec(a);
    return m && S.tokens[m[1]] ? S.tokens[m[1]] : null;
  };
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var newToken = function () { var s = 'pc1.'; for (var i = 0; i < 43; i++) s += B64[Math.floor(Math.random() * 64)]; return s; };
  function route(method, path, headers, bodyText) {
    var body = null;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch (e) { body = null; }
    if (method === 'GET' && path === '/v1/candles') return J(200, candles());
    if (path.indexOf('/v1/ctl/') === 0) {
      if (method === 'POST' && path === '/v1/ctl/login') {
        var id = body && typeof body.id === 'string' ? body.id : '';
        if (!Object.prototype.hasOwnProperty.call(ACCOUNTS, id)) return J(403, { ok: false, error: 'bad_login' });
        var tok = newToken();
        S.tokens[tok] = id;
        S.who = id;
        return J(200, { ok: true, token: tok });
      }
      var who = tokenOf(headers);
      if (!who) return J(401, { ok: false, error: 'bad_token' });
      if (method === 'POST' && path === '/v1/ctl/logout') {
        Object.keys(S.tokens).forEach(function (k) { if (S.tokens[k] === who) delete S.tokens[k]; });
        return J(200, { ok: true });
      }
      if (method === 'GET' && path === '/v1/ctl/members') return J(200, membersBody(who));
      if (method === 'GET' && path === '/v1/ctl/dash') { S.dashCalls += 1; return J(200, dashBody(who)); }
      if (method === 'POST' && path === '/v1/ctl/cmd') return J(503, { ok: false, error: 'exec_off' }); // 검토판 — 명령은 보내지 않음
      if (method === 'POST' && path === '/v1/ctl/password') return J(503, { ok: false, error: 'store_failed' });
    }
    return J(404, { ok: false, error: 'not_found' });
  }

  // ── fetch ──
  var realFetch = typeof G.fetch === 'function' ? G.fetch.bind(G) : null;
  var urlOf = function (input) {
    try { return new URL(typeof input === 'string' ? input : (input && input.url) || String(input), G.location ? G.location.href : undefined); } catch (e) { return null; }
  };
  var block = function (what) {
    S.blocked.push(String(what).slice(0, 200));
    return Promise.reject(new TypeError('검토판: 바깥 요청 막음'));
  };
  function fakeFetch(input, init) {
    init = init || {};
    var u = urlOf(input);
    if (!u) return block(input);
    if (LOCAL && u.origin === LOCAL && realFetch) return realFetch(input, init); // 검토판 정적 파일
    if (u.origin !== HUB) return block(u.origin + u.pathname);
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    var headers = {};
    try { new Headers(init.headers || (input && input.headers) || {}).forEach(function (v, k) { headers[k.toLowerCase()] = v; }); } catch (e) { /* 머리글 없음 */ }
    var bodyText = typeof init.body === 'string' ? init.body : null;
    return new Promise(function (res) { setTimeout(res, 120); }).then(function () {
      var out = route(method, u.pathname, headers, bodyText);
      return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'Content-Type': 'application/json' } });
    });
  }
  G.fetch = fakeFetch;

  // ── EventSource·WebSocket — 열리지 않음(컨트롤러 검토에는 쓰지 않음) ──
  function Dead(url) {
    var self = this;
    self.url = String(url);
    self.readyState = 0;
    self._l = {};
    S.blocked.push(self.url);
    setTimeout(function () {
      self.readyState = 3;
      self._fire('error', {});
      self._fire('close', { code: 1006, reason: '', wasClean: false });
    }, 40);
  }
  Dead.prototype.addEventListener = function (t, fn) { (this._l[t] = this._l[t] || []).push(fn); };
  Dead.prototype.removeEventListener = function (t, fn) { this._l[t] = (this._l[t] || []).filter(function (x) { return x !== fn; }); };
  Dead.prototype.close = function () { this.readyState = 3; };
  Dead.prototype.send = function () { throw new DOMException('not open', 'InvalidStateError'); };
  Dead.prototype._fire = function (t, ev) {
    ev.type = t;
    ev.target = this;
    var h = this['on' + t];
    if (typeof h === 'function') h.call(this, ev);
    (this._l[t] || []).slice().forEach(function (fn) { fn.call(this, ev); }, this);
  };
  Dead.CONNECTING = 0; Dead.OPEN = 1; Dead.CLOSING = 2; Dead.CLOSED = 3;
  G.EventSource = Dead;
  G.WebSocket = Dead;

  // ── 그 밖의 바깥 길 막기 ──
  if (G.XMLHttpRequest && G.XMLHttpRequest.prototype) {
    var realOpen = G.XMLHttpRequest.prototype.open;
    G.XMLHttpRequest.prototype.open = function (method, url) {
      var u = urlOf(url);
      if (!u || u.origin !== LOCAL) {
        S.blocked.push(String(url));
        throw new TypeError('검토판: 바깥 요청 막음');
      }
      return realOpen.apply(this, arguments);
    };
  }
  if (G.navigator) {
    try { if (typeof G.navigator.sendBeacon === 'function') G.navigator.sendBeacon = function () { return false; }; } catch (e) { /* 못 바꿈 */ }
    try {
      if (G.navigator.serviceWorker) G.navigator.serviceWorker.register = function () { return Promise.reject(new Error('검토판: 서비스 워커 없음')); };
    } catch (e) { /* 못 바꿈 */ }
  }

  // ── IndexedDB 메모리 흉내(vault.js가 쓰는 만큼 — tools/pro-review/pro-review-fake.js와 같은 꼴) ──
  function memIdb() {
    var dbs = {};
    var later = function (fn) { setTimeout(fn, 0); };
    var copy = function (v) {
      if (v === undefined) return undefined;
      try { return structuredClone(v); } catch (e) { return v; }
    };
    function makeDb(name) {
      var stores = {};
      return {
        name: name,
        objectStoreNames: { contains: function (n) { return Object.prototype.hasOwnProperty.call(stores, n); } },
        createObjectStore: function (n, opts) { stores[n] = { keyPath: opts && opts.keyPath, map: new Map() }; return {}; },
        close: function () {},
        onversionchange: null,
        transaction: function (names, mode) {
          var list = [].concat(names);
          var pending = 0;
          var aborted = false;
          var finished = false;
          var tx = { error: null, oncomplete: null, onerror: null, onabort: null };
          var check = function () {
            later(function () {
              if (finished || aborted || pending > 0) return;
              finished = true;
              if (typeof tx.oncomplete === 'function') tx.oncomplete({});
            });
          };
          var req = function (fn) {
            var r = { result: undefined, error: null, onsuccess: null, onerror: null };
            pending += 1;
            later(function () {
              if (aborted) return;
              try {
                r.result = fn();
                if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
              } catch (e) {
                r.error = e;
                tx.error = e;
                if (typeof r.onerror === 'function') r.onerror({ target: r });
                if (typeof tx.onerror === 'function') tx.onerror({});
              }
              pending -= 1;
              check();
            });
            return r;
          };
          tx.abort = function () {
            if (finished || aborted) return;
            aborted = true;
            later(function () { if (typeof tx.onabort === 'function') tx.onabort({}); });
          };
          tx.objectStore = function (n) {
            if (list.indexOf(n) < 0 || !stores[n]) throw new DOMException('no store', 'NotFoundError');
            var st = stores[n];
            var ro = mode !== 'readwrite';
            var guard = function () { if (ro) throw new DOMException('readonly', 'ReadOnlyError'); };
            return {
              get: function (k) { return req(function () { return copy(st.map.get(JSON.stringify(k))); }); },
              getAll: function () { return req(function () { return Array.from(st.map.values()).map(copy); }); },
              put: function (v, k) {
                guard();
                var key = st.keyPath ? v[st.keyPath] : k;
                var val = copy(v);
                return req(function () { st.map.set(JSON.stringify(key), val); return key; });
              },
              delete: function (k) { guard(); return req(function () { st.map.delete(JSON.stringify(k)); return undefined; }); },
            };
          };
          check();
          return tx;
        },
      };
    }
    return {
      open: function (name) {
        var r = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        later(function () {
          var fresh = !dbs[name];
          if (fresh) dbs[name] = makeDb(name);
          r.result = dbs[name];
          if (fresh && typeof r.onupgradeneeded === 'function') r.onupgradeneeded({ target: r });
          if (typeof r.onsuccess === 'function') r.onsuccess({ target: r });
        });
        return r;
      },
      deleteDatabase: function (name) {
        var r = { onsuccess: null };
        delete dbs[name];
        later(function () { if (typeof r.onsuccess === 'function') r.onsuccess({}); });
        return r;
      },
    };
  }
  try {
    Object.defineProperty(G, 'indexedDB', { configurable: true, enumerable: true, value: memIdb() });
  } catch (e) { /* 못 바꿈 — 앱이 메모리 저장소로 감 */ }

  // ── 검토 막대 ──
  function q(sel) { return document.querySelector(sel); }
  function visible(n) { return !!n && n.getClientRects().length > 0; }
  function waitFor(fn, ms) {
    return new Promise(function (res) {
      var end = Date.now() + (ms || 8000);
      (function tick() {
        var v = null;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return res(v);
        if (Date.now() > end) return res(null);
        setTimeout(tick, 100);
      })();
    });
  }
  function skipTour() {
    var b = q('#tour-box');
    if (!b) return;
    var skip = Array.prototype.find.call(b.querySelectorAll('button'), function (x) { return /건너뛰기/.test(x.textContent); });
    if (skip) skip.click();
  }
  // 로그인 흉내: 로그인돼 있으면 로그아웃 → 로그인 칸에 아이디·검토용 글자 → 로그인(가짜 허브는 아이디만 봄)
  function loginAs(id) {
    if (location.hash !== '#ctl') location.hash = '#ctl';
    skipTour();
    var out = visible(q('.ctl-logout')) ? (q('.ctl-logout').click(), true) : false;
    return waitFor(function () { return visible(q('.ctl-login')) && q('.ctl-id'); }, out ? 8000 : 12000).then(function (inp) {
      if (!inp) return false;
      inp.value = id;
      q('.ctl-pw').value = 'review';
      var f = q('.ctl-login');
      if (typeof f.requestSubmit === 'function') f.requestSubmit();
      else q('.ctl-login-btn').click();
      return waitFor(function () { return visible(q('.ctl-dash')) && q('.ctl-db-card'); }, 12000);
    });
  }
  // 현황 탭을 다시 받게(회원 탭 → 현황 탭 — 현황 탭을 누르면 바로 다시 받음)
  function reloadDash() {
    var tab = function (k) { return q('.ctl-tab[data-tab="' + k + '"]'); };
    if (!tab('dash')) return Promise.resolve(false);
    tab('members').click();
    tab('dash').click();
    return waitFor(function () { return visible(q('.ctl-db-card')); }, 8000);
  }
  function buildBar() {
    var el = function (tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    document.documentElement.classList.add('ctl-dash-review');
    var bar = el('div', 'cdr-bar');
    bar.id = 'cdr-bar';
    var head = el('div', 'cdr-head');
    var tog = el('button', 'cdr-toggle', '검토 ▲');
    tog.type = 'button';
    head.append(el('span', 'cdr-note', '내부 검토판 · 가짜 데이터'), tog);
    var body = el('div', 'cdr-body');
    body.hidden = true;
    tog.addEventListener('click', function () {
      body.hidden = !body.hidden;
      tog.textContent = body.hidden ? '검토 ▲' : '접기 ▼';
    });
    var msg = el('p', 'cdr-msg');
    var busy = false;
    var btns = [];
    var run = function (fn) {
      if (busy) return;
      busy = true;
      msg.textContent = '바꾸는 중…';
      Promise.resolve().then(fn).then(function (ok) {
        msg.textContent = ok === false || ok == null ? '다시 눌러 주세요' : '';
      }, function () { msg.textContent = '다시 눌러 주세요'; }).then(function () { busy = false; paint(); });
    };
    var group = function (title, items) {
      var g = el('div', 'cdr-group');
      g.append(el('div', 'cdr-title', title));
      var row = el('div', 'cdr-row');
      items.forEach(function (it) {
        var b = el('button', 'cdr-btn', it.label);
        b.type = 'button';
        b.dataset.key = it.key;
        b.addEventListener('click', function () { run(it.go); });
        row.append(b);
        btns.push({ b: b, on: it.on });
      });
      g.append(row);
      return g;
    };
    body.append(
      group('로그인 흉내', [{ key: REP, label: '대표 보기' }].concat(PARTNERS.map(function (p) { return { key: p, label: p }; })).map(function (x) {
        return { key: x.key, label: x.label, on: function () { return S.who === x.key; }, go: function () { return loginAs(x.key); } };
      })),
      group('커미션 지급 기록', [
        { key: 'est', label: '정확 값 없음', on: function () { return !S.exact; }, go: function () { S.exact = false; return reloadDash(); } },
        { key: 'exact', label: '정확 값 있음', on: function () { return S.exact; }, go: function () { S.exact = true; return reloadDash(); } },
      ]),
      el('p', 'cdr-hint', '회원 96명 · 30일 · 비율은 지어낸 값 · 명령은 보내지 않음'),
      msg,
    );
    function paint() { btns.forEach(function (x) { if (x.on) x.b.classList.toggle('on', !!x.on()); }); }
    paint();
    bar.append(head, body);
    document.body.append(bar);
    // 첫 화면 = 현황 탭(대표 보기로 로그인 흉내)
    run(function () { return loginAs(REP); });
  }

  G.__ptfCtlDashReview = { route: route, state: S, model: MODEL, ACCOUNTS: ACCOUNTS, HUB: HUB, loginAs: loginAs, reloadDash: reloadDash };
  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    var start = function () { try { buildBar(); } catch (e) { /* 막대 없이 */ } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
}());
