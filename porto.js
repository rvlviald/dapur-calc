/**
 * Pure portfolio calculation helpers for Dapur Calc.
 * Importable from both browser ES modules and Node.js.
 */

import { normalizeDate, diffCalendarDays, formatISODate } from './parser.js';

/**
 * Compute derived metrics for a single portfolio entry.
 * @param {{ id?: string, investDate: string, cairDate: string, modal: number, profit: number, isCair?: boolean, note?: string }} entry
 */
export function enrichPortoEntry(entry) {
  const modal = Math.max(0, Number(entry.modal) || 0);
  const profit = Math.max(0, Number(entry.profit) || 0);
  const invest = normalizeDate(entry.investDate);
  const cair = normalizeDate(entry.cairDate || entry.investDate);
  const tenor = Math.max(1, diffCalendarDays(invest, cair));
  const profitPerDay = profit / tenor;
  const yieldTotal = modal > 0 ? profit / modal : 0;
  const yieldPerDay = modal > 0 ? yieldTotal / tenor : 0;

  return {
    id: entry.id || `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    investDate: formatISODate(invest),
    cairDate: formatISODate(cair),
    modal,
    profit,
    totalCair: modal + profit,
    tenor,
    profitPerDay,
    yieldTotal,
    yieldPerDay,
    isCair: Boolean(entry.isCair),
    note: (entry.note || '').trim(),
  };
}

/**
 * Compute aggregate summary across all portfolio entries.
 * @param {Array} entries
 */
export function computePortoSummary(entries) {
  let activeCount = 0;
  let activeModal = 0;
  let activeProfit = 0;
  let activeProfitPerDay = 0;

  let cairCount = 0;
  let cairModal = 0;
  let cairProfit = 0;

  let weightedYieldPerDaySum = 0;
  let totalModal = 0;

  for (const raw of entries) {
    const e = enrichPortoEntry(raw);
    totalModal += e.modal;
    weightedYieldPerDaySum += e.yieldPerDay * e.modal;

    if (e.isCair) {
      cairCount += 1;
      cairModal += e.modal;
      cairProfit += e.profit;
    } else {
      activeCount += 1;
      activeModal += e.modal;
      activeProfit += e.profit;
      activeProfitPerDay += e.profitPerDay;
    }
  }

  return {
    activeCount,
    activeModal,
    activeProfit,
    activeTotalCair: activeModal + activeProfit,
    activeProfitPerDay,
    cairCount,
    cairModal,
    cairProfit,
    cairTotal: cairModal + cairProfit,
    totalCount: activeCount + cairCount,
    totalModal,
    totalProfit: activeProfit + cairProfit,
    avgYieldPerDay: totalModal > 0 ? weightedYieldPerDaySum / totalModal : 0,
  };
}
