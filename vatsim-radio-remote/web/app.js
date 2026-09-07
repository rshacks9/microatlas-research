/* VATSIM Radio Remote - iPhone client
   Talks to the Windows companion server over a WebSocket on the local network. */

(function () {
  'use strict';

  // ---------------------------------------------------------------- token

  var params = new URLSearchParams(location.search);
  var token = params.get('t') || localStorage.getItem('vrr.token') || '';
  if (params.get('t')) localStorage.setItem('vrr.token', params.get('t'));

  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var ws = null;
  var retry = 0;
  var lastSeenMsgId = Number(localStorage.getItem('vrr.lastMsg') || 0);
  var activeTab = 'radio';

  // ------------------------------------------------------------ transport

  function connect() {
    if (!token) { toast('No pairing token. Re-open the link shown in the server window.'); return; }
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(proto + '//' + location.host + '/ws?t=' + encodeURIComponent(token));
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = function () { retry = 0; setLink(true); };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'state') { state = msg; render(); }
      else if (msg.type === 'note') toast(msg.text);
    };

    ws.onclose = function () {
      setLink(false);
      releasePtt(true);
      scheduleReconnect();
    };

    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function scheduleReconnect() {
    retry = Math.min(retry + 1, 10);
    setTimeout(connect, Math.min(400 * retry, 4000));
  }

  function send(cmd) {
    if (!ws || ws.readyState !== 1) { toast('Not connected to the PC.'); return false; }
    try { ws.send(JSON.stringify(cmd)); return true; } catch (e) { return false; }
  }

  function setLink(up) {
    if (!up) {
      $('chip-sim').className = 'chip';
      $('chip-net').className = 'chip';
      $('callsign').textContent = 'RECONNECTING';
    }
  }

  // -------------------------------------------------------------- helpers

  function fmtFreq(hz) {
    if (!hz) return '---.---';
    return (hz / 1000000).toFixed(3);
  }

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  // --------------------------------------------------------------- render

  function render() {
    if (!state) return;

    var sim = state.sim, com = state.com, vp = state.vpilot, xp = state.xpdr;

    $('callsign').textContent = vp.callsign || 'VATSIM RADIO';
    $('chip-sim').className = 'chip' + (sim.connected ? ' ok' : '');
    $('chip-net').className = 'chip' + (vp.network ? ' ok' : (vp.plugin ? ' warn' : ''));

    $('com1-active').textContent = fmtFreq(com.a1);
    $('com1-standby').textContent = fmtFreq(com.s1);
    $('com2-active').textContent = fmtFreq(com.a2);
    $('com2-standby').textContent = fmtFreq(com.s2);

    setPill('[data-tx="1"]', com.tx1);
    setPill('[data-tx="2"]', com.tx2);
    setPill('[data-rx="1"]', com.rx1 || com.rxAll);
    setPill('[data-rx="2"]', com.rx2 || com.rxAll);

    $('rx-all').setAttribute('aria-checked', com.rxAll ? 'true' : 'false');

    $('xpdr-code').textContent = xp.code === null || xp.code === undefined
      ? '----' : String(xp.code).padStart(4, '0');
    var modeOn = xp.state >= 3;
    $('xpdr-mode').textContent = modeName(xp.state);
    $('xpdr-mode').className = 'xpdr-mode' + (modeOn ? ' on' : '');
    $('xpdr-toggle').textContent = modeOn ? 'STANDBY' : 'MODE C';

    paintPtt(state.ptt.active);

    // hints
    var hint = '';
    if (!sim.connected) hint = 'Simulator: ' + sim.status + '. Radio controls stay locked until MSFS is running.';
    else if (com.st1 && com.st1 !== 0) hint = 'COM 1 reports it is unpowered or failed in this aircraft.';
    $('sim-hint').textContent = hint;

    renderAtc();
    renderMessages();
  }

  // Painted from the server's view during a normal render, and optimistically the
  // instant a finger lands on the button so the feedback is not a round trip away.
  function paintPtt(live) {
    var ptt = $('ptt');
    if (!state) return;
    ptt.classList.toggle('live', !!live);
    ptt.classList.toggle('off', !state.ptt.available);
    ptt.textContent = live ? 'TRANSMITTING'
      : state.ptt.available ? 'PUSH TO TALK  \u00b7  ' + state.ptt.key
      : 'PTT DISABLED';
  }

  function modeName(s) {
    switch (s) {
      case 0: return 'OFF';
      case 1: return 'STBY';
      case 2: return 'TEST';
      case 3: return 'ON';
      case 4: return 'ALT';
      case 5: return 'GND';
      default: return 'STBY';
    }
  }

  function setPill(sel, on) {
    var el = document.querySelector(sel);
    if (el) el.classList.toggle('on', !!on);
  }

  // ------------------------------------------------------------------ ATC

  var atcFilter = '';
  var RANK = { DEL: 0, GND: 1, TWR: 2, DEP: 3, APP: 4, CTR: 5, FSS: 6, ATIS: 7 };

  function renderAtc() {
    var list = $('atc-list');
    var all = (state.controllers || []);
    var badge = $('atc-count');
    badge.textContent = all.length;
    badge.className = 'badge' + (all.length ? ' show' : '');

    var f = atcFilter.trim().toUpperCase();
    var rows = all.filter(function (c) { return !f || c.callsign.toUpperCase().indexOf(f) >= 0; });

    rows.sort(function (a, b) {
      var ra = RANK[suffix(a.callsign)], rb = RANK[suffix(b.callsign)];
      if (ra === undefined) ra = 9;
      if (rb === undefined) rb = 9;
      if (ra !== rb) return ra - rb;
      return a.callsign.localeCompare(b.callsign);
    });

    if (!rows.length) {
      list.innerHTML = '';
      $('atc-hint').textContent = !state.vpilot.plugin
        ? 'The vPilot plugin is not loaded, so the ATC list is unavailable. See the setup guide.'
        : !state.vpilot.network
          ? 'vPilot is not connected to VATSIM yet.'
          : f ? 'No controller matches "' + f + '".' : 'No controllers online within range.';
      return;
    }
    $('atc-hint').textContent = '';

    var tuned = {};
    tuned[state.com.a1] = true;
    tuned[state.com.a2] = true;

    list.innerHTML = rows.map(function (c) {
      return '<button class="atc' + (tuned[c.hz] ? ' tuned' : '') + '" data-cs="' + esc(c.callsign) +
             '" data-hz="' + c.hz + '">' +
               '<span class="atc-main">' +
                 '<span class="atc-callsign">' + esc(c.callsign) + '</span>' +
                 '<span class="atc-name">' + esc(c.name || '') + '</span>' +
               '</span>' +
               '<span class="atc-freq">' + fmtFreq(c.hz) + '</span>' +
             '</button>';
    }).join('');
  }

  function suffix(cs) {
    var parts = String(cs).split('_');
    return parts[parts.length - 1].toUpperCase();
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------- messages

  function renderMessages() {
    var box = $('msg-list');
    var msgs = state.messages || [];
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

    box.innerHTML = msgs.map(function (m) {
      return '<div class="msg ' + esc(m.kind) + '">' +
               '<div class="who"><span>' + esc(m.from || m.kind.toUpperCase()) + '</span><span>' + esc(m.t) + '</span></div>' +
               esc(m.text) +
             '</div>';
    }).join('');

    if (atBottom) box.scrollTop = box.scrollHeight;

    var newest = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (activeTab === 'text') {
      lastSeenMsgId = newest;
      localStorage.setItem('vrr.lastMsg', String(newest));
    }
    var unread = msgs.filter(function (m) { return m.id > lastSeenMsgId && m.kind !== 'sent'; }).length;
    var badge = $('msg-badge');
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.className = 'badge unread' + (unread && activeTab !== 'text' ? ' show' : '');
  }

  // ------------------------------------------------------------ tab logic

  document.querySelectorAll('.tabbtn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tabbtn').forEach(function (b) { b.classList.toggle('on', b === btn); });
      ['radio', 'atc', 'text'].forEach(function (name) {
        $('tab-' + name).hidden = name !== activeTab;
      });
      $('composer').hidden = activeTab !== 'text';
      $('main').scrollTop = 0;
      if (state) renderMessages();
    });
  });

  // ------------------------------------------------------------- controls

  document.querySelectorAll('[data-tx]').forEach(function (b) {
    b.addEventListener('click', function () { send({ type: 'com.tx', radio: Number(b.dataset.tx) }); });
  });

  document.querySelectorAll('[data-rx]').forEach(function (b) {
    b.addEventListener('click', function () {
      var radio = Number(b.dataset.rx);
      var on = radio === 1 ? state.com.rx1 : state.com.rx2;
      send({ type: 'com.rx', radio: radio, on: !on });
    });
  });

  document.querySelectorAll('[data-swap]').forEach(function (b) {
    b.addEventListener('click', function () { send({ type: 'com.swap', radio: Number(b.dataset.swap) }); });
  });

  $('rx-all').addEventListener('click', function () {
    send({ type: 'com.rxAll', on: !state.com.rxAll });
  });

  $('xpdr-ident').addEventListener('click', function () { send({ type: 'xpdr.ident' }); });
  $('xpdr-toggle').addEventListener('click', function () {
    send({ type: 'xpdr.state', on: !(state.xpdr.state >= 3) });
  });

  // --------------------------------------------------------------- keypad

  var keypadMode = null;   // "1-active" | "2-standby" | "squawk"
  var entry = '';

  document.querySelectorAll('[data-edit]').forEach(function (b) {
    b.addEventListener('click', function () { openKeypad(b.dataset.edit); });
  });

  function openKeypad(mode) {
    keypadMode = mode;
    entry = '';
    $('keypad-title').textContent = mode === 'squawk'
      ? 'SQUAWK CODE'
      : 'COM ' + mode.charAt(0) + ' ' + mode.split('-')[1].toUpperCase();
    // The squawk pad is octal.
    document.querySelectorAll('.key').forEach(function (k) {
      if (k.dataset.k === '8' || k.dataset.k === '9') k.disabled = (mode === 'squawk');
      k.style.opacity = k.disabled ? 0.3 : '';
    });
    updateEntry();
    $('sheet-backdrop').hidden = false;
    $('keypad').hidden = false;
  }

  function closeKeypad() {
    $('keypad').hidden = true;
    $('sheet-backdrop').hidden = true;
    keypadMode = null;
  }

  function updateEntry() {
    var el = $('keypad-entry');
    if (keypadMode === 'squawk') {
      el.textContent = (entry + '____').slice(0, 4).replace(/_/g, '-');
      $('keypad').querySelector('.go').disabled = entry.length !== 4;
      el.classList.remove('bad');
      return;
    }
    var padded = (entry + '______').slice(0, 6);
    var text = padded.slice(0, 3) + '.' + padded.slice(3);
    el.textContent = text.replace(/_/g, '-');
    var hz = entryToHz();
    var ok = entry.length >= 5 && hz >= 118000000 && hz <= 136990000;
    el.classList.toggle('bad', entry.length >= 3 && Number(entry.slice(0, 3)) > 136);
    $('keypad').querySelector('.go').disabled = !ok;
  }

  function entryToHz() {
    var padded = (entry + '000000').slice(0, 6);
    return Math.round(Number(padded.slice(0, 3)) * 1000000 + Number(padded.slice(3)) * 1000);
  }

  document.querySelectorAll('.key').forEach(function (k) {
    k.addEventListener('click', function () {
      var v = k.dataset.k;
      if (v === 'del') entry = entry.slice(0, -1);
      else if (v === 'ok') return commitKeypad();
      else {
        var max = keypadMode === 'squawk' ? 4 : 6;
        if (entry.length < max) entry += v;
      }
      updateEntry();
    });
  });

  function commitKeypad() {
    if (keypadMode === 'squawk') {
      if (entry.length !== 4) return;
      send({ type: 'xpdr.code', code: Number(entry) });
    } else {
      var hz = entryToHz();
      if (hz < 118000000 || hz > 136990000) { toast('Outside the COM band (118.000 - 136.990).'); return; }
      send({
        type: 'com.set',
        radio: Number(keypadMode.charAt(0)),
        box: keypadMode.split('-')[1],
        hz: hz
      });
    }
    closeKeypad();
  }

  $('keypad-cancel').addEventListener('click', closeKeypad);

  // ---------------------------------------------------- controller tuning

  var tuneTarget = null;

  $('atc-list').addEventListener('click', function (ev) {
    var row = ev.target.closest('.atc');
    if (!row) return;
    tuneTarget = { callsign: row.dataset.cs, hz: Number(row.dataset.hz) };
    $('tune-title').textContent = tuneTarget.callsign;
    $('tune-freq').textContent = fmtFreq(tuneTarget.hz);
    $('sheet-backdrop').hidden = false;
    $('tunesheet').hidden = false;
  });

  function closeTune() {
    $('tunesheet').hidden = true;
    $('sheet-backdrop').hidden = true;
  }

  document.querySelectorAll('[data-tune]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!tuneTarget) return;
      var action = b.dataset.tune;
      if (action === 'pm') {
        setPrivateTarget(tuneTarget.callsign);
        closeTune();
        document.querySelector('.tabbtn[data-tab="text"]').click();
        $('msg-input').focus();
        return;
      }
      if (!tuneTarget.hz) { toast('No frequency reported for that controller.'); return; }
      send({
        type: 'com.set',
        radio: Number(action.charAt(0)),
        box: action.split('-')[1],
        hz: tuneTarget.hz
      });
      closeTune();
    });
  });

  $('tune-cancel').addEventListener('click', closeTune);
  $('sheet-backdrop').addEventListener('click', function () { closeKeypad(); closeTune(); });

  $('atc-search').addEventListener('input', function (e) {
    atcFilter = e.target.value;
    if (state) renderAtc();
  });

  // ------------------------------------------------------------- composer

  var pmTarget = null;

  function setPrivateTarget(callsign) {
    pmTarget = callsign || null;
    var btn = $('msg-target');
    btn.textContent = pmTarget || 'RADIO';
    btn.classList.toggle('pm', !!pmTarget);
  }

  $('msg-target').addEventListener('click', function () { setPrivateTarget(null); });

  function sendMessage() {
    var input = $('msg-input');
    var text = input.value.trim();
    if (!text) return;
    var ok = pmTarget
      ? send({ type: 'msg.private', to: pmTarget, text: text })
      : send({ type: 'msg.radio', text: text });
    if (ok) input.value = '';
  }

  $('msg-send').addEventListener('click', sendMessage);
  $('msg-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  });

  $('msg-list').addEventListener('click', function (ev) {
    var el = ev.target.closest('.msg.private');
    if (!el) return;
    var who = el.querySelector('.who span');
    if (who && who.textContent) setPrivateTarget(who.textContent.trim());
  });

  // ------------------------------------------------------------------ PTT

  var pttHeld = false;
  var pttTimer = null;

  function pressPtt(ev) {
    if (ev) ev.preventDefault();
    if (pttHeld || !state || !state.ptt.available) {
      if (state && !state.ptt.available) toast('Set "pttKey" in config.json to match vPilot, then restart the server.');
      return;
    }
    pttHeld = true;
    send({ type: 'ptt.down' });
    paintPtt(true);
    clearInterval(pttTimer);
    pttTimer = setInterval(function () { send({ type: 'ptt.hold' }); }, 400);
  }

  function releasePtt(silent) {
    if (!pttHeld) return;
    pttHeld = false;
    clearInterval(pttTimer);
    paintPtt(false);
    if (!silent) send({ type: 'ptt.up' });
  }

  var pttBtn = $('ptt');
  pttBtn.addEventListener('pointerdown', function (e) {
    try { pttBtn.setPointerCapture(e.pointerId); } catch (err) {}
    pressPtt(e);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
    pttBtn.addEventListener(name, function () { releasePtt(false); });
  });
  pttBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // Any way the app can lose focus must drop the transmitter.
  window.addEventListener('blur', function () { releasePtt(false); });
  window.addEventListener('pagehide', function () { releasePtt(false); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      releasePtt(false);
    } else {
      if (!ws || ws.readyState > 1) connect();
      requestWakeLock();
    }
  });

  // ------------------------------------------------------------ wake lock

  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* denied or low battery - not important */ });
  }

  // Stop iOS from scroll-bouncing the whole page behind the fixed panels.
  document.addEventListener('touchmove', function (e) {
    if (!e.target.closest('#main, .messages, .sheet')) e.preventDefault();
  }, { passive: false });

  connect();
  requestWakeLock();
})();
