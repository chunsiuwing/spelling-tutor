/* Headless tests for the language engine:  node test/lingo.test.js */
'use strict';

const L = require('../js/lingo.js');
const W = require('../js/words.js');

let pass = 0, fail = 0;
const problems = [];

function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; problems.push(`${label}\n    got  ${g}\n    want ${w}`); }
}
function ok(label, cond, detail) {
  if (cond) pass++;
  else { fail++; problems.push(`${label}${detail ? '\n    ' + detail : ''}`); }
}

/* ------------------------------------------------------------------ *
 * 1. syllable counting
 * ------------------------------------------------------------------ */
const COUNTS = [
  ['butterfly', 3], ['computer', 3], ['banana', 3], ['apple', 2],
  ['table', 2], ['file', 1], ['little', 2], ['walked', 1],
  ['wanted', 2], ['makes', 1], ['boxes', 2], ['buses', 2],
  ['teacher', 2], ['happy', 2], ['sky', 1], ['yellow', 2],
  ['orange', 2], ['closes', 2], ['carries', 2], ['studied', 2],
  ['rhythm', 2], ['photo', 2], ['physics', 2], ['handles', 2],
  ['promises', 3], ['animals', 3], ['like', 1], ['candle', 2],
  ['people', 2], ['eagle', 2], ['circle', 2], ['silent', 2],
  ['gentle', 2], ['separate', 3], ['beautiful', 3], ['island', 2],
  ['assemble', 3], ['decided', 3], ['hated', 2], ['quizzes', 2],
  ['watches', 2], ['washes', 2], ['the', 1], ['make', 1],
  ['home', 1], ['purple', 2], ['single', 2], ['handle', 2],
  ['promise', 2], ['image', 2], ['giraffe', 2], ['Wednesday', 3],
  ['yellow', 2], ['elephant', 3], ['umbrella', 3], ['remember', 3]
];
for (const [word, want] of COUNTS) {
  eq(`syllables(${word})`, L.syllableCount(word), want);
}

/* ------------------------------------------------------------------ *
 * 2. syllable splitting
 * ------------------------------------------------------------------ */
const SPLITS = [
  ['butterfly', ['but', 'ter', 'fly']],
  ['computer', ['com', 'pu', 'ter']],
  ['banana', ['ba', 'na', 'na']],
  ['apple', ['ap', 'ple']],
  ['table', ['ta', 'ble']],
  ['little', ['lit', 'tle']],
  ['happy', ['hap', 'py']],
  ['wanted', ['want', 'ed']],
  ['yellow', ['yel', 'low']],
  ['rather', ['ra', 'ther']],
  ['pocket', ['pock', 'et']],
  ['teacher', ['tea', 'cher']],
  ['island', ['is', 'land']],
  ['beautiful', ['beau', 'ti', 'ful']],
  ['separate', ['se', 'pa', 'rate']],
  ['assemble', ['as', 'sem', 'ble']],
  ['Wednesday', ['wed', 'nes', 'day']],
  ['make', ['make']],
  ['candle', ['can', 'dle']],
  ['gentle', ['gen', 'tle']],
  ['people', ['peo', 'ple']],
  ['eagle', ['ea', 'gle']],
  ['circle', ['cir', 'cle']],
  ['handles', ['han', 'dles']],
  ['decided', ['de', 'cid', 'ed']],
  ['promises', ['pro', 'mi', 'ses']],
  ['elephant', ['e', 'le', 'phant']]
];
for (const [word, want] of SPLITS) {
  eq(`split(${word})`, L.splitSyllables(word), want);
}

/* every split must reassemble into the tidy word, and never be empty */
for (const word of ['butterfly', 'umbrella', 'remember', 'vegetable', 'chocolate', 'important']) {
  const parts = L.splitSyllables(word);
  eq(`rejoin(${word})`, parts.join(''), word);
  ok(`nonEmpty(${word})`, parts.filter(Boolean).length === L.syllableCount(word),
    `${parts.length} parts vs ${L.syllableCount(word)} counted`);
}

/* ------------------------------------------------------------------ *
 * 3. microphone transcript -> letters
 * ------------------------------------------------------------------ */
eq('say letters', L.parseSpeech('B U T T E R').letters, 'BUTTER');
eq('homophones', L.parseSpeech('bee eye eff').letters, 'BIF');
eq('you are', L.parseSpeech('you are').letters, 'UR');
eq('double u', L.parseSpeech('double u').letters, 'UU');
eq('double L', L.parseSpeech('double L').letters, 'LL');
eq('capital b', L.parseSpeech('capital b').letters, 'B');
eq('why', L.parseSpeech('why').letters, 'Y');
eq('filler only', L.parseSpeech('the word is').letters, '');
eq('filler only words', L.parseSpeech('the word is').words, []);
eq('whole word', L.parseSpeech('butterfly').words, ['butterfly']);
eq('command check', L.parseSpeech('okay').commands, ['check']);
eq('command done', L.parseSpeech('done please').commands, ['check']);
eq('command skip', L.parseSpeech('skip').commands, ['skip']);
eq('mixed', L.parseSpeech('A, B, done').letters, 'AB');
eq('mixed commands', L.parseSpeech('A, B, done').commands, ['check']);

/* ------------------------------------------------------------------ *
 * 4. judging an attempt
 * ------------------------------------------------------------------ */
const right = L.judge('BUTTERFLY', 'butterfly');
eq('exact match correct', right.correct, true);
eq('exact match prefix', right.prefix, 9);

const missing = L.judge('BUTERFLY', 'butterfly');
eq('missing letter wrong', missing.correct, false);
eq('missing letter prefix', missing.prefix, 3);
eq('missing letter suffix', missing.suffix, 5);
eq('missing letter syllable', missing.first, 1);
eq('missing letter hint letter', missing.hintLetter, 'T');
eq('missing letter hint syllable', missing.hintSyllable, 'TER');

eq('empty attempt', L.judge('', 'apple').empty, true);
eq('garbage wrong', L.judge('XYZ', 'banana').correct, false);
eq('case insensitivity', L.judge('butterfly', 'BUTTERFLY').correct, true);

const firstSyl = L.judge('XANANA', 'banana');
eq('first syllable flagged', firstSyl.first, 0);

/* ------------------------------------------------------------------ *
 * 5. what gets said back
 * ------------------------------------------------------------------ */
const good = L.coach(right, 1);
eq('praise correct', good.correct, true);
ok('praise is english', /\b(exactly right|Perfect|Great job|Excellent|Well done|Fantastic)\b/.test(good.speech),
  good.speech);

const wrong1 = L.coach(missing, 1);
eq('level1 not correct', wrong1.correct, false);
ok('level1 names a syllable', /second syllable is wrong/.test(wrong1.speech), wrong1.speech);
ok('level1 screen hides letters', !/[A-Z]/.test(wrong1.screen.replace(/Not quite|Hint|the|syllable|wrong|Please|spell|again/g, '')), wrong1.screen);
ok('level1 asks to retry', /spell it again/.test(wrong1.speech), wrong1.speech);

const wrong2 = L.coach(missing, 2);
ok('level2 gives a letter', /letter T/.test(wrong2.speech), wrong2.speech);
eq('level2 screen still hides the word', /[A-Z]{3}/.test(wrong2.screen), false);

const wrong3 = L.coach(missing, 3);
ok('level3 speaks the syllable', /T, E, R/.test(wrong3.speech), wrong3.speech);
eq('level3 screen hides the word', /[A-Z]{3}/.test(wrong3.screen), false);

const wrong4 = L.coach(missing, 4);
eq('level4 reveals', wrong4.reveal, true);
ok('level4 spells it out', /B, U, T, T, E, R, F, L, Y/.test(wrong4.speech), wrong4.speech);

const wrong5 = L.coach(missing, 5);
eq('level5 advances', wrong5.advance, true);

const nothing = L.coach(L.judge('', 'apple'), 1);
ok('empty prompt is english', /did not hear any letters/.test(nothing.speech), nothing.speech);
ok('empty prompt screen', /didn.t hear any letters/.test(nothing.screen), nothing.screen);

/* ------------------------------------------------------------------ *
 * 6. word extraction from text
 * ------------------------------------------------------------------ */
eq('extract basic',
  W.extractWords('The butterfly and the elephant.'),
  ['The', 'butterfly', 'and', 'elephant']);
eq('extract dedupes',
  W.extractWords('cat CAT Cat dog'),
  ['cat', 'dog']);
eq('extract keeps internal punctuation',
  W.extractWords("don't mother-in-law"),
  ["don't", 'mother-in-law']);
eq('extract drops one-letter tokens',
  W.extractWords('I a cat'),
  ['cat']);
eq('extract normalises ligatures',
  W.extractWords('ef\ufb01cient \u2013 fine'),
  ['efficient', 'fine']);
eq('extract empty', W.extractWords(''), []);
eq('extract from pdf-ish lines', W.extractWords('Unit 3\n1. apple\n2. banana'),
  ['Unit', 'apple', 'banana']);

/* ------------------------------------------------------------------ *
 * 7. ordinals / spelling out
 * ------------------------------------------------------------------ */
eq('ordinal 1', L.ordinal(1), 'first');
eq('ordinal 2', L.ordinal(2), 'second');
eq('ordinal 3', L.ordinal(3), 'third');
eq('spellOut', L.spellOut('but'), 'B, U, T');
eq('describe wrong', L.describeWrong(missing), 'second syllable');

/* ------------------------------------------------------------------ */
console.log(`\n${pass} passed, ${fail} failed`);
if (problems.length) {
  console.log('\nFailures:');
  for (const p of problems) console.log('  ✗ ' + p + '\n');
}
process.exit(fail ? 1 : 0);
