/* ATLAS pre-send personal data guard.
   Runs in the page before any text leaves the device and is also loaded by the
   tests through globalThis. Detection uses the real checksum of each identifier,
   so an order number or a price is not mistaken for an ID. Nothing here sends or
   stores anything. */
(function (root) {
  'use strict';

  const LABELS = {
    tckn: 'Kimlik numarası',
    iban: 'IBAN',
    phone: 'Telefon numarası',
    card: 'Kart numarası'
  };

  function digitsOf(value) { return value.replace(/\D/gu, ''); }

  // Turkish ID: 11 digits, first digit non-zero, two checksum digits.
  function validTckn(value) {
    if (!/^[1-9]\d{10}$/u.test(value)) return false;
    const d = value.split('').map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8];
    const even = d[1] + d[3] + d[5] + d[7];
    let tenth = (odd * 7 - even) % 10;
    if (tenth < 0) tenth += 10;
    if (tenth !== d[9]) return false;
    return d.slice(0, 10).reduce((sum, n) => sum + n, 0) % 10 === d[10];
  }

  function validIban(raw) {
    const iban = raw.replace(/[\s-]/gu, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/u.test(iban)) return false;
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    const digits = rearranged.replace(/[A-Z]/gu, ch => String(ch.charCodeAt(0) - 55));
    let remainder = 0;
    for (const ch of digits) remainder = (remainder * 10 + Number(ch)) % 97;
    return remainder === 1;
  }

  // Card numbers: 13–19 digits that satisfy Luhn.
  function validCard(value) {
    const digits = digitsOf(value);
    if (!/^\d{13,19}$/u.test(digits)) return false;
    let sum = 0, double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = Number(digits[i]);
      if (double) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      double = !double;
    }
    return sum % 10 === 0;
  }

  // A bare 10-digit number is too easy to confuse with a quantity, so a mobile
  // number must carry a country/trunk prefix or visible separators.
  const PHONE = /(?:\+90|0090|0)[\s-]?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b|\b5\d{2}[\s-]\d{3}[\s-]\d{2}[\s-]\d{2}\b/gu;
  const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{0,4})\b/giu;
  const CARD = /\b(?:\d[ -]?){12,18}\d\b/gu;
  const TCKN = /\b\d{11}\b/gu;

  function pushIfValid(out, text, match, type, check) {
    if (!check(match[0])) return;
    out.push({type, label: LABELS[type], value: match[0], start: match.index, end: match.index + match[0].length});
  }

  function findPii(input) {
    if (typeof input !== 'string' || !input) return [];
    const text = input;
    const found = [];
    for (const match of text.matchAll(IBAN)) pushIfValid(found, text, match, 'iban', validIban);
    for (const match of text.matchAll(CARD)) pushIfValid(found, text, match, 'card', validCard);
    for (const match of text.matchAll(TCKN)) pushIfValid(found, text, match, 'tckn', validTckn);
    for (const match of text.matchAll(PHONE)) pushIfValid(found, text, match, 'phone', () => true);
    // One identifier can satisfy several shapes (a card number is also 16 digits);
    // keep the longest, then the earliest, so the list never repeats a span.
    found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const kept = [];
    for (const item of found) {
      if (kept.some(other => item.start < other.end && other.start < item.end)) continue;
      kept.push(item);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  function summarize(findings) {
    const counts = new Map();
    for (const item of findings) counts.set(item.label, (counts.get(item.label) || 0) + 1);
    return [...counts.entries()].map(([label, count]) => `${count} ${label}`).join(' · ');
  }

  function maskPii(input, findings) {
    const list = Array.isArray(findings) ? findings : findPii(input);
    let out = input;
    for (const item of [...list].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, item.start) + '[gizlendi]' + out.slice(item.end);
    }
    return out;
  }

  root.atlasPiiGuard = {findPii, maskPii, summarize};
})(typeof globalThis !== 'undefined' ? globalThis : this);
