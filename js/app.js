/* =====================================================================
 * app.js — SpellCoach state machine and UI wiring.
 * ===================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var L = global.Lingo;

  var S = {
    words: [],
    selected: Object.create(null),
    filter: '',
    queue: [],
    idx: 0,
    round: 0,
    attempt: [],
    bank: [],
    mode: 'tiles', // tiles | voice | keyboard
    keyboardAttempt: '',
    phase: 'setup',
    results: [],
    log: [],
    token: 0,
    lastCoach: null,
    praiseCount: 0,
    pttRec: null,
    pttActive: false
  };

  function delay(ms) { return new Promise(function (r) { global.setTimeout(r, ms); }); }
  function key(w) { return String(w).toLowerCase(); }
  function selectedCount() { return Object.keys(S.selected).length; }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    t.classList.add('show');
    global.clearTimeout(toast._t);
    toast._t = global.setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function showBanner(id, msg, tone) {
    var el = $(id);
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = 'banner ' + (tone || 'warn');
    el.textContent = msg;
  }

  function hud(id, text, state) {
    var el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'pill ' + (state || '');
  }

  /* ---------------------------------------------------------------
   * word list setup
   * ------------------------------------------------------------- */
  function renderWords() {
    var box = $('wordList');
    var f = S.filter.trim().toLowerCase();
    var visible = 0;
    var html = '';

    for (var i = 0; i < S.words.length; i++) {
      var w = S.words[i];
      if (f && w.toLowerCase().indexOf(f) < 0) continue;
      visible++;
      var on = !!S.selected[key(w)];
      html += '<button class="chip' + (on ? ' on' : '') + '" type="button" data-w="' +
        esc(w) + '" aria-pressed="' + on + '">' + esc(w) +
        '<i>' + (on ? '&#10003;' : '') + '</i></button>';
    }

    if (!S.words.length) {
      html = '<p class="empty">No words yet. Upload a PDF or paste a list above.</p>';
    } else if (!visible) {
      html = '<p class="empty">No words match &ldquo;' + esc(S.filter) + '&rdquo;.</p>';
    }
    box.innerHTML = html;

    $('selCount').textContent = selectedCount() + ' selected · ' + S.words.length + ' loaded';
    $('toolbar').hidden = !S.words.length;
    var btn = $('btnStart');
    btn.disabled = selectedCount() === 0;
    btn.textContent = selectedCount() > 0
      ? 'Start practice (' + selectedCount() + ')'
      : 'Start practice';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addWords(list) {
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (S.words.some(function (x) { return key(x) === key(w); })) continue;
      S.words.push(w);
      added++;
    }
    renderWords();
    return added;
  }

  function importStatus(msg, pct) {
    var el = $('importStatus');
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = msg;
    var bar = $('importProg');
    if (pct == null) { bar.hidden = true; }
    else {
      bar.hidden = false;
      bar.firstElementChild.style.width = Math.max(4, Math.min(100, pct)) + '%';
    }
  }

  function importWords(file) {
    showBanner('importErr', '');
    if (!file) return;

    var isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isPdf) {
      showBanner('importErr', 'That is not a PDF. Choose a .pdf file, or paste the words instead.');
      return;
    }
    importStatus('Opening ' + file.name + '…', 6);

    global.Words.pdfToText(file, function (p) {
      var pct = p.total ? (p.done / p.total) * 92 : 6;
      importStatus(p.label, pct);
    }).then(function (text) {
      var list = global.Words.extractWords(text);
      if (!list.length) {
        importStatus('', null);
        showBanner('importErr', 'No words found in that PDF — it may be a scan with no selectable text.');
        return;
      }
      var added = addWords(list);
      importStatus('Found ' + list.length + ' word' + (list.length === 1 ? '' : 's') +
        ' in ' + file.name + (added < list.length ? ' (' + added + ' new)' : ''), 100);
      toast(added + ' words ready to choose');
    }).catch(function (err) {
      importStatus('', null);
      showBanner('importErr', 'Could not read that PDF. ' + (err && err.message ? err.message : ''));
    });
  }

  function pasteWords() {
    var box = $('pasteBox');
    var text = box.value || '';
    if (!text.trim()) { showBanner('importErr', 'Type or paste some words first.'); return; }
    var list = global.Words.extractWords(text);
    if (!list.length) { showBanner('importErr', 'No words found in that text.'); return; }
    showBanner('importErr', '');
    var added = addWords(list);
    importStatus('Added ' + added + ' word' + (added === 1 ? '' : 's') +
      ' from pasted text' + (added < list.length ? ' (' + list.length + ' already loaded)' : ''), 100);
    box.value = '';
    toast(added + ' words added');
  }

  /* ---------------------------------------------------------------
   * practice state & rendering
   * ------------------------------------------------------------- */
  function setPhase(p) {
    S.phase = p;
    document.body.setAttribute('data-phase', p);
    var st = $('stageState');
    if (p === 'presenting') st.textContent = 'Listen carefully…';
    else if (p === 'listening') st.textContent = 'Spell the word below.';
    else if (p === 'checking') st.textContent = 'Checking…';
    else if (p === 'feedback') st.textContent = 'Here is my answer.';
    updateControls();
  }

  function updateControls() {
    var listening = S.phase === 'listening';
    var check = $('btnCheck');
    check.disabled = !listening;
    check.classList.toggle('hot', listening);
    check.innerHTML = 'I&rsquo;m finished — check';
    $('btnSkip').disabled = (S.phase === 'checking');
    $('btnQuit').disabled = (S.phase === 'checking');
    $('btnHint').disabled = !S.lastCoach || !S.lastCoach.speakHint;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function initBank(word) {
    var letters = word.toUpperCase().split('');
    S.bank = shuffle(letters).map(function (ch, idx) {
      return { id: idx, ch: ch, used: false };
    });
    S.attempt = new Array(targetWord().length).fill(null);
    S.keyboardAttempt = '';
  }

  function renderPracticePanel() {
    var attemptBox = $('attempt');
    var bankBox = $('bank');
    var targetLen = targetWord().length;

    var currentAttempt = [];
    if (S.mode === 'tiles') {
      currentAttempt = S.attempt.map(function (x) { return x ? x.ch : null; });
    } else {
      currentAttempt = S.keyboardAttempt.split('');
    }

    var attemptHtml = '';
    for (var i = 0; i < targetLen; i++) {
      var ch = currentAttempt[i];
      if (ch) {
        attemptHtml += '<span class="tile good slot-tile" data-slot="' + i + '">' + esc(ch) + '</span>';
      } else {
        attemptHtml += '<span class="tile rest slot-tile" data-slot="' + i + '">&bull;</span>';
      }
    }
    attemptBox.innerHTML = attemptHtml;

    var bankHtml = '';
    for (var j = 0; j < S.bank.length; j++) {
      var b = S.bank[j];
      bankHtml += '<button class="tile-btn' + (b.used ? ' used' : '') + '" type="button" draggable="true" data-id="' + b.id + '">' + esc(b.ch) + '</button>';
    }
    bankBox.innerHTML = bankHtml;

    var btn = $('btnCheck');
    var filled = currentAttempt.filter(Boolean).length === targetLen;
    btn.disabled = !filled;
    btn.classList.toggle('hot', filled);
  }

  function setMode(m) {
    S.mode = m;
    $('tabTiles').classList.toggle('active', m === 'tiles');
    $('tabVoice').classList.toggle('active', m === 'voice');
    $('tabKeyboard').classList.toggle('active', m === 'keyboard');

    $('modeTiles').hidden = (m !== 'tiles');
    $('modeVoice').hidden = (m !== 'voice');
    $('modeKeyboard').hidden = (m !== 'keyboard');
    renderPracticePanel();
  }

  function setFeedback(html, tone) {
    var el = $('feedback');
    if (!html) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.className = 'feedback ' + (tone || '');
    el.innerHTML = html;
  }

  function setHintPill(res, round) {
    var el = $('hintPill');
    if (!res || res.correct || S.phase === 'presenting' || S.phase === 'listening') {
      el.hidden = true; el.textContent = ''; return;
    }
    el.hidden = false;
    el.textContent = res.syllableCount + ' syllables · ' + res.letters +
      ' letters · attempt ' + round;
  }

  function renderLog() {
    var el = $('log');
    if (!S.log.length) { el.innerHTML = '<li class="none">Nothing yet — the log fills in as you go.</li>'; return; }
    var html = '';
    for (var i = 0; i < S.log.length; i++) {
      var e = S.log[i];
      html += '<li class="' + (e.tone || '') + '"><span class="mk">' + e.mark + '</span>' +
        '<span class="tx">' + esc(e.text) + '</span>' +
        (e.note ? '<span class="nt">' + esc(e.note) + '</span>' : '') + '</li>';
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function pushLog(mark, text, tone, note) {
    S.log.push({ mark: mark, text: text, tone: tone, note: note || '' });
    renderLog();
  }

  function updateProgress() {
    var total = S.queue.length || 1;
    $('wordPos').textContent = 'Word ' + Math.min(S.idx + 1, total) + ' of ' + S.queue.length;
    $('progBar').firstElementChild.style.width = ((S.idx) / total) * 100 + '%';
  }

  function targetWord() { return S.queue[S.idx] || ''; }

  /* ---------------------------------------------------------------
   * practice flow
   * ------------------------------------------------------------- */
  function presentWord() {
    S.round = 0;
    S.lastCoach = null;
    initBank(targetWord());

    updateProgress();
    setFeedback('');
    setHintPill(null);
    $('hintPill').hidden = true;
    $('hearState').textContent = 'Listen carefully — the word is read once.';
    setPhase('presenting');
    renderPracticePanel();

    if (!Speech.ttsOk) {
      showBanner('micWarn', 'Speech output is not available in this browser.');
    }

    var word = targetWord();
    Speech.speak(word, { rate: 0.82 })
      .then(function () { return delay(700); })
      .then(function () {
        setPhase('listening');
        renderPracticePanel();
      });
  }

  function check() {
    if (S.phase !== 'listening') return;
    setPhase('checking');

    var target = targetWord();
    var attemptStr = '';
    if (S.mode === 'tiles') {
      attemptStr = S.attempt.map(function (x) { return x ? x.ch : ''; }).join('');
    } else {
      attemptStr = S.keyboardAttempt;
    }

    var res = L.judge(attemptStr, target);
    var coach = L.coach(res, S.round + 1);
    S.lastCoach = coach;

    setPhase('feedback');
    setHintPill(res, S.round + 1);

    var screen = coach.screen;
    if (coach.correct) {
      screen = '<b>' + esc(res.target) + '</b> — correct!';
      pushLog('✓', res.attempt || res.target, 'ok',
        (S.round + 1) + (S.round ? ' tries' : ' try'));
      S.praiseCount++;
    } else if (res.empty) {
      pushLog('–', 'nothing answered', 'warn', '');
    } else {
      pushLog('✗', res.attempt, 'bad', L.describeWrong(res));
    }
    setFeedback(screen, coach.correct ? 'ok' : 'warn');
    updateControls();

    Speech.speak(coach.speech, { rate: coach.correct ? 0.95 : 0.8 })
      .then(function () { return delay(450); })
      .then(function () {
        if (coach.correct) { S.results.push({ word: target, status: 'ok' }); nextWord(); return; }
        if (coach.advance) { S.results.push({ word: target, status: 'reveal' }); nextWord(); return; }
        S.round++;
        initBank(target);
        setFeedback('');
        setHintPill(null);
        setPhase('listening');
        renderPracticePanel();
      });
  }

  function skip() {
    if (S.phase === 'checking') return;
    S.results.push({ word: targetWord(), status: 'skip' });
    pushLog('↷', targetWord(), 'mute', 'skipped');
    nextWord();
  }

  function nextWord() {
    S.idx++;
    if (S.idx >= S.queue.length) { finish(); return; }
    presentWord();
  }

  function finish() {
    S.token++;
    Speech.stop();
    Camera.close();
    hud('hudCam', 'camera: off', '');
    hud('hudMic', 'mic: off', '');
    $('summary').hidden = false;
    document.body.classList.add('modal-open');
    $('practice').hidden = true;
    $('setup').hidden = false;
    document.body.setAttribute('data-phase', 'setup');

    var ok = S.results.filter(function (r) { return r.status === 'ok'; }).length;
    var rev = S.results.filter(function (r) { return r.status === 'reveal'; }).length;
    var sk = S.results.filter(function (r) { return r.status === 'skip'; }).length;
    var total = S.results.length;

    var line = total === 1
      ? (ok ? 'One out of one. Well done!' : 'One word, and it needs more practice.')
      : ok + ' out of ' + total + ' correct.';
    var tail = rev ? ' ' + rev + ' needed a full hint.' : '';
    tail += sk ? ' ' + sk + ' skipped.' : '';
    if (ok === total && total > 0) line = 'All ' + total + ' correct. Brilliant work!';

    $('sumText').textContent = line + tail;

    var needs = S.results.filter(function (r) { return r.status !== 'ok'; })
      .map(function (r) { return r.word; });
    var html = '';
    if (needs.length) {
      html = '<p class="sumlab">Practise these again:</p><div class="chips static">';
      for (var i = 0; i < needs.length; i++) html += '<span class="chip on">' + esc(needs[i]) + '</span>';
      html += '</div>';
    } else {
      html = '<p class="sumlab">Nothing left to review — every word was correct.</p>';
    }
    $('sumList').innerHTML = html;
    $('btnAgain').hidden = !needs.length;

    Speech.speak(line + tail, { rate: 0.9 });
    pushLog('■', 'session finished', 'mute', ok + '/' + total);
  }

  function startPractice() {
    var keys = Object.keys(S.selected);
    if (!keys.length) return;
    var set = Object.create(null);
    keys.forEach(function (k) { set[k] = 1; });

    S.queue = S.words.filter(function (w) { return set[key(w)]; });
    if (!S.queue.length) return;

    S.idx = 0; S.results = []; S.log = []; S.praiseCount = 0;
    renderLog();
    showBanner('micWarn', '');
    showBanner('camWarn', '');
    $('summary').hidden = true;
    document.body.classList.remove('modal-open');

    $('setup').hidden = true;
    $('practice').hidden = false;
    document.body.setAttribute('data-phase', 'presenting');
    Speech.prime();

    openCamera();
    presentWord();
  }

  function openCamera() {
    var video = $('video');
    showBanner('camWarn', '');
    hud('hudCam', 'camera: on', 'on');

    Camera.open(video).then(function () {
      return Camera.loadModel(function (msg, pct) {
        var el = $('modelBanner');
        el.hidden = false;
        el.className = 'banner info';
        el.textContent = msg;
        if (pct == null && /ready|unavailable/i.test(msg)) {
          global.setTimeout(function () { el.hidden = true; }, 2600);
        }
      });
    }).then(function (mode) {
      Camera.run(video, $('overlay'), function (present) {
        hud('hudCam', present ? 'camera: tracking you' : 'camera: no one in view',
          present ? 'on' : 'bad');
      });
    }).catch(function (err) {
      hud('hudCam', 'camera: off', 'bad');
      var msg = (err && (err.name || err.message)) || '';
      if (/NotAllowed|Permission/i.test(msg)) {
        showBanner('camWarn', 'Camera access was blocked. Tap the padlock in the address bar and allow the camera — practice still works without it.');
      } else {
        showBanner('camWarn', 'Camera unavailable (' + msg + '). Practice still works without it.');
      }
      setPhase('presenting');
    });
  }

  function endSession() {
    S.token++;
    Speech.stop();
    Camera.close();
    hud('hudCam', 'camera: off', '');
    hud('hudMic', 'mic: off', '');
    $('summary').hidden = true;
    document.body.classList.remove('modal-open');
    $('practice').hidden = true;
    $('setup').hidden = false;
    document.body.setAttribute('data-phase', 'setup');
    renderWords();
  }

  function again() {
    var set = Object.create(null);
    S.results.forEach(function (r) { if (r.status !== 'ok') set[key(r.word)] = 1; });
    var next = S.words.filter(function (w) { return set[key(w)]; });
    if (!next.length) { endSession(); return; }
    S.queue = next;
    S.idx = 0; S.results = []; S.log = [];
    renderLog();
    $('summary').hidden = true;
    document.body.classList.remove('modal-open');
    presentWord();
  }

  /* ---------------------------------------------------------------
   * Event wiring
   * ------------------------------------------------------------- */
  function boot() {
    Speech.init();
    renderWords();
    renderLog();
    showBanner('importErr', '');

    /* Setup screen controls */
    $('btnPick').onclick = function () { $('filePdf').click(); };
    $('drop').onclick = function (e) { if (e.target.tagName !== 'BUTTON') $('filePdf').click(); };
    $('filePdf').onchange = function (e) { if (e.target.files[0]) importWords(e.target.files[0]); };

    ['dragenter', 'dragover'].forEach(function (ev) {
      $('drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('over'); });
    });
    $('drop').addEventListener('drop', function (e) {
      e.preventDefault();
      $('drop').classList.remove('over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importWords(f);
    });

    $('btnPaste').onclick = pasteWords;
    $('pasteBox').onkeydown = function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        pasteWords();
      }
    };

    $('filter').oninput = function () { S.filter = this.value; renderWords(); };

    $('btnAll').onclick = function () {
      var f = S.filter.trim().toLowerCase();
      S.words.forEach(function (w) {
        if (!f || w.toLowerCase().indexOf(f) >= 0) S.selected[key(w)] = 1;
      });
      renderWords();
    };
    $('btnNone').onclick = function () { S.selected = Object.create(null); renderWords(); };

    $('wordList').onclick = function (e) {
      var b = e.target.closest ? e.target.closest('.chip') : null;
      if (!b) return;
      var k = key(b.getAttribute('data-w'));
      if (S.selected[k]) delete S.selected[k]; else S.selected[k] = 1;
      renderWords();
    };

    $('btnStart').onclick = function () { Speech.prime(); startPractice(); };
    $('btnCheck').onclick = function () { Speech.prime(); check(); };
    $('btnHint').onclick = function () {
      if (S.lastCoach) Speech.speak(S.lastCoach.speech, { rate: 0.8 });
    };

    $('btnSkip').onclick = function () { Speech.prime(); skip(); };
    $('btnQuit').onclick = function () { Speech.prime(); endSession(); };
    $('btnClose').onclick = endSession;
    $('btnAgain').onclick = function () { Speech.prime(); again(); };

    /* Mode tabs wiring */
    $('tabTiles').onclick = function () { setMode('tiles'); };
    $('tabVoice').onclick = function () { setMode('voice'); };
    $('tabKeyboard').onclick = function () { setMode('keyboard'); };

    /* Tile bank & slot clicks */
    var bankBox = $('bank');
    var attemptBox = $('attempt');

    bankBox.onclick = function (e) {
      if (S.phase !== 'listening' || S.mode !== 'tiles') return;
      var btn = e.target.closest ? e.target.closest('.tile-btn') : null;
      if (!btn || btn.classList.contains('used')) return;
      var id = parseInt(btn.getAttribute('data-id'), 10);
      var item = S.bank.find(function (x) { return x.id === id; });
      if (!item) return;

      var targetLen = targetWord().length;
      for (var i = 0; i < targetLen; i++) {
        if (!S.attempt[i]) {
          item.used = true;
          S.attempt[i] = item;
          renderPracticePanel();
          break;
        }
      }
    };

    attemptBox.onclick = function (e) {
      if (S.phase !== 'listening') return;
      if (S.mode === 'tiles') {
        var tile = e.target.closest ? e.target.closest('.slot-tile') : null;
        if (!tile) return;
        var slotIdx = parseInt(tile.getAttribute('data-slot'), 10);
        if (isNaN(slotIdx) || !S.attempt[slotIdx]) return;

        var removed = S.attempt[slotIdx];
        S.attempt[slotIdx] = null;
        if (removed) removed.used = false;
        renderPracticePanel();
      }
    };

    $('btnClearBank').onclick = function () {
      if (S.phase !== 'listening') return;
      if (S.mode === 'tiles') {
        S.attempt = new Array(targetWord().length).fill(null);
        S.bank.forEach(function (x) { x.used = false; });
      } else {
        S.keyboardAttempt = '';
      }
      renderPracticePanel();
    };

    /* Keyboard mode click handler */
    $('keyboard').onclick = function (e) {
      if (S.phase !== 'listening' || S.mode !== 'keyboard') return;
      var k = e.target.closest ? e.target.closest('.kb-key') : null;
      if (!k) return;
      var ltr = k.getAttribute('data-k');
      var cap = targetWord().length;
      if (ltr === 'DEL') {
        S.keyboardAttempt = S.keyboardAttempt.slice(0, -1);
      } else if (ltr && S.keyboardAttempt.length < cap) {
        S.keyboardAttempt += ltr;
      }
      renderPracticePanel();
    };

    /* Voice Mode PTT */
    var pttBtn = $('btnPtt');
    var pttLabel = $('pttLabel');
    var activeRec = null;

    function beginPtt(e) {
      if (e && e.cancelable) e.preventDefault();
      if (S.phase !== 'listening' || S.mode !== 'voice' || S.pttActive) return;
      S.pttActive = true;
      S.keyboardAttempt = '';
      pttBtn.classList.add('recording');
      pttLabel.textContent = 'Listening letter by letter… release when done';
      $('hearState').textContent = 'Listening to voice spelling…';

      var STTCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!STTCtor) {
        toast('Speech recognition unavailable');
        return;
      }

      try {
        var rec = new STTCtor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = function (ev) {
          var acc = '';
          for (var i = ev.resultIndex; i < ev.results.length; i++) {
            var r = ev.results[i];
            if (r[0]) acc += ' ' + r[0].transcript;
          }
          var shown = acc.trim();
          if (shown) {
            $('hearState').textContent = 'Hearing: ' + shown;
            var p = L.parseSpeech(shown);
            var cap = targetWord().length;
            if (p.letters) {
              S.keyboardAttempt = p.letters.slice(0, cap);
              renderPracticePanel();
            }
          }
        };

        activeRec = rec;
        rec.start();
        hud('hudMic', 'mic: ptt active', 'on');
      } catch (err) {
        toast('Could not start mic');
      }
    }

    function endPtt(e) {
      if (e && e.cancelable) e.preventDefault();
      if (!S.pttActive) return;
      S.pttActive = false;
      pttBtn.classList.remove('recording');
      pttLabel.textContent = 'Hold & spell letter by letter';
      hud('hudMic', 'mic: off', '');

      if (activeRec) {
        try { activeRec.stop(); } catch (err) {}
        activeRec = null;
      }

      global.setTimeout(function () {
        if (S.phase !== 'listening') return;
        var shown = $('hearState').textContent.replace('Hearing: ', '').trim();
        var p = L.parseSpeech(shown);
        var cap = targetWord().length;
        if (p.letters) {
          S.keyboardAttempt = p.letters.slice(0, cap);
          renderPracticePanel();
        }
        if (S.keyboardAttempt.length > 0) {
          check();
        } else {
          $('hearState').textContent = 'No letters heard. Try holding and saying letters clearly.';
        }
      }, 250);
    }

    if (pttBtn) {
      pttBtn.onmousedown = beginPtt;
      pttBtn.onmouseup = endPtt;
      pttBtn.onmouseleave = endPtt;
      pttBtn.ontouchstart = function (e) { beginPtt(e); };
      pttBtn.ontouchend = function (e) { endPtt(e); };
      pttBtn.ontouchcancel = function (e) { endPtt(e); };
    }

    document.addEventListener('pointerdown', function once() {
      Speech.prime();
    }, { once: true });

    document.addEventListener('keydown', function (e) {
      if (S.phase !== 'listening') return;
      if (e.key === 'Enter') { e.preventDefault(); check(); }
      else if (e.key === 'Escape') { e.preventDefault(); skip(); }
    });

    global.addEventListener('beforeunload', function () {
      Camera.close();
    });

    if (!Speech.ttsOk) showBanner('micWarn', 'Speech output is not available in this browser.');
    if (!Speech.sttOk && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      showBanner('micWarn', 'iPhone spelling input works best in Chrome; Safari support varies.');
    }

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }

    global.Words.configureWorker();
    document.body.setAttribute('data-phase', 'setup');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
