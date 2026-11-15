import {
  parseGroupMessage,
  buildReplyText,
  buildMyLinesOnly,
  normalizeDate,
  formatISODate,
} from './parser.js';
import { optimizeSelection, computeSummary } from './optimizer.js';

const STORAGE_KEY = 'dapurCalcStateV1';
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
  groupInput: document.getElementById('groupInput'),
  pasteBtn: document.getElementById('pasteBtn'),
  clearBtn: document.getElementById('clearBtn'),
  uangGue: document.getElementById('uangGue'),
  saldoBandar: document.getElementById('saldoBandar'),
  uangGueFmt: document.getElementById('uangGueFmt'),
  saldoBandarFmt: document.getElementById('saldoBandarFmt'),
  unitLabel1: document.getElementById('unitLabel1'),
  unitLabel2: document.getElementById('unitLabel2'),
  myTag: document.getElementById('myTag'),
  todayDate: document.getElementById('todayDate'),
  modePerDay: document.getElementById('modePerDay'),
  modeTotal: document.getElementById('modeTotal'),
  recalcBtn: document.getElementById('recalcBtn'),
  statusBanner: document.getElementById('statusBanner'),
  offersCount: document.getElementById('offersCount'),
  offersList: document.getElementById('offersList'),
  replyPreview: document.getElementById('replyPreview'),
  copyGroupBtn: document.getElementById('copyGroupBtn'),
  shareWaBtn: document.getElementById('shareWaBtn'),
  copyMineBtn: document.getElementById('copyMineBtn'),
  summaryTopup: document.getElementById('summaryTopup'),
  summaryModal: document.getElementById('summaryModal'),
  summaryProfitDay: document.getElementById('summaryProfitDay'),
  summaryProfitTotal: document.getElementById('summaryProfitTotal'),
  summarySisa: document.getElementById('summarySisa'),
  installBtn: document.getElementById('installBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  unitSelect: document.getElementById('unitSelect'),
  toast: document.getElementById('toast'),
};

const state = loadState();
let manualSelectedIds = null; // null = auto-optimized; Set<string> = manual override
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

function render() {
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
    // Keep only valid available IDs from manual override
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
      render();
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
    meta.innerHTML = '';
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

function handleInputChange() {
  manualSelectedIds = null;
  saveState(state);
  updateMoneyHints();
  render();
}

// Event listeners
els.groupInput.addEventListener('input', () => {
  state.rawText = els.groupInput.value;
  handleInputChange();
});

els.uangGue.addEventListener('input', () => {
  state.uangGue = els.uangGue.value;
  handleInputChange();
});

els.saldoBandar.addEventListener('input', () => {
  state.saldoBandar = els.saldoBandar.value;
  handleInputChange();
});

els.myTag.addEventListener('input', () => {
  state.myTag = els.myTag.value;
  handleInputChange();
});

els.todayDate.addEventListener('change', () => {
  state.today = els.todayDate.value || getDeviceTodayISO();
  handleInputChange();
});

els.modePerDay.addEventListener('click', () => {
  state.mode = 'perDay';
  els.modePerDay.classList.add('active');
  els.modeTotal.classList.remove('active');
  handleInputChange();
});

els.modeTotal.addEventListener('click', () => {
  state.mode = 'total';
  els.modeTotal.classList.add('active');
  els.modePerDay.classList.remove('active');
  handleInputChange();
});

els.recalcBtn.addEventListener('click', () => {
  manualSelectedIds = null;
  render();
  showToast('Dihitung ulang optimal');
});

els.pasteBtn.addEventListener('click', async () => {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        state.rawText = text;
        els.groupInput.value = text;
        handleInputChange();
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
  handleInputChange();
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

// Settings dialog
els.settingsBtn.addEventListener('click', () => {
  els.settingsDialog.showModal();
});

els.closeSettingsBtn.addEventListener('click', () => {
  els.settingsDialog.close();
});

els.settingsDialog.addEventListener('click', (e) => {
  if (e.target === els.settingsDialog) {
    els.settingsDialog.close();
  }
});

els.unitSelect.addEventListener('change', () => {
  state.unitMultiplier = Number(els.unitSelect.value) === 1 ? 1 : 1000;
  saveState(state);
  syncInputsFromState();
  render();
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
render();
