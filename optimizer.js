/**
 * Exact 0/1 knapsack optimizer and financial summary for Dapur Calc.
 * Pure functions, importable from both browser ES modules and Node.js.
 */

const EPS = 1e-9;

function gcd(a, b) {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Compare two knapsack states according to the spec:
 * 1. Higher value (profit/day or total profit)
 * 2. Higher total profit at payout
 * 3. Higher total modal used
 * 4. Fewer kitchens
 */
export function isBetterState(cand, curr) {
  if (cand.value > curr.value + EPS) return true;
  if (Math.abs(cand.value - curr.value) > EPS) return false;

  if (cand.profit > curr.profit + EPS) return true;
  if (Math.abs(cand.profit - curr.profit) > EPS) return false;

  if (cand.modal !== curr.modal) return cand.modal > curr.modal;
  return cand.count < curr.count;
}

function solveDenseDP(items, capacity, gcdUnit) {
  const n = items.length;
  const weights = items.map((it) => Math.trunc(it.modal / gcdUnit));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  const W = Math.min(Math.floor(capacity / gcdUnit), totalWeight);

  const dpValue = new Float64Array(W + 1);
  const dpProfit = new Float64Array(W + 1);
  const dpModal = new Int32Array(W + 1);
  const dpCount = new Int32Array(W + 1);
  const dpMask = new Array(W + 1).fill(0n);

  dpValue.fill(-1);
  dpValue[0] = 0;

  for (let i = 0; i < n; i += 1) {
    const w = weights[i];
    const item = items[i];
    const bit = 1n << BigInt(i);

    for (let c = W; c >= w; c -= 1) {
      const prev = c - w;
      if (dpValue[prev] < 0) continue;

      const cand = {
        value: dpValue[prev] + item.value,
        profit: dpProfit[prev] + item.profit,
        modal: dpModal[prev] + item.modal,
        count: dpCount[prev] + 1,
      };
      const curr = {
        value: dpValue[c],
        profit: dpProfit[c],
        modal: dpModal[c],
        count: dpCount[c],
      };

      if (dpValue[c] < 0 || isBetterState(cand, curr)) {
        dpValue[c] = cand.value;
        dpProfit[c] = cand.profit;
        dpModal[c] = cand.modal;
        dpCount[c] = cand.count;
        dpMask[c] = dpMask[prev] | bit;
      }
    }
  }

  let bestIdx = 0;
  let bestState = {
    value: dpValue[0],
    profit: dpProfit[0],
    modal: dpModal[0],
    count: dpCount[0],
  };

  for (let c = 1; c <= W; c += 1) {
    if (dpValue[c] < 0) continue;
    const cand = {
      value: dpValue[c],
      profit: dpProfit[c],
      modal: dpModal[c],
      count: dpCount[c],
    };
    if (isBetterState(cand, bestState)) {
      bestState = cand;
      bestIdx = c;
    }
  }

  const mask = dpMask[bestIdx];
  const chosen = [];
  for (let i = 0; i < n; i += 1) {
    if ((mask & (1n << BigInt(i))) !== 0n) {
      chosen.push(items[i].offer);
    }
  }
  return chosen;
}

function solveSparseDP(items, capacity) {
  let states = [{ modal: 0, value: 0, profit: 0, count: 0, mask: 0n }];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const bit = 1n << BigInt(i);
    const next = states.slice();

    for (let j = 0; j < states.length; j += 1) {
      const s = states[j];
      const newModal = s.modal + item.modal;
      if (newModal <= capacity) {
        next.push({
          modal: newModal,
          value: s.value + item.value,
          profit: s.profit + item.profit,
          count: s.count + 1,
          mask: s.mask | bit,
        });
      }
    }

    // Sort by modal asc, then better state first; prune strictly dominated states
    next.sort((a, b) => {
      if (a.modal !== b.modal) return a.modal - b.modal;
      return isBetterState(a, b) ? -1 : 1;
    });

    const pruned = [];
    let bestSoFar = null;
    for (let j = 0; j < next.length; j += 1) {
      const s = next[j];
      if (!bestSoFar || isBetterState(s, bestSoFar)) {
        pruned.push(s);
        bestSoFar = s;
      }
    }
    states = pruned;
  }

  let best = states[0];
  for (let j = 1; j < states.length; j += 1) {
    if (isBetterState(states[j], best)) {
      best = states[j];
    }
  }

  const chosen = [];
  for (let i = 0; i < items.length; i += 1) {
    if ((best.mask & (1n << BigInt(i))) !== 0n) {
      chosen.push(items[i].offer);
    }
  }
  return chosen;
}

/**
 * Select the optimal subset of available, non-weird offers fitting within uangGue + saldoBandar.
 * @param {Array} offers
 * @param {{ uangGue: number, saldoBandar: number, mode?: 'perDay' | 'total' }} options
 */
export function optimizeSelection(offers, options) {
  const uangGue = Math.max(0, Number(options?.uangGue) || 0);
  const saldoBandar = Math.max(0, Number(options?.saldoBandar) || 0);
  const mode = options?.mode === 'total' ? 'total' : 'perDay';
  const capacity = Math.floor(uangGue + saldoBandar);

  const eligible = [];
  for (const offer of offers) {
    if (!offer.available || offer.isWeird) continue;
    if (offer.modal <= 0 || offer.modal > capacity) continue;
    eligible.push({
      offer,
      modal: Math.trunc(offer.modal),
      profit: offer.profit,
      value: mode === 'total' ? offer.profit : offer.profitPerDay,
    });
  }

  if (eligible.length === 0 || capacity <= 0) {
    return {
      selectedOffers: [],
      selectedIds: new Set(),
      selectedLineIndices: new Set(),
      summary: computeSummary([], { uangGue, saldoBandar }),
    };
  }

  let g = eligible[0].modal;
  for (let i = 1; i < eligible.length; i += 1) {
    g = gcd(g, eligible[i].modal);
    if (g === 1) break;
  }

  const totalScaled = eligible.reduce((acc, it) => acc + Math.trunc(it.modal / g), 0);
  const capScaled = Math.min(Math.floor(capacity / g), totalScaled);

  const selectedOffers =
    capScaled <= 250000
      ? solveDenseDP(eligible, capacity, g)
      : solveSparseDP(eligible, capacity);

  const selectedIds = new Set(selectedOffers.map((o) => o.id));
  const selectedLineIndices = new Set(selectedOffers.map((o) => o.lineIndex));

  return {
    selectedOffers,
    selectedIds,
    selectedLineIndices,
    summary: computeSummary(selectedOffers, { uangGue, saldoBandar }),
  };
}

/**
 * Compute financial totals for any chosen list of offers.
 * @param {Array} selectedOffers
 * @param {{ uangGue: number, saldoBandar: number }} options
 */
export function computeSummary(selectedOffers, options) {
  const uangGue = Math.max(0, Number(options?.uangGue) || 0);
  const saldoBandar = Math.max(0, Number(options?.saldoBandar) || 0);
  const capacity = uangGue + saldoBandar;

  let totalModal = 0;
  let totalProfit = 0;
  let totalProfitPerDay = 0;

  for (const o of selectedOffers) {
    totalModal += o.modal;
    totalProfit += o.profit;
    totalProfitPerDay += o.profitPerDay;
  }

  const topup = Math.max(0, totalModal - saldoBandar);
  const exceedsCapacity = totalModal > capacity;
  const sisaUang = uangGue - topup;

  return {
    count: selectedOffers.length,
    totalModal,
    totalProfit,
    totalProfitPerDay,
    topup,
    sisaUang,
    capacity,
    exceedsCapacity,
  };
}
