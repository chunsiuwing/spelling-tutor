/* =====================================================================
 * speech.js — talking to the student (speechSynthesis) and hearing
 * them spell (SpeechRecognition).
 * ===================================================================== */
(function (global) {
  'use strict';

  var hasTTS = typeof global.speechSynthesis !== 'undefined' &&
    typeof global.SpeechSynthesisUtterance !== 'undefined';
  var STTCtor = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  var Speech = {
    ttsOk: hasTTS,
    sttOk: !!STTCtor,
    voice: null,
    _primed: false,
    _speaking: false,

    init: function () {
      if (!hasTTS) return;
      var self = this;
      var pick = function () {
        var vs = global.speechSynthesis.getVoices() || [];
        if (!vs.length) return;
        var en = vs.filter(function (v) { return /^en/i.test(v.lang || ''); });
        var local = en.filter(function (v) { return v.localService; });
        self.voice = (local[0] || en[0] || vs[0]);
      };
      pick();
      global.speechSynthesis.onvoiceschanged = function () { pick(); };

      /* iOS stops speaking long text unless the queue is nudged. */
      global.setInterval(function () {
        if (self._speaking) { try { global.speechSynthesis.resume(); } catch (e) {} }
      }, 7000);
    },

    /* Must be called from inside a real tap, once, on iOS. */
    prime: function () {
      if (this._primed || !hasTTS) return;
      this._primed = true;
      try {
        var u = new global.SpeechSynthesisUtterance(' ');
        u.volume = 0;
        global.speechSynthesis.speak(u);
      } catch (e) {}
    },

    stop: function () {
      if (!hasTTS) return;
      try { global.speechSynthesis.cancel(); } catch (e) {}
      this._speaking = false;
    },

    /* Resolves when the sentence has finished (or safely timed out). */
    speak: function (text, opts) {
      opts = opts || {};
      var self = this;
      text = String(text == null ? '' : text).trim();
      if (!text || !hasTTS) return Promise.resolve();

      return new Promise(function (resolve) {
        var settled = false;
        var finish = function () {
          if (settled) return;
          settled = true;
          self._speaking = false;
          resolve();
        };

        try { global.speechSynthesis.cancel(); } catch (e) {}

        var u = new global.SpeechSynthesisUtterance(text);
        if (self.voice) u.voice = self.voice;
        u.lang = (self.voice && self.voice.lang) || opts.lang || 'en-US';
        u.rate = opts.rate != null ? opts.rate : 0.86;
        u.pitch = opts.pitch != null ? opts.pitch : 1;
        u.volume = opts.volume != null ? opts.volume : 1;

        u.onend = finish;
        u.onerror = finish;

        /* Some engines never fire onend — never leave the UI hanging. */
        var ms = 1800 + text.length * 160;
        global.setTimeout(finish, Math.min(ms, 30000));

        self._speaking = true;
        try { global.speechSynthesis.speak(u); } catch (e) { finish(); }
      });
    },

    /* Recogniser wrapper — keeps itself alive across Chrome's
     * automatic stops, forwards finals, and reports permission loss.  */
    recognizer: function (handlers) {
      handlers = handlers || {};
      if (!STTCtor) return null;

      var rec = new STTCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = handlers.lang || 'en-US';

      var want = false, starting = false, dead = false, timers = 0;

      function startSoon(ms) {
        if (!want || dead || starting) return;
        starting = true;
        global.setTimeout(function () {
          starting = false;
          if (!want || dead) return;
          try { rec.start(); } catch (e) { startSoon(700); }
        }, ms);
      }

      rec.onstart = function () {
        starting = false;
        if (handlers.onStart) handlers.onStart();
      };

      rec.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          var txt = r[0] ? r[0].transcript : '';
          if (r.isFinal) { if (handlers.onFinal) handlers.onFinal(txt); }
          else interim += txt;
        }
        if (interim && handlers.onInterim) handlers.onInterim(interim);
      };

      rec.onerror = function (e) {
        var err = e && e.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          dead = true; want = false;
          if (handlers.onDenied) handlers.onDenied(err);
        } else if (err === 'no-speech' || err === 'aborted' || err === 'language-not-supported') {
          if (err === 'language-not-supported' && handlers.onDenied) {
            dead = true; want = false; handlers.onDenied(err);
          }
        } else if (handlers.onError) {
          handlers.onError(err);
        }
      };

      rec.onend = function () {
        starting = false;
        if (want && !dead) { timers++; startSoon(timers > 40 ? 1500 : 350); }
        else if (handlers.onStop) handlers.onStop();
      };

      return {
        start: function () {
          if (dead) return false;
          want = true;
          startSoon(0);
          return true;
        },
        stop: function () {
          want = false;
          try { rec.stop(); } catch (e) {}
        },
        isLive: function () { return want && !dead; },
        isDead: function () { return dead; },
        restart: function () { dead = false; want = true; startSoon(0); }
      };
    }
  };

  global.Speech = Speech;
})(typeof window !== 'undefined' ? window : globalThis);
