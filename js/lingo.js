/* =====================================================================
 * lingo.js — pure language helpers. No DOM, so it runs in Node for tests.
 *
 *   1. syllable counting + syllable splitting (English heuristics)
 *   2. parseSpeech()  — turn what the microphone heard into A-Z letters
 *   3. judge()        — line the attempt up against the target word
 *   4. coach()        — the simple-English sentence spoken to the student
 * ===================================================================== */
(function (global) {
  'use strict';

  var VOWELS = 'aeiouy';
  var CONSONANTS = 'bcdfghjklmnpqrstvwxyz';

  /* ---------------------------------------------------------------
   * string helpers
   * ------------------------------------------------------------- */
  function tidy(w) {
    return String(w == null ? '' : w).toLowerCase().replace(/[^a-z]/g, '');
  }
  function isVowelCh(c) { return VOWELS.indexOf(c) >= 0; }
  function isConsCh(c) { return CONSONANTS.indexOf(c) >= 0; }
  function upper(w) { return String(w == null ? '' : w).toUpperCase(); }

  /* 'y' is only a vowel when it is not opening the word and not part of
   * a consonant cluster — yellow / sky / happy / myth / rhythm          */
  function isVowelAt(w, i) {
    var c = w.charAt(i);
    if (!c || VOWELS.indexOf(c) < 0) return false;
    if (c === 'y') {
      if (i === 0) return false;
      if (i === w.length - 1) return true;
      return !isVowelCh(w.charAt(i - 1));
    }
    return true;
  }

  function vowelGroups(w) {
    var out = [], start = -1;
    for (var i = 0; i < w.length; i++) {
      var v = isVowelAt(w, i);
      if (v && start < 0) start = i;
      else if (!v && start >= 0) { out.push([start, i - 1]); start = -1; }
    }
    if (start >= 0) out.push([start, w.length - 1]);
    return out;
  }

  /* table, apple, handles — the final -le (or -les) is its own syllable
   * only when a consonant sits in front of the 'l'.  "file" has a vowel. */
  function endsConsonantLe(w) {
    var t = w.replace(/s$/, '');
    return t.length >= 3 && /le$/.test(t) && isConsCh(t.charAt(t.length - 3));
  }

  /* Should the trailing lone -e be ignored?  make / walked / makes /
   * table / teacher / studied / boxes  — each needs a different rule.   */
  function dropLastGroup(w, groups) {
    if (groups.length < 2) return false;
    var g = groups[groups.length - 1];
    if (!(g[0] === g[1] && w.charAt(g[0]) === 'e')) return false;
    if (endsConsonantLe(w)) return false;                  // ta-ble, ap-ple
    if (/(ies|ied)$/.test(w)) return false;                // car-ries, stud-ied
    if (/ed$/.test(w)) {                                   // walk-ed vs want-ed
      var c = w.charAt(w.length - 3);
      return !(c === 't' || c === 'd');
    }
    if (/es$/.test(w)) {                                   // make-s vs box-es
      return !/(ses|xes|zes|ches|shes)$/.test(w);
    }
    if (!/e$/.test(w)) return false;                       // tea-cher ends in r
    return true;                                           // ordinary silent e
  }

  /* rhy-thm — a syllabic m/n with no vowel letter of its own */
  function syllabicNasal(w, groups) {
    if (!groups.length) return false;
    var tail = w.slice(groups[groups.length - 1][1] + 1);
    return /^[^aeiouy]{2,}[mn]$/.test(tail);
  }

  function syllableCount(word) {
    var w = tidy(word);
    if (!w) return 0;
    var g = vowelGroups(w);
    if (!g.length) return 1;
    return g.length - (dropLastGroup(w, g) ? 1 : 0) + (syllabicNasal(w, g) ? 1 : 0);
  }

  /* ---------------------------------------------------------------
   * syllable splitting
   *
   * Two consonants between vowels:  th/ch/sh… become the next onset,
   * ck/ng stay behind as a coda, a doubled pair splits down the middle,
   * anything else splits leaving one letter behind (com-pu-ter).
   * ------------------------------------------------------------- */
  var ONSET_PAIRS = ['th', 'ch', 'sh', 'ph', 'wh', 'qu', 'kn', 'wr', 'gn', 'ps', 'rh'];
  var CODA_PAIRS = ['ck', 'ng'];

  function clusterOffset(pair, n) {
    if (n === 1) return 0;
    if (n === 2) {
      if (ONSET_PAIRS.indexOf(pair) >= 0) return 0;
      if (CODA_PAIRS.indexOf(pair) >= 0) return 2;
      return 1;                                           // geminates and clusters
    }
    return 1;
  }

  function splitSyllables(word) {
    var w = tidy(word);
    if (!w) return [];
    var groups = vowelGroups(w);
    if (!groups.length) return [w];

    var drop = dropLastGroup(w, groups);
    var work = drop ? groups.slice(0, groups.length - 1) : groups.slice();
    if (!work.length) return [w];

    var conLe = endsConsonantLe(w);
    var cuts = [];

    for (var i = 0; i < work.length - 1; i++) {
      var isLastGap = (i === work.length - 2);
      if (isLastGap && conLe) continue;                   // -ble handled below
      var a = work[i][1], b = work[i + 1][0], n = b - a - 1;
      cuts.push(n <= 0 ? a + 1 : a + 1 + clusterOffset(w.slice(a + 1, b), n));
    }
    if (conLe) {
      var rootLen = w.length - (/s$/.test(w) ? 1 : 0);
      cuts.push(rootLen - 3);                             // ta|ble, han|dles
    }
    if (/(ted|ded)$/.test(w) && cuts.length) {            // want-ed, hat-ed
      cuts[cuts.length - 1] = w.length - 2;
    }

    cuts = cuts.filter(function (c, idx, arr) {
      return c > 0 && c < w.length && arr.indexOf(c) === idx;
    }).sort(function (x, y) { return x - y; });

    var parts = [], prev = 0;
    for (var k = 0; k < cuts.length; k++) { parts.push(w.slice(prev, cuts[k])); prev = cuts[k]; }
    parts.push(w.slice(prev));
    return parts.filter(Boolean);
  }

  /* Which syllable contains letter index p? */
  function syllableIndexAt(parts, p) {
    var acc = 0;
    for (var i = 0; i < parts.length; i++) {
      if (p < acc + parts[i].length) return i;
      acc += parts[i].length;
    }
    return parts.length ? parts.length - 1 : 0;
  }

  /* ---------------------------------------------------------------
   * ordinals — spoken forms, because TTS reads "1st" badly
   * ------------------------------------------------------------- */
  var ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
    'seventh', 'eighth', 'nineth', 'tenth', 'eleventh', 'twelfth',
    'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth',
    'eighteenth', 'nineteenth', 'twentieth'];

  function ordinal(n) {
    if (n < ORDINALS.length) return ORDINALS[n];
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* "B, U, T, T, E, R" — read letter by letter, never as a word */
  function spellOut(s) {
    return String(s || '').toUpperCase().split('').join(', ');
  }

  /* ---------------------------------------------------------------
   * parseSpeech — microphone transcript -> letters + voice commands
   * ------------------------------------------------------------- */
  var HOMOPHONE = {
    a: 'A', b: 'B', bee: 'B', be: 'B',
    c: 'C', see: 'C', sea: 'C', cee: 'C',
    d: 'D', dee: 'D',
    e: 'E', f: 'F', ef: 'F', eff: 'F',
    g: 'G', gee: 'G',
    h: 'H', aitch: 'H', etch: 'H',
    i: 'I', eye: 'I',
    j: 'J', jay: 'J',
    k: 'K', kay: 'K',
    l: 'L', ell: 'L', el: 'L',
    m: 'M', em: 'M',
    n: 'N', en: 'N',
    o: 'O', oh: 'O', owe: 'O',
    p: 'P', pee: 'P', pea: 'P',
    q: 'Q', cue: 'Q', queue: 'Q',
    r: 'R', ar: 'R', are: 'R',
    s: 'S', ess: 'S',
    t: 'T', tee: 'T',
    u: 'U', you: 'U', yoo: 'U', ewe: 'U',
    v: 'V', vee: 'V',
    w: 'W', wii: 'W',
    x: 'X', ex: 'X',
    y: 'Y', why: 'Y',
    z: 'Z', zee: 'Z', zed: 'Z'
  };

  var COMMAND = {
    done: 'check', finished: 'check', finish: 'check', check: 'check',
    submit: 'check', ok: 'check', okay: 'check', correct: 'check',
    ready: 'check', 'allright': 'check', 'thatsit': 'check', 'thatsit.': 'check',
    yes: 'check', yeah: 'check', yep: 'check',
    skip: 'skip', next: 'skip', 'pass': 'skip'
  };

  var IGNORE = {
    capital: 1, capitals: 1, uppercase: 1, lowercase: 1, letter: 1, letters: 1,
    period: 1, dot: 1, space: 1, comma: 1, dash: 1, hyphen: 1, underscore: 1,
    um: 1, uh: 1, ah: 1, hmm: 1, the: 1, word: 1, spell: 1, spelling: 1,
    again: 1, please: 1, it: 1, is: 1, a: 0
  };

  /* "double you" -> W, "double L" -> LL, "capital b" -> B.
   * Returns the letters we recognised, any whole words the student
   * just said out loud, and any voice commands.                     */
  function parseSpeech(text) {
    var raw = String(text == null ? '' : text);
    var tokens = raw.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/);
    var letters = [], words = [], commands = [], dbl = false;

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].replace(/^['-]+|['-]+$/g, '');
      if (!t) continue;

      if (t === 'double') { dbl = true; continue; }

      var flat = t.replace(/[-']/g, '');
      if (flat === 'doubleyou' || flat === 'doubleu') { letters.push('W'); dbl = false; continue; }
      if (flat === 'w') { letters.push('W'); dbl = false; continue; }

      if (COMMAND[flat]) { commands.push(COMMAND[flat]); dbl = false; continue; }
      if (IGNORE[flat]) { dbl = false; continue; }

      var L = HOMOPHONE[flat] || HOMOPHONE[t];
      if (!L && /^[a-z]$/.test(t)) L = t.toUpperCase();

      if (L) {
        letters.push(L);
        if (dbl) { letters.push(L); dbl = false; }
        continue;
      }
      if (flat.length >= 3) words.push(flat);
      dbl = false;
    }

    return { letters: letters.join(''), words: words, commands: commands, raw: raw };
  }

  /* ---------------------------------------------------------------
   * judge — line the attempt up with the target
   * ------------------------------------------------------------- */
  function judge(attemptRaw, targetRaw) {
    var target = tidy(targetRaw).toUpperCase();
    var attempt = String(attemptRaw == null ? '' : attemptRaw).toUpperCase().replace(/[^A-Z]/g, '');

    if (!target) return { correct: false, empty: true, target: '', attempt: attempt, prefix: 0, suffix: 0 };
    if (!attempt) return { correct: false, empty: true, target: target, attempt: '', prefix: 0, suffix: 0 };
    if (attempt === target) {
      return { correct: true, target: target, attempt: attempt, prefix: attempt.length, suffix: 0 };
    }

    /* common prefix / common suffix */
    var p = 0;
    while (p < attempt.length && p < target.length && attempt.charAt(p) === target.charAt(p)) p++;
    var s = 0;
    while (s < attempt.length - p && s < target.length - p &&
      attempt.charAt(attempt.length - 1 - s) === target.charAt(target.length - 1 - s)) s++;

    var tStart = p;
    var tEnd = target.length - s;
    if (tEnd <= tStart) tEnd = Math.min(target.length, tStart + 1);   // pure insertion

    var parts = splitSyllables(target.toLowerCase());
    var first = syllableIndexAt(parts, tStart);
    var last = syllableIndexAt(parts, Math.max(tStart, tEnd - 1));
    if (last < first) last = first;

    var syl = parts[first] || '';

    return {
      correct: false,
      target: target,
      attempt: attempt,
      syllables: parts,
      syllableCount: parts.length,
      first: first,
      last: last,
      prefix: p,
      suffix: s,
      hintLetter: (syl.charAt(0) || '').toUpperCase(),
      hintSyllable: upper(syl),
      letters: target.length
    };
  }

  /* ---------------------------------------------------------------
   * coach — what to say to the student
   *
   * The screen only ever shows syllable-level wording.  Individual
   * letters are spoken, never written, until the final reveal.
   * ------------------------------------------------------------- */
  var PRAISE = [
    'Excellent! That is exactly right.',
    'Well done! Perfect spelling.',
    'Great job! You spelled it correctly.',
    'Fantastic! That is right.',
    'Perfect! Well done.'
  ];

  function praise(round) {
    return PRAISE[round % PRAISE.length];
  }

  function describeWrong(res) {
    if (res.last > res.first) {
      if (res.last === res.first + 1) {
        return ordinal(res.first + 1) + ' and ' + ordinal(res.last + 1) + ' syllables';
      }
      return ordinal(res.first + 1) + ' to ' + ordinal(res.last + 1) + ' syllables';
    }
    return ordinal(res.first + 1) + ' syllable';
  }

  function coach(res, level) {
    if (res.correct) {
      return { correct: true, reveal: true, speech: praise(level), screen: 'Correct!' };
    }
    if (res.empty) {
      return {
        correct: false, reveal: false,
        speech: 'I did not hear any letters. Please say each letter slowly, with a small pause between letters.',
        screen: 'I didn\'t hear any letters.'
      };
    }

    var where = describeWrong(res);
    var many = res.last > res.first;
    var verb = many ? 'are' : 'is';

    if (level <= 1) {
      return {
        correct: false, reveal: false,
        speech: 'Not quite. The ' + where + ' ' + verb + ' wrong. Please spell it again.',
        screen: 'Not quite — the ' + where + ' ' + verb + ' wrong.'
      };
    }
    if (level === 2) {
      return {
        correct: false, reveal: false,
        speech: 'Not quite. Hint: the ' + where + ' starts with the letter ' +
          spellOut(res.hintLetter).replace(', ', '') + '. Please spell it again.',
        screen: 'Not quite. Hint: listen for the first letter of the ' +
          (many ? 'wrong part' : where) + '.',
        speakHint: true
      };
    }
    if (level === 3) {
      return {
        correct: false, reveal: false,
        speech: 'Not quite. Hint: the ' + where + ' is spelled ' +
          spellOut(res.hintSyllable) + '. Please spell it again.',
        screen: 'Not quite. Hint: the ' + where + ' has been spoken for you.',
        speakHint: true
      };
    }
    if (level === 4) {
      return {
        correct: false, reveal: true,
        speech: 'Here is the whole word: ' + spellOut(res.target) +
          '. Spell it once more, please.',
        screen: 'Here is the word — spell it once more.',
        speakHint: true
      };
    }
    return {
      correct: false, reveal: true,
      speech: 'The word is ' + spellOut(res.target) +
        '. Good effort. Let us move on to the next word.',
      screen: 'The word is ' + res.target + '.',
      advance: true,
      speakHint: true
    };
  }

  /* --------------------------------------------------------------- */
  global.Lingo = {
    tidy: tidy,
    vowelGroups: vowelGroups,
    syllableCount: syllableCount,
    splitSyllables: splitSyllables,
    syllableIndexAt: syllableIndexAt,
    endsConsonantLe: endsConsonantLe,
    dropLastGroup: dropLastGroup,
    ordinal: ordinal,
    spellOut: spellOut,
    parseSpeech: parseSpeech,
    judge: judge,
    coach: coach,
    praise: praise,
    describeWrong: describeWrong
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.Lingo;
})(typeof window !== 'undefined' ? window : globalThis);
