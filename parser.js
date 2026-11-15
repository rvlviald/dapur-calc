/**
 * Pure parsing and reply-building utilities for Dapur Calc.
 * Importable from both browser ES modules and Node.js.
 */

const WEEKDAY_MAP = {
  minggu: 0,
  ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
};

const WA_PREFIX_RE =
  /^\[\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*[AP]M)?\]\s*[^:]+:\s*/i;
const FORWARDED_PREFIX_RE = /^\[Forwarded\]\s*/i;
const RECAP_HEADER_RE = /rekapan\s*po/i;
const RECAP_LINE_RE = /^\d{1,2}\/\d{1,2}\s*=/;
const OFFER_RE = /^\s*(\d+)\s*\+\s*(\d+)\s*=\s*(.+?)\s*$/;
const DATE_DM_RE = /^(\d{1,2})\/(\d{1,2})(.*)$/;
const WEEKDAY_RE =
  /^(senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad)(?=$|[^a-zA-Z])(.*)$/i;
const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu;

/**
 * Normalize a date input into a plain { year, month, day } object (1-based month).
 * @param {string | Date | { year: number, month: number, day: number }} [input]
 * @returns {{ year: number, month: number, day: number }}
 */
export function normalizeDate(input) {
  if (!input) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
  }
  if (typeof input === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        year: parsed.getFullYear(),
        month: parsed.getMonth() + 1,
        day: parsed.getDate(),
      };
    }
  }
  if (input instanceof Date) {
    return {
      year: input.getFullYear(),
      month: input.getMonth() + 1,
      day: input.getDate(),
    };
  }
  if (
    typeof input === 'object' &&
    typeof input.year === 'number' &&
    typeof input.month === 'number' &&
    typeof input.day === 'number'
  ) {
    return { year: input.year, month: input.month, day: input.day };
  }
  return normalizeDate(null);
}

/**
 * Format { year, month, day } as YYYY-MM-DD.
 * @param {{ year: number, month: number, day: number }} d
 * @returns {string}
 */
export function formatISODate(d) {
  const y = String(d.year).padStart(4, '0');
  const m = String(d.month).padStart(2, '0');
  const day = String(d.day).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format { year, month, day } as DD/MM.
 * @param {{ year: number, month: number, day: number }} d
 * @returns {string}
 */
export function formatShortDate(d) {
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}`;
}

function toUTCMidnight(d) {
  return Date.UTC(d.year, d.month - 1, d.day);
}

function isValidCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function addDays(d, days) {
  const dt = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/**
 * Calendar day difference (b - a).
 * @param {{ year: number, month: number, day: number }} a
 * @param {{ year: number, month: number, day: number }} b
 * @returns {number}
 */
export function diffCalendarDays(a, b) {
  return Math.round((toUTCMidnight(b) - toUTCMidnight(a)) / 86400000);
}

/**
 * Strip WhatsApp export/forward prefixes from a line for parsing.
 * @param {string} line
 * @returns {string}
 */
export function stripWhatsAppPrefix(line) {
  let s = line;
  let changed = true;
  while (changed) {
    changed = false;
    if (WA_PREFIX_RE.test(s)) {
      s = s.replace(WA_PREFIX_RE, '');
      changed = true;
    }
    if (FORWARDED_PREFIX_RE.test(s)) {
      s = s.replace(FORWARDED_PREFIX_RE, '');
      changed = true;
    }
  }
  return s;
}

function stripEmojis(text) {
  return text.replace(EMOJI_RE, '').trim();
}

function resolveDayMonth(day, month, today) {
  const todayUTC = toUTCMidnight(today);
  for (let offset = 0; offset <= 4; offset += 1) {
    const year = today.year + offset;
    if (!isValidCalendarDate(year, month, day)) continue;
    const candidate = { year, month, day };
    if (toUTCMidnight(candidate) >= todayUTC) {
      return candidate;
    }
  }
  return null;
}

function resolveWeekday(weekdayWord, today) {
  const key = weekdayWord.toLowerCase();
  const targetDow = WEEKDAY_MAP[key];
  if (targetDow === undefined) return null;
  const todayDow = new Date(toUTCMidnight(today)).getUTCDay();
  let diff = (targetDow - todayDow + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(today, diff);
}

/**
 * Parse a single stripped line into an offer object, or null if not an offer.
 * @param {string} rawLine
 * @param {number} lineIndex
 * @param {{ year: number, month: number, day: number }} today
 * @param {string} myTag
 */
function parseOfferLine(rawLine, lineIndex, today, myTag) {
  const stripped = stripWhatsAppPrefix(rawLine).trim();
  if (!stripped || RECAP_LINE_RE.test(stripped)) return null;

  const match = OFFER_RE.exec(stripped);
  if (!match) return null;

  const modal = Number.parseInt(match[1], 10);
  const profit = Number.parseInt(match[2], 10);
  const rhs = match[3].trim();

  let cairDate = null;
  let isEstimated = false;
  let rest = '';

  const dmMatch = DATE_DM_RE.exec(rhs);
  if (dmMatch) {
    const day = Number.parseInt(dmMatch[1], 10);
    const month = Number.parseInt(dmMatch[2], 10);
    cairDate = resolveDayMonth(day, month, today);
    if (!cairDate) return null;
    rest = dmMatch[3];
  } else {
    const wdMatch = WEEKDAY_RE.exec(rhs);
    if (!wdMatch) return null;
    cairDate = resolveWeekday(wdMatch[1], today);
    if (!cairDate) return null;
    isEstimated = true;
    rest = wdMatch[2];
  }

  const cleanedRest = stripEmojis(rest);
  const takenBy = cleanedRest.length > 0 ? cleanedRest : null;
  const normalizedTag = (myTag || 'vivi').trim().toLowerCase();
  const isMine = takenBy !== null && takenBy.toLowerCase() === normalizedTag;
  const available = takenBy === null;

  const tenor = Math.max(1, diffCalendarDays(today, cairDate));
  const profitPerDay = profit / tenor;
  const yieldRatio = modal > 0 ? profit / modal : 0;
  const yieldPerDay = modal > 0 ? yieldRatio / tenor : 0;
  const isWeird = modal <= 0 || profit <= 0 || yieldRatio < 0.01 || yieldRatio > 0.06;

  return {
    id: `line-${lineIndex}`,
    lineIndex,
    rawLine,
    modal,
    profit,
    cairDate: formatISODate(cairDate),
    cairShort: formatShortDate(cairDate),
    tenor,
    profitPerDay,
    yieldRatio,
    yieldPerDay,
    isEstimated,
    isWeird,
    takenBy,
    isMine,
    available,
  };
}

/**
 * Parse a full group message into structured offers.
 * @param {string} text
 * @param {{ today?: string | Date | { year: number, month: number, day: number }, myTag?: string }} [options]
 */
export function parseGroupMessage(text, options = {}) {
  const today = normalizeDate(options.today);
  const myTag = (options.myTag ?? 'vivi').trim() || 'vivi';
  const lines = (text || '').split('\n');

  const offers = [];
  let inRecapBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i].replace(/\r$/, '');
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      inRecapBlock = false;
      continue;
    }

    if (RECAP_HEADER_RE.test(trimmed)) {
      inRecapBlock = true;
      continue;
    }

    if (inRecapBlock) {
      if (RECAP_LINE_RE.test(stripWhatsAppPrefix(trimmed))) {
        continue;
      }
      // If a normal non-recap offer line appears after a non-recap header, allow it only if not recap-shaped.
      if (!OFFER_RE.test(stripWhatsAppPrefix(trimmed))) {
        continue;
      }
    }

    const offer = parseOfferLine(rawLine, i, today, myTag);
    if (offer) {
      offers.push(offer);
    }
  }

  return {
    today: formatISODate(today),
    myTag,
    offers,
    lineCount: lines.length,
  };
}

/**
 * Build the reply text by appending ` <tag>` to selected lines,
 * leaving all other lines byte-for-byte identical.
 * @param {string} originalText
 * @param {Set<number> | number[]} selectedLineIndices
 * @param {string} [myTag]
 * @returns {string}
 */
export function buildReplyText(originalText, selectedLineIndices, myTag = 'vivi') {
  const selectedSet =
    selectedLineIndices instanceof Set
      ? selectedLineIndices
      : new Set(selectedLineIndices);
  const tag = (myTag || 'vivi').trim() || 'vivi';

  if (!originalText) return '';
  const lines = originalText.split('\n');

  return lines
    .map((line, idx) => {
      if (!selectedSet.has(idx)) return line;
      if (line.endsWith('\r')) {
        return `${line.slice(0, -1)} ${tag}\r`;
      }
      return `${line} ${tag}`;
    })
    .join('\n');
}

/**
 * Build text containing only the user's selected lines with ` <tag>` appended.
 * @param {string} originalText
 * @param {Set<number> | number[]} selectedLineIndices
 * @param {string} [myTag]
 * @returns {string}
 */
export function buildMyLinesOnly(originalText, selectedLineIndices, myTag = 'vivi') {
  const selectedSet =
    selectedLineIndices instanceof Set
      ? selectedLineIndices
      : new Set(selectedLineIndices);
  const tag = (myTag || 'vivi').trim() || 'vivi';

  if (!originalText) return '';
  const lines = originalText.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (selectedSet.has(i)) {
      const clean = lines[i].replace(/\r$/, '');
      result.push(`${clean} ${tag}`);
    }
  }
  return result.join('\n');
}
