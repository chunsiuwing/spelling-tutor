/* =====================================================================
 * words.js — getting a word list out of a PDF (or pasted text)
 *
 * PDF.js is vendored at ./vendor/pdf/pdf.min.js and its worker sits
 * next to it so the worker is same-origin (browsers refuse to start a
 * cross-origin worker).
 * ===================================================================== */
(function (global) {
  'use strict';

  var LIGATURES = {
    '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi',
    '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st',
    '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
    '\u201C': '"', '\u201D': '"', '\u2032': "'", '\u2035': "'",
    '\u2013': '-', '\u2014': '-', '\u2010': '-', '\u2011': '-',
    '\u00A0': ' '
  };

  function normalise(text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/[\uFB00-\uFB06\u2018\u2019\u201A\u201B\u201C\u201D\u2032\u2035\u2013\u2014\u2010\u2011\u00A0]/g,
      function (c) { return LIGATURES[c] || c; });
    return s;
  }

  /* Pull candidate words out of any old text.
   * Keeps apostrophes/hyphens inside a word, drops 1-letter tokens. */
  function extractWords(text, opts) {
    opts = opts || {};
    var minLen = opts.minLength || 2;
    var found = normalise(text).match(/[A-Za-z][A-Za-z'-]*/g) || [];
    var seen = Object.create(null), list = [];
    for (var i = 0; i < found.length; i++) {
      var w = found[i].replace(/^['-]+|['-]+$/g, '');
      if (w.length < minLen) continue;
      var key = w.toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      list.push(w);
    }
    return list;
  }

  /* ---------------------------------------------------------------
   * PDF -> plain text
   * ------------------------------------------------------------- */
  function configureWorker() {
    if (global.pdfjsLib && !global.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf/pdf.worker.min.js';
    }
  }

  function pdfToText(file, onProgress) {
    onProgress = onProgress || function () {};
    if (!global.pdfjsLib) {
      return Promise.reject(new Error('PDF reader failed to load.'));
    }
    configureWorker();

    return file.arrayBuffer().then(function (buf) {
      onProgress({ stage: 'open', done: 0, total: 1, label: 'Opening the PDF…' });
      var task = global.pdfjsLib.getDocument({ data: new Uint8Array(buf) });
      return task.promise;
    }).then(function (doc) {
      var total = doc.numPages;
      var chunks = [];
      var chain = Promise.resolve();

      for (var n = 1; n <= total; n++) {
        (function (pageNo) {
          chain = chain.then(function () {
            return doc.getPage(pageNo).then(function (page) {
              return page.getTextContent();
            }).then(function (content) {
              var line = '';
              for (var i = 0; i < content.items.length; i++) {
                var it = content.items[i];
                line += it.str || '';
                if (it.hasEOL) line += '\n';
                else if (i < content.items.length - 1) line += ' ';
              }
              chunks.push(line);
              onProgress({
                stage: 'read', done: pageNo, total: total,
                label: 'Reading page ' + pageNo + ' of ' + total
              });
            });
          });
        })(n);
      }

      return chain.then(function () {
        if (doc.destroy) { try { doc.destroy(); } catch (e) {} }
        onProgress({ stage: 'done', done: total, total: total, label: 'Read ' + total + ' page' + (total === 1 ? '' : 's') });
        return chunks.join('\n');
      });
    });
  }

  global.Words = {
    normalise: normalise,
    extractWords: extractWords,
    pdfToText: pdfToText,
    configureWorker: configureWorker
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.Words;
})(typeof window !== 'undefined' ? window : globalThis);
