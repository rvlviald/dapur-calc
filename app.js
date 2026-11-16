import {
  parseGroupMessage,
  buildReplyText,
  buildMyLinesOnly,
  normalizeDate,
  formatISODate,
  formatShortDate,
} from './parser.js';
import { optimizeSelection, computeSummary } from './optimizer.js';
import { enrichPortoEntry, computePortoSummary } from './porto.js';

const STORAGE_KEY = 'dapurCalcStateV1';
const PORTO_STORAGE_KEY = 'dapurCalcPortoV1';
const idFormatter = new Intl.NumberFormat('id-ID');

function getDeviceTodayISO() {
  return formatISODate(normalizeDate(new Date()));
}

function loadState() {
  const defaults = {
    uangGue: '',
    saldoBandar: '',
    myTag: 'vivi',
    today: getDeviceTodayISO(),
    mode: 'perDay',
    unitMultiplier: 1000,
    rawText: '',
    activePage: 'calculator',
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...defaults,
      ...saved,
      today: saved.today || defaults.today,
      myTag: saved.myTag || defaults.myTag,
      unitMultiplier: Number(saved.unitMultiplier) === 1 ? 1 : 1000,
      mode: saved.mode === 'total' ? 'total' : 'perDay',
      activePage: ['calculator', 'porto', 'setting'].includes(saved.activePage)
        ? saved.activePage
        : 'calculator',
    };
  } catch {
    return defaults;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function loadPorto() {
  try {
    const arr = JSON.parse(localStorage.getItem(PORTO_STORAGE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePorto(entries) {
  try {
    localStorage.setItem(PORTO_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota errors
  }
}

function formatRupiah(amountInUnits, unitMultiplier) {
  const full = Math.round((Number(amountInUnits) || 0) * unitMultiplier);
  const sign = full < 0 ? '-' : '';
  return `${sign}Rp ${idFormatter.format(Math.abs(full))}`;
}

function formatShortRupiah(amountInUnits, unitMultiplier) {
  const full = Math.round((Number(amountInUnits) || 0) * unitMultiplier);
  if (Math.abs(full) >= 1_000_000) {
    const jt = (full / 1_000_000).toFixed(1).replace(/\.0$/, '').replace('.', ',');
    return `Rp ${jt} jt`;
  }
  return formatRupiah(amountInUnits, unitMultiplier);
}

function formatPercent(ratio) {
  return `${(ratio * 100).toFixed(2).replace('.', ',')}%`;
}

// DOM references
const els = {
  // Navigation & pages
  navTabs: document.querySelectorAll('.nav-tab'),
  pageCalculator: document.getElementById('pageCalculator'),
  pagePorto: document.getElementById('pagePorto'),
  pageSetting: document.getElementById('pageSetting'),
  portoNavBadge: document.getElementById('portoNavBadge'),
  stickySummary: document.getElementById('stickySummary'),
  goSettingChip: document.getElementById('goSettingChip'),
  calcMetaChip: document.getElementById('calcMetaChip'),

  // Calculator
  groupInput: document.getElementById('groupInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  clearBtn: document.getElementById('clearBtn'),
  uangGue: document.getElementById('uangGue'),
  saldoBandar: document.getElementById('saldoBandar'),
  uangGueFmt: document.getElementById('uangGueFmt'),
  saldoBandarFmt: document.getElementById('saldoBandarFmt'),
  unitLabel1: document.getElementById('unitLabel1'),
  unitLabel2: document.getElementById('unitLabel2'),
  modePerDay: document.getElementById('modePerDay'),
  modeTotal: document.getElementById('modeTotal'),
  recalcBtn: document.getElementById('recalcBtn'),
  statusBanner: document.getElementById('statusBanner'),
  offersCount: document.getElementById('offersCount'),
  offersList: document.getElementById('offersList'),
  replyPreview: document.getElementById('replyPreview'),
  saveSelectedToPortoBtn: document.getElementById('saveSelectedToPortoBtn'),
  copyGroupBtn: document.getElementById('copyGroupBtn'),
  shareWaBtn: document.getElementById('shareWaBtn'),
  copyMineBtn: document.getElementById('copyMineBtn'),
  summaryTopup: document.getElementById('summaryTopup'),
  summaryModal: document.getElementById('summaryModal'),
  summaryProfitDay: document.getElementById('summaryProfitDay'),
  summaryProfitTotal: document.getElementById('summaryProfitTotal'),
  summarySisa: document.getElementById('summarySisa'),

  // Porto
  portoActiveCount: document.getElementById('portoActiveCount'),
  portoActiveModal: document.getElementById('portoActiveModal'),
  portoActiveProfit: document.getElementById('portoActiveProfit'),
  portoActiveCair: document.getElementById('portoActiveCair'),
  portoCairCount: document.getElementById('portoCairCount'),
  portoCairModal: document.getElementById('portoCairModal'),
  portoCairProfit: document.getElementById('portoCairProfit'),
  portoCairTotal: document.getElementById('portoCairTotal'),
  portoTotalCount: document.getElementById('portoTotalCount'),
  portoTotalModal: document.getElementById('portoTotalModal'),
  portoTotalProfit: document.getElementById('portoTotalProfit'),
  portoAvgYield: document.getElementById('portoAvgYield'),
  portoForm: document.getElementById('portoForm'),
  portoCancelEditBtn: document.getElementById('portoCancelEditBtn'),
  portoInvestDate: document.getElementById('portoInvestDate'),
  portoCairDate: document.getElementById('portoCairDate'),
  portoModal: document.getElementById('portoModal'),
  portoProfit: document.getElementById('portoProfit'),
  portoModalFmt: document.getElementById('portoModalFmt'),
  portoProfitFmt: document.getElementById('portoProfitFmt'),
  portoUnitLabel1: document.getElementById('portoUnitLabel1'),
  portoUnitLabel2: document.getElementById('portoUnitLabel2'),
  portoNote: document.getElementById('portoNote'),
  portoIsCair: document.getElementById('portoIsCair'),
  portoLivePreview: document.getElementById('portoLivePreview'),
  portoSubmitBtn: document.getElementById('portoSubmitBtn'),
  portoFilterPills: document.querySelectorAll('.filter-pill'),
  portoList: document.getElementById('portoList'),

  // Setting
  myTag: document.getElementById('myTag'),
  todayDate: document.getElementById('todayDate'),
  resetTodayBtn: document.getElementById('resetTodayBtn'),
  unitSelect: document.getElementById('unitSelect'),
  exportDataBtn: document.getElementById('exportDataBtn'),
  importDataBtn: document.getElementById('importDataBtn'),
  importFileInput: document.getElementById('importFileInput'),
  clearPortoBtn: document.getElementById('clearPortoBtn'),

  // Global
  installBtn: document.getElementById('installBtn'),
  toast: document.getElementById('toast'),
};

const state = loadState();
let portoEntries = loadPorto();
let portoFilter = 'all';
let editingPortoId = null;

let manualSelectedIds = null;
let currentOffers = [];
let currentSelectedIds = new Set();
let deferredInstallPrompt = null;
let toastTimer = null;

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

// ==================== PAGE NAVIGATION ====================

function switchPage(page) {
  state.activePage = page;
  saveState(state);

  els.pageCalculator.hidden = page !== 'calculator';
  els.pagePorto.hidden = page !== 'porto';
  els.pageSetting.hidden = page !== 'setting';

  els.stickySummary.hidden = page !== 'calculator';
  document.body.classList.toggle('no-sticky-footer', page !== 'calculator');

  for (const tab of els.navTabs) {
    const isActive = tab.dataset.page === page;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  if (page === 'porto') {
    renderPorto();
  }
}

// ==================== CALCULATOR ====================

function syncInputsFromState() {
  els.groupInput.value = state.rawText;
  els.uangGue.value = state.uangGue;
  els.saldoBandar.value = state.saldoBandar;
  els.myTag.value = state.myTag;
  els.todayDate.value = state.today;
  els.unitSelect.value = String(state.unitMultiplier);
  els.modePerDay.classList.toggle('active', state.mode === 'perDay');
  els.modeTotal.classList.toggle('active', state.mode === 'total');

  const unitText = state.unitMultiplier === 1000 ? '(×1.000)' : '(×1)';
  els.unitLabel1.textContent = unitText;
  els.unitLabel2.textContent = unitText;
  els.portoUnitLabel1.textContent = unitText;
  els.portoUnitLabel2.textContent = unitText;

  const tag = (state.myTag || 'vivi').trim() || 'vivi';
  const shortToday = formatShortDate(normalizeDate(state.today));
  els.calcMetaChip.textContent = `Tag: ${tag} • ${shortToday}`;

  updateMoneyHints();
}

function updateMoneyHints() {
  const uang = Math.max(0, Number(state.uangGue) || 0);
  const saldo = Math.max(0, Number(state.saldoBandar) || 0);
  els.uangGueFmt.textContent = formatRupiah(uang, state.unitMultiplier);
  els.saldoBandarFmt.textContent = formatRupiah(saldo, state.unitMultiplier);
}

function sortOffersForDisplay(offers) {
  return [...offers].sort((a, b) => {
    const groupA = a.available ? 0 : a.isMine ? 1 : 2;
    const groupB = b.available ? 0 : b.isMine ? 1 : 2;
    if (groupA !== groupB) return groupA - groupB;
    if (b.profitPerDay !== a.profitPerDay) return b.profitPerDay - a.profitPerDay;
    if (b.yieldPerDay !== a.yieldPerDay) return b.yieldPerDay - a.yieldPerDay;
    return b.modal - a.modal;
  });
}

function renderCalculator() {
  const uangGue = Math.max(0, Number(state.uangGue) || 0);
  const saldoBandar = Math.max(0, Number(state.saldoBandar) || 0);
  const myTag = (state.myTag || 'vivi').trim() || 'vivi';
  const today = state.today || getDeviceTodayISO();

  const parsed = parseGroupMessage(state.rawText, { today, myTag });
  currentOffers = sortOffersForDisplay(parsed.offers);

  let summary;
  if (manualSelectedIds === null) {
    const opt = optimizeSelection(currentOffers, {
      uangGue,
      saldoBandar,
      mode: state.mode,
    });
    currentSelectedIds = opt.selectedIds;
    summary = opt.summary;
  } else {
    const validIds = new Set(
      currentOffers.filter((o) => o.available).map((o) => o.id)
    );
    currentSelectedIds = new Set(
      [...manualSelectedIds].filter((id) => validIds.has(id))
    );
    const chosen = currentOffers.filter((o) => currentSelectedIds.has(o.id));
    summary = computeSummary(chosen, { uangGue, saldoBandar });
  }

  renderStatusBanner(currentOffers, summary);
  renderOffersList(currentOffers, currentSelectedIds);
  renderReplyPreview(state.rawText, currentOffers, currentSelectedIds, myTag);
  renderSummaryBar(summary);
}

function renderStatusBanner(offers, summary) {
  const availableCount = offers.filter((o) => o.available && !o.isWeird).length;
  const banner = els.statusBanner;
  banner.className = 'status-banner';

  if (offers.length === 0) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;
  if (summary.exceedsCapacity) {
    banner.classList.add('is-danger');
    banner.textContent = 'Modal melebihi uang + saldo bandar.';
    return;
  }

  if (summary.count === 0) {
    if (availableCount === 0) {
      banner.classList.add('is-warn');
      banner.textContent = 'Belum ada dapur tersedia yang siap diambil.';
    } else {
      banner.classList.add('is-warn');
      banner.textContent =
        'Uang + saldo bandar belum cukup buat ambil dapur yang tersedia.';
    }
    return;
  }

  const profitDayTxt = formatShortRupiah(
    summary.totalProfitPerDay,
    state.unitMultiplier
  );
  const topupTxt =
    summary.topup === 0
      ? 'tidak perlu topup'
      : `topup ${formatShortRupiah(summary.topup, state.unitMultiplier)}`;
  banner.textContent = `Ambil ${summary.count} dapur, profit ${profitDayTxt}/hari, ${topupTxt}.`;
}

function renderOffersList(offers, selectedIds) {
  els.offersCount.textContent = String(offers.length);
  els.offersList.innerHTML = '';

  if (offers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.rawText.trim()
      ? 'Tidak ditemukan baris dapur di teks ini.'
      : 'Tempel chat grup di atas buat lihat ranking dapur terbaik.';
    els.offersList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const offer of offers) {
    const isSelected = selectedIds.has(offer.id);
    const card = document.createElement('label');
    card.className = 'offer-card';
    if (isSelected) card.classList.add('is-selected');
    if (!offer.available) {
      card.classList.add(offer.isMine ? 'is-mine' : 'is-taken');
    }

    const checkWrap = document.createElement('div');
    checkWrap.className = 'offer-check-wrap';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'offer-check';
    checkbox.checked = isSelected;
    checkbox.disabled = !offer.available;
    checkbox.addEventListener('change', () => {
      if (manualSelectedIds === null) {
        manualSelectedIds = new Set(currentSelectedIds);
      }
      if (checkbox.checked) {
        manualSelectedIds.add(offer.id);
      } else {
        manualSelectedIds.delete(offer.id);
      }
      renderCalculator();
    });
    checkWrap.appendChild(checkbox);

    const body = document.createElement('div');
    body.className = 'offer-body';

    const top = document.createElement('div');
    top.className = 'offer-top';

    const modalEl = document.createElement('span');
    modalEl.className = 'offer-modal';
    modalEl.textContent = formatRupiah(offer.modal, state.unitMultiplier);

    const perDayEl = document.createElement('span');
    perDayEl.className = 'offer-perday';
    perDayEl.textContent = `+${formatRupiah(offer.profitPerDay, state.unitMultiplier)}/hr`;

    top.append(modalEl, perDayEl);

    const meta = document.createElement('div');
    meta.className = 'offer-meta';
    const m1 = document.createElement('span');
    m1.textContent = `Profit: ${formatRupiah(offer.profit, state.unitMultiplier)}`;
    const m2 = document.createElement('span');
    m2.textContent = `Cair: ${offer.cairShort} (${offer.tenor} hr)`;
    const m3 = document.createElement('span');
    m3.textContent = `Yield: ${formatPercent(offer.yieldPerDay)}/hr`;
    meta.append(m1, m2, m3);

    body.append(top, meta);

    if (offer.takenBy || offer.isEstimated || offer.isWeird) {
      const badges = document.createElement('div');
      badges.className = 'offer-badges';

      if (offer.isMine) {
        const b = document.createElement('span');
        b.className = 'badge badge-mine';
        b.textContent = `Sudah punya lu (${offer.takenBy})`;
        badges.appendChild(b);
      } else if (offer.takenBy) {
        const b = document.createElement('span');
        b.className = 'badge badge-taken';
        b.textContent = `Sudah diambil: ${offer.takenBy}`;
        badges.appendChild(b);
      }

      if (offer.isEstimated) {
        const b = document.createElement('span');
        b.className = 'badge badge-est';
        b.textContent = 'Perkiraan';
        badges.appendChild(b);
      }

      if (offer.isWeird) {
        const b = document.createElement('span');
        b.className = 'badge badge-weird';
        b.textContent = 'Angka aneh';
        badges.appendChild(b);
      }

      body.appendChild(badges);
    }

    card.append(checkWrap, body);
    frag.appendChild(card);
  }

  els.offersList.appendChild(frag);
}

function getSelectedLineIndices() {
  const set = new Set();
  for (const offer of currentOffers) {
    if (currentSelectedIds.has(offer.id)) {
      set.add(offer.lineIndex);
    }
  }
  return set;
}

function renderReplyPreview(rawText, offers, selectedIds, myTag) {
  const pre = els.replyPreview;
  pre.innerHTML = '';

  if (!rawText) {
    const code = document.createElement('code');
    code.textContent = 'Belum ada chat yang ditempel.';
    pre.appendChild(code);
    return;
  }

  const selectedLines = new Set();
  for (const offer of offers) {
    if (selectedIds.has(offer.id)) {
      selectedLines.add(offer.lineIndex);
    }
  }

  const lines = rawText.split('\n');
  const frag = document.createDocumentFragment();

  for (let i = 0; i < lines.length; i += 1) {
    const cleanLine = lines[i].replace(/\r$/, '');
    frag.appendChild(document.createTextNode(cleanLine));
    if (selectedLines.has(i)) {
      const mark = document.createElement('mark');
      mark.textContent = ` ${myTag}`;
      frag.appendChild(mark);
    }
    if (i < lines.length - 1) {
      frag.appendChild(document.createTextNode('\n'));
    }
  }
  pre.appendChild(frag);
}

function renderSummaryBar(summary) {
  els.summaryModal.textContent = formatRupiah(
    summary.totalModal,
    state.unitMultiplier
  );
  els.summaryProfitDay.textContent = formatRupiah(
    summary.totalProfitPerDay,
    state.unitMultiplier
  );
  els.summaryProfitTotal.textContent = formatRupiah(
    summary.totalProfit,
    state.unitMultiplier
  );
  els.summarySisa.textContent = formatRupiah(
    summary.sisaUang,
    state.unitMultiplier
  );

  els.summaryTopup.classList.remove('is-zero', 'is-danger');
  if (summary.exceedsCapacity) {
    els.summaryTopup.classList.add('is-danger');
    els.summaryTopup.textContent = formatRupiah(
      summary.topup,
      state.unitMultiplier
    );
  } else if (summary.topup === 0) {
    els.summaryTopup.classList.add('is-zero');
    els.summaryTopup.textContent = 'Tidak perlu topup';
  } else {
    els.summaryTopup.textContent = formatRupiah(
      summary.topup,
      state.unitMultiplier
    );
  }
}

function handleCalcInputChange() {
  manualSelectedIds = null;
  saveState(state);
  syncInputsFromState();
  renderCalculator();
}

// ==================== PORTO ====================

function resetPortoForm() {
  editingPortoId = null;
  els.portoInvestDate.value = state.today || getDeviceTodayISO();
  els.portoCairDate.value = state.today || getDeviceTodayISO();
  els.portoModal.value = '';
  els.portoProfit.value = '';
  els.portoNote.value = '';
  els.portoIsCair.checked = false;
  els.portoSubmitBtn.textContent = 'Simpan ke Porto';
  els.portoCancelEditBtn.hidden = true;
  updatePortoLivePreview();
}

function updatePortoLivePreview() {
  const modal = Math.max(0, Number(els.portoModal.value) || 0);
  const profit = Math.max(0, Number(els.portoProfit.value) || 0);
  els.portoModalFmt.textContent = formatRupiah(modal, state.unitMultiplier);
  els.portoProfitFmt.textContent = formatRupiah(profit, state.unitMultiplier);

  const enriched = enrichPortoEntry({
    investDate: els.portoInvestDate.value || getDeviceTodayISO(),
    cairDate: els.portoCairDate.value || els.portoInvestDate.value || getDeviceTodayISO(),
    modal,
    profit,
  });

  els.portoLivePreview.innerHTML = `Tenor: <b>${enriched.tenor} hr</b> • Profit/hr: <b>${formatRupiah(
    enriched.profitPerDay,
    state.unitMultiplier
  )}</b> • Yield: <b>${formatPercent(enriched.yieldPerDay)}/hr</b> (${formatPercent(
    enriched.yieldTotal
  )} total)`;
}

function updatePortoNavBadge() {
  const pendingCount = portoEntries.filter((e) => !e.isCair).length;
  els.portoNavBadge.textContent = String(pendingCount);
  els.portoNavBadge.hidden = pendingCount === 0;
}

function renderPorto() {
  updatePortoNavBadge();
  const summary = computePortoSummary(portoEntries);

  els.portoActiveCount.textContent = String(summary.activeCount);
  els.portoActiveModal.textContent = formatRupiah(summary.activeModal, state.unitMultiplier);
  els.portoActiveProfit.textContent = formatRupiah(summary.activeProfit, state.unitMultiplier);
  els.portoActiveCair.textContent = formatRupiah(summary.activeTotalCair, state.unitMultiplier);

  els.portoCairCount.textContent = String(summary.cairCount);
  els.portoCairModal.textContent = formatRupiah(summary.cairModal, state.unitMultiplier);
  els.portoCairProfit.textContent = formatRupiah(summary.cairProfit, state.unitMultiplier);
  els.portoCairTotal.textContent = formatRupiah(summary.cairTotal, state.unitMultiplier);

  els.portoTotalCount.textContent = String(summary.totalCount);
  els.portoTotalModal.textContent = formatRupiah(summary.totalModal, state.unitMultiplier);
  els.portoTotalProfit.textContent = formatRupiah(summary.totalProfit, state.unitMultiplier);
  els.portoAvgYield.textContent = `${formatPercent(summary.avgYieldPerDay)}/hr`;

  const enrichedList = portoEntries
    .map(enrichPortoEntry)
    .filter((item) => {
      if (portoFilter === 'pending') return !item.isCair;
      if (portoFilter === 'cair') return item.isCair;
      return true;
    })
    .sort((a, b) => {
      // Pending first, then nearest cairDate; cair items newest cairDate first
      if (a.isCair !== b.isCair) return a.isCair ? 1 : -1;
      if (!a.isCair) return a.cairDate.localeCompare(b.cairDate);
      return b.cairDate.localeCompare(a.cairDate);
    });

  els.portoList.innerHTML = '';
  if (enrichedList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = portoEntries.length === 0
      ? 'Belum ada catatan investasi. Isi form di atas atau klik "+ Catat ke Porto" di Calculator.'
      : 'Tidak ada data untuk filter ini.';
    els.portoList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of enrichedList) {
    const card = document.createElement('div');
    card.className = `porto-item ${item.isCair ? 'is-cair' : ''}`;

    const top = document.createElement('div');
    top.className = 'offer-top';

    const modalEl = document.createElement('span');
    modalEl.className = 'offer-modal';
    modalEl.textContent = formatRupiah(item.modal, state.unitMultiplier);

    const perDayEl = document.createElement('span');
    perDayEl.className = 'offer-perday';
    perDayEl.textContent = `${formatPercent(item.yieldPerDay)}/hr`;

    top.append(modalEl, perDayEl);

    const meta = document.createElement('div');
    meta.className = 'offer-meta';
    const invShort = formatShortDate(normalizeDate(item.investDate));
    const cairShort = formatShortDate(normalizeDate(item.cairDate));
    meta.innerHTML = `
      <span>Untung: <b>${formatRupiah(item.profit, state.unitMultiplier)}</b> (${formatPercent(item.yieldTotal)})</span>
      <span>${invShort} → ${cairShort} (${item.tenor} hr)</span>
      <span>+${formatRupiah(item.profitPerDay, state.unitMultiplier)}/hr</span>
    `;

    const badges = document.createElement('div');
    badges.className = 'offer-badges';
    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${item.isCair ? 'badge-cair' : 'badge-pending'}`;
    statusBadge.textContent = item.isCair ? 'Sudah cair' : 'Masih nunggu';
    badges.appendChild(statusBadge);

    if (item.note) {
      const noteBadge = document.createElement('span');
      noteBadge.className = 'badge badge-taken';
      noteBadge.textContent = item.note;
      badges.appendChild(noteBadge);
    }

    const actions = document.createElement('div');
    actions.className = 'porto-item-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-outline';
    toggleBtn.textContent = item.isCair ? 'Tandai Belum Cair' : 'Tandai Sudah Cair';
    toggleBtn.addEventListener('click', () => {
      portoEntries = portoEntries.map((e) =>
        e.id === item.id ? { ...e, isCair: !e.isCair } : e
      );
      savePorto(portoEntries);
      renderPorto();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-ghost';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      editingPortoId = item.id;
      els.portoInvestDate.value = item.investDate;
      els.portoCairDate.value = item.cairDate;
      els.portoModal.value = String(item.modal);
      els.portoProfit.value = String(item.profit);
      els.portoNote.value = item.note || '';
      els.portoIsCair.checked = item.isCair;
      els.portoSubmitBtn.textContent = 'Update Catatan';
      els.portoCancelEditBtn.hidden = false;
      updatePortoLivePreview();
      els.portoForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger-outline';
    delBtn.textContent = 'Hapus';
    delBtn.addEventListener('click', () => {
      portoEntries = portoEntries.filter((e) => e.id !== item.id);
      savePorto(portoEntries);
      if (editingPortoId === item.id) resetPortoForm();
      renderPorto();
      showToast('Catatan dihapus');
    });

    actions.append(toggleBtn, editBtn, delBtn);
    card.append(top, meta, badges, actions);
    frag.appendChild(card);
  }

  els.portoList.appendChild(frag);
}

// ==================== EVENT LISTENERS ====================

for (const tab of els.navTabs) {
  tab.addEventListener('click', () => {
    switchPage(tab.dataset.page);
  });
}

els.goSettingChip.addEventListener('click', () => {
  switchPage('setting');
});

els.groupInput.addEventListener('input', () => {
  state.rawText = els.groupInput.value;
  handleCalcInputChange();
});

els.uangGue.addEventListener('input', () => {
  state.uangGue = els.uangGue.value;
  handleCalcInputChange();
});

els.saldoBandar.addEventListener('input', () => {
  state.saldoBandar = els.saldoBandar.value;
  handleCalcInputChange();
});

els.myTag.addEventListener('input', () => {
  state.myTag = els.myTag.value;
  handleCalcInputChange();
});

els.todayDate.addEventListener('change', () => {
  state.today = els.todayDate.value || getDeviceTodayISO();
  handleCalcInputChange();
});

els.resetTodayBtn.addEventListener('click', () => {
  state.today = getDeviceTodayISO();
  handleCalcInputChange();
  showToast('Tanggal direset ke hari ini');
});

els.unitSelect.addEventListener('change', () => {
  state.unitMultiplier = Number(els.unitSelect.value) === 1 ? 1 : 1000;
  saveState(state);
  syncInputsFromState();
  renderCalculator();
  renderPorto();
  updatePortoLivePreview();
});

els.modePerDay.addEventListener('click', () => {
  state.mode = 'perDay';
  els.modePerDay.classList.add('active');
  els.modeTotal.classList.remove('active');
  handleCalcInputChange();
});

els.modeTotal.addEventListener('click', () => {
  state.mode = 'total';
  els.modeTotal.classList.add('active');
  els.modePerDay.classList.remove('active');
  handleCalcInputChange();
});

els.recalcBtn.addEventListener('click', () => {
  manualSelectedIds = null;
  renderCalculator();
  showToast('Dihitung ulang optimal');
});

els.pasteBtn.addEventListener('click', async () => {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        state.rawText = text;
        els.groupInput.value = text;
        handleCalcInputChange();
        showToast('Berhasil ditempel');
        return;
      }
    }
  } catch {
    // Fallback to manual focus
  }
  els.groupInput.focus();
  showToast('Tekan & tahan di kotak teks untuk tempel manual');
});

els.clearBtn.addEventListener('click', () => {
  state.rawText = '';
  els.groupInput.value = '';
  handleCalcInputChange();
});

els.copyGroupBtn.addEventListener('click', async () => {
  const myTag = (state.myTag || 'vivi').trim() || 'vivi';
  const reply = buildReplyText(state.rawText, getSelectedLineIndices(), myTag);
  if (!reply) {
    showToast('Belum ada teks untuk disalin');
    return;
  }
  const ok = await copyToClipboard(reply);
  showToast(ok ? 'Tersalin' : 'Gagal menyalin');
});

els.copyMineBtn.addEventListener('click', async () => {
  const myTag = (state.myTag || 'vivi').trim() || 'vivi';
  const mine = buildMyLinesOnly(state.rawText, getSelectedLineIndices(), myTag);
  if (!mine) {
    showToast('Belum ada dapur terpilih');
    return;
  }
  const ok = await copyToClipboard(mine);
  showToast(ok ? 'Tersalin' : 'Gagal menyalin');
});

els.shareWaBtn.addEventListener('click', async () => {
  const myTag = (state.myTag || 'vivi').trim() || 'vivi';
  const reply = buildReplyText(state.rawText, getSelectedLineIndices(), myTag);
  if (!reply) {
    showToast('Belum ada teks untuk dibagikan');
    return;
  }
  const waUrl = `https://wa.me/?text=${encodeURIComponent(reply)}`;
  const win = window.open(waUrl, '_blank', 'noopener');
  if (!win && navigator.share) {
    try {
      await navigator.share({ text: reply });
    } catch {
      // User cancelled share
    }
  }
});

els.saveSelectedToPortoBtn.addEventListener('click', () => {
  const chosen = currentOffers.filter((o) => currentSelectedIds.has(o.id));
  if (chosen.length === 0) {
    showToast('Belum ada dapur terpilih');
    return;
  }
  const investDate = state.today || getDeviceTodayISO();
  for (const o of chosen) {
    portoEntries.push(
      enrichPortoEntry({
        investDate,
        cairDate: o.cairDate,
        modal: o.modal,
        profit: o.profit,
        isCair: false,
        note: 'Dari Calculator',
      })
    );
  }
  savePorto(portoEntries);
  updatePortoNavBadge();
  showToast(`${chosen.length} dapur dicatat ke Porto`);
});

// Porto form events
for (const inp of [els.portoInvestDate, els.portoCairDate, els.portoModal, els.portoProfit]) {
  inp.addEventListener('input', updatePortoLivePreview);
}

els.portoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const modal = Number(els.portoModal.value);
  const profit = Number(els.portoProfit.value);
  if (!(modal > 0)) {
    showToast('Modal harus lebih dari 0');
    return;
  }
  const entry = enrichPortoEntry({
    id: editingPortoId || undefined,
    investDate: els.portoInvestDate.value || getDeviceTodayISO(),
    cairDate: els.portoCairDate.value || els.portoInvestDate.value || getDeviceTodayISO(),
    modal,
    profit: Math.max(0, profit || 0),
    isCair: els.portoIsCair.checked,
    note: els.portoNote.value,
  });

  if (editingPortoId) {
    portoEntries = portoEntries.map((item) => (item.id === editingPortoId ? entry : item));
    showToast('Catatan diperbarui');
  } else {
    portoEntries.push(entry);
    showToast('Disimpan ke Porto');
  }

  savePorto(portoEntries);
  resetPortoForm();
  renderPorto();
});

els.portoCancelEditBtn.addEventListener('click', () => {
  resetPortoForm();
});

for (const pill of els.portoFilterPills) {
  pill.addEventListener('click', () => {
    portoFilter = pill.dataset.filter;
    for (const p of els.portoFilterPills) {
      p.classList.toggle('active', p === pill);
    }
    renderPorto();
  });
}

// Setting backup & reset events
els.exportDataBtn.addEventListener('click', () => {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
    porto: portoEntries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dapur-calc-backup-${getDeviceTodayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup diunduh');
});

els.importDataBtn.addEventListener('click', () => {
  els.importFileInput.click();
});

els.importFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (Array.isArray(parsed.porto)) {
      portoEntries = parsed.porto.map(enrichPortoEntry);
      savePorto(portoEntries);
    }
    if (parsed.state && typeof parsed.state === 'object') {
      Object.assign(state, parsed.state);
      saveState(state);
    }
    syncInputsFromState();
    renderCalculator();
    renderPorto();
    showToast('Backup berhasil di-import');
  } catch {
    showToast('File backup tidak valid');
  } finally {
    els.importFileInput.value = '';
  }
});

els.clearPortoBtn.addEventListener('click', () => {
  if (portoEntries.length === 0) {
    showToast('Porto sudah kosong');
    return;
  }
  if (window.confirm('Yakin hapus semua catatan portofolio?')) {
    portoEntries = [];
    savePorto(portoEntries);
    resetPortoForm();
    renderPorto();
    showToast('Semua catatan Porto dihapus');
  }
});

// PWA Install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  els.installBtn.hidden = false;
});

els.installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installBtn.hidden = true;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  els.installBtn.hidden = true;
});

// Service Worker registration
if ('serviceWorker' in navigator) {
  const registerSW = () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  };
  if (document.readyState === 'complete') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
}

// Initial render
syncInputsFromState();
resetPortoForm();
updatePortoNavBadge();
renderCalculator();
switchPage(state.activePage);
