import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGroupMessage,
  buildReplyText,
  buildMyLinesOnly,
} from '../parser.js';
import {
  optimizeSelection,
  computeSummary,
  isBetterState,
} from '../optimizer.js';

const TODAY = '2026-11-15';

test('Parser: standard available line', () => {
  const res = parseGroupMessage('12800 + 300 = 25/11', { today: TODAY, myTag: 'vivi' });
  assert.equal(res.offers.length, 1);
  const o = res.offers[0];
  assert.equal(o.modal, 12800);
  assert.equal(o.profit, 300);
  assert.equal(o.cairDate, '2026-11-25');
  assert.equal(o.tenor, 10);
  assert.equal(o.available, true);
  assert.equal(o.takenBy, null);
  assert.equal(o.isWeird, false);
});

test('Parser: no space before my tag', () => {
  const res = parseGroupMessage('13650 + 350 =24/11vivi', { today: TODAY, myTag: 'vivi' });
  assert.equal(res.offers.length, 1);
  const o = res.offers[0];
  assert.equal(o.tenor, 9);
  assert.equal(o.takenBy, 'vivi');
  assert.equal(o.isMine, true);
  assert.equal(o.available, false);
});

test('Parser: multi-word claimer', () => {
  const res = parseGroupMessage('28300 + 850 =25/11 denis sharing liana', {
    today: TODAY,
    myTag: 'vivi',
  });
  assert.equal(res.offers.length, 1);
  assert.equal(res.offers[0].takenBy, 'denis sharing liana');
  assert.equal(res.offers[0].isMine, false);
  assert.equal(res.offers[0].available, false);
});

test('Parser: Indonesian weekday word (rabu) resolves to next Wednesday and marked estimated', () => {
  const res = parseGroupMessage('7800 + 250  =rabu', { today: TODAY, myTag: 'vivi' });
  assert.equal(res.offers.length, 1);
  const o = res.offers[0];
  assert.equal(o.cairDate, '2026-11-18');
  assert.equal(o.tenor, 3);
  assert.equal(o.isEstimated, true);
  assert.equal(o.available, true);
});

test('Parser: same weekday as today (minggu) resolves to +7 days', () => {
  const res = parseGroupMessage('4800+200=minggu dewi atun', { today: TODAY, myTag: 'vivi' });
  assert.equal(res.offers.length, 1);
  assert.equal(res.offers[0].cairDate, '2026-11-22');
  assert.equal(res.offers[0].tenor, 7);
  assert.equal(res.offers[0].takenBy, 'dewi atun');
});

test('Parser: ignores Cancel, recap block, and recap-shaped lines', () => {
  const msg = [
    '9800 Cancel',
    '🌸Rekapan PO🌸',
    '03/10=7200+250=12/10 risti✅',
    '',
    '12800 + 300 = 25/11 ✅',
  ].join('\n');
  const res = parseGroupMessage(msg, { today: TODAY, myTag: 'vivi' });
  assert.equal(res.offers.length, 1);
  assert.equal(res.offers[0].modal, 12800);
  assert.equal(res.offers[0].available, true);
  assert.equal(res.offers[0].takenBy, null);
});

test('Parser: weird numbers flagged Angka aneh and not auto-selected', () => {
  const res = parseGroupMessage('1400 + 400 =23/11', { today: TODAY, myTag: 'vivi' });
  assert.equal(res.offers.length, 1);
  const o = res.offers[0];
  assert.equal(o.isWeird, true);
  const opt = optimizeSelection(res.offers, { uangGue: 50000, saldoBandar: 0 });
  assert.equal(opt.selectedOffers.length, 0);
});

test('Parser: strips WhatsApp export prefix and parses', () => {
  const res = parseGroupMessage(
    '[11/15/26, 12:00:31 PM] You: 14300 + 400 =25/11 vivi',
    { today: TODAY, myTag: 'vivi' }
  );
  assert.equal(res.offers.length, 1);
  assert.equal(res.offers[0].modal, 14300);
  assert.equal(res.offers[0].profit, 400);
  assert.equal(res.offers[0].takenBy, 'vivi');
  assert.equal(res.offers[0].isMine, true);
});

test('Parser: December to January rollover', () => {
  const res = parseGroupMessage('10000 + 300 = 05/01', {
    today: '2026-12-28',
    myTag: 'vivi',
  });
  assert.equal(res.offers[0].cairDate, '2027-01-05');
  assert.equal(res.offers[0].tenor, 8);
});

test('Optimizer: brute-force agreement across 250 random instances', () => {
  // Deterministic PRNG for reproducible tests
  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let trial = 0; trial < 250; trial += 1) {
    const n = 1 + Math.floor(rand() * 13); // 1..13
    const offers = [];
    let totalModalAll = 0;
    for (let i = 0; i < n; i += 1) {
      const modal = (5 + Math.floor(rand() * 40)) * 100;
      const profit = Math.max(10, Math.round(modal * (0.015 + rand() * 0.03)));
      const tenor = 1 + Math.floor(rand() * 14);
      totalModalAll += modal;
      offers.push({
        id: `o-${i}`,
        lineIndex: i,
        modal,
        profit,
        tenor,
        profitPerDay: profit / tenor,
        available: true,
        isWeird: false,
      });
    }

    const capacity = Math.floor(rand() * (totalModalAll * 1.1));
    const uangGue = Math.floor(capacity * 0.7);
    const saldoBandar = capacity - uangGue;
    const mode = trial % 2 === 0 ? 'perDay' : 'total';

    const dpRes = optimizeSelection(offers, { uangGue, saldoBandar, mode });

    // Brute force
    let bestBrute = { value: 0, profit: 0, modal: 0, count: 0 };
    const totalMasks = 1 << n;
    for (let mask = 0; mask < totalMasks; mask += 1) {
      let m = 0;
      let p = 0;
      let v = 0;
      let c = 0;
      for (let i = 0; i < n; i += 1) {
        if (mask & (1 << i)) {
          m += offers[i].modal;
          if (m > capacity) break;
          p += offers[i].profit;
          v += mode === 'total' ? offers[i].profit : offers[i].profitPerDay;
          c += 1;
        }
      }
      if (m <= capacity) {
        const cand = { value: v, profit: p, modal: m, count: c };
        if (isBetterState(cand, bestBrute)) {
          bestBrute = cand;
        }
      }
    }

    const dpValue =
      mode === 'total'
        ? dpRes.summary.totalProfit
        : dpRes.summary.totalProfitPerDay;
    assert.ok(
      Math.abs(dpValue - bestBrute.value) < 1e-6,
      `Trial ${trial} (${mode}): DP=${dpValue} vs Brute=${bestBrute.value}`
    );
    assert.equal(dpRes.summary.totalModal, bestBrute.modal);
    assert.equal(dpRes.summary.count, bestBrute.count);
  }
});

test('Optimizer: capacity 0 and capacity >= sum of all modal', () => {
  const offers = [
    { id: '1', lineIndex: 0, modal: 10000, profit: 300, tenor: 5, profitPerDay: 60, available: true, isWeird: false },
    { id: '2', lineIndex: 1, modal: 15000, profit: 450, tenor: 5, profitPerDay: 90, available: true, isWeird: false },
  ];

  const zeroRes = optimizeSelection(offers, { uangGue: 0, saldoBandar: 0 });
  assert.equal(zeroRes.selectedOffers.length, 0);

  const fullRes = optimizeSelection(offers, { uangGue: 30000, saldoBandar: 0 });
  assert.equal(fullRes.selectedOffers.length, 2);
  assert.equal(fullRes.summary.totalModal, 25000);
});

test('Optimizer: topup calculation', () => {
  const summary1 = computeSummary([{ modal: 30000, profit: 900, profitPerDay: 90 }], {
    uangGue: 40000,
    saldoBandar: 12000,
  });
  assert.equal(summary1.topup, 18000);
  assert.equal(summary1.exceedsCapacity, false);

  const summary2 = computeSummary([{ modal: 10000, profit: 300, profitPerDay: 30 }], {
    uangGue: 5000,
    saldoBandar: 12000,
  });
  assert.equal(summary2.topup, 0);
  assert.equal(summary2.sisaUang, 5000);
});

test('Reply text: leaves unselected lines byte-for-byte identical', () => {
  const original = [
    'selamat siang semua 🌸',
    '',
    '12800 + 300 = 25/11',
    '11900 + 250 = 24/11 endang✅',
    '13800 + 350 =25/11',
    '',
    '9800 Cancel',
  ].join('\n');

  const reply = buildReplyText(original, new Set([2, 4]), 'vivi');
  const origLines = original.split('\n');
  const replyLines = reply.split('\n');

  assert.equal(replyLines.length, origLines.length);
  assert.equal(replyLines[0], origLines[0]);
  assert.equal(replyLines[1], '');
  assert.equal(replyLines[2], '12800 + 300 = 25/11 vivi');
  assert.equal(replyLines[3], '11900 + 250 = 24/11 endang✅');
  assert.equal(replyLines[4], '13800 + 350 =25/11 vivi');
  assert.equal(replyLines[5], '');
  assert.equal(replyLines[6], '9800 Cancel');

  const mineOnly = buildMyLinesOnly(original, new Set([2, 4]), 'vivi');
  assert.equal(mineOnly, '12800 + 300 = 25/11 vivi\n13800 + 350 =25/11 vivi');
});
