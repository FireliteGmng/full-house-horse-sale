'use strict';

// ─── STATE ───────────────────────────────────────────────────────────────────
let currentSaleId = null;
let currentSale = null;
let animals = [];
let buyers = [];
let saleState = null;
let timerInterval = null;
let timerSeconds = 0;
const socket = io({
  transports: ['polling', 'websocket'],
  upgrade: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});
socket.on('connect', () => { socket.emit('join', 'clerk'); });

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('/clerk/api/check', { credentials: 'include' });
  const data = await res.json();
  if (data.isAdmin) {
    showScreen('dashboard-screen');
    loadDashboard();
  }
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
function submitLogin(e) {
  if (e) e.preventDefault();
  const pw = document.getElementById('login-pw').value;
  fetch('/clerk/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ password: pw })
  }).then(r => r.json()).then(data => {
    if (data.ok || !data.error) {
      showScreen('dashboard-screen');
      loadDashboard();
    } else {
      const err = document.getElementById('login-error');
      err.textContent = data.error || 'Wrong password';
      err.classList.remove('hidden');
    }
  });
}

function doLogout() {
  fetch('/clerk/api/logout', { method: 'POST', credentials: 'include' }).then(() => {
    showScreen('login-screen');
  });
}

// ─── SCREEN NAVIGATION ───────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function backToDashboard() {
  if (timerInterval) clearInterval(timerInterval);
  showScreen('dashboard-screen');
  loadDashboard();
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function loadDashboard() {
  await loadYoutubeUrl();
  await loadStreamDisplayState();
  await loadSales();
  await loadBuyers();
  await loadRoster();
  await loadNewsletters();
  await loadBuyerMessage();
}

async function loadSales() {
  const res = await fetch('/clerk/api/sales', { credentials: 'include' });
  const sales = await res.json();
  const list = document.getElementById('sales-list');
  if (!sales.length) {
    list.innerHTML = '<div class="list-empty">No sales yet. Create one to get started.</div>';
    return;
  }
  list.innerHTML = sales.map(s => {
    const badge = s.status === 'live' ? '<span class="badge badge-live">LIVE</span>' :
                  s.status === 'ended' ? '<span class="badge badge-ended">Ended</span>' :
                  '<span class="badge badge-draft">Draft</span>';
    return `<div class="sale-item" onclick="openSale(${s.id})">
      <div class="sale-item-info">
        <span class="sale-item-name">${esc(s.name || 'Untitled Sale')}</span>
        <span class="sale-item-date">${s.sale_date || 'No date set'} ${badge}</span>
      </div>
      <div class="sale-item-actions">
        ${s.status === 'ended' ? '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();viewResults('+s.id+')">Results</button>' : ''}
        ${s.status === 'ended' ? '<button class="btn btn-success btn-sm" onclick="event.stopPropagation();continueSale('+s.id+')">Continue</button>' : ''}
        ${s.status === 'draft' ? '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();deleteSale('+s.id+')">Delete</button>' : ''}
      </div>
    </div>`;
  }).join('');
}

async function loadBuyers() {
  const res = await fetch('/clerk/api/buyers', { credentials: 'include' });
  buyers = await res.json();
  renderBuyers('pending');
  const pending = buyers.filter(b => b.status === 'pending').length;
  document.getElementById('pending-count').textContent = pending + ' pending';
}
// ─── YOUTUBE URL (GLOBAL SETTING) ────────────────────────────────────────────
async function loadYoutubeUrl() {
  const res = await fetch('/clerk/api/settings/youtube', { credentials: 'include' });
  const data = await res.json();
  const input = document.getElementById('global-youtube-url');
  if (input) input.value = data.youtube_url || '';
  updateYoutubePreview(data.youtube_url || '');
}
async function saveYoutubeUrl() {
  const url = document.getElementById('global-youtube-url').value || '';
  await fetch('/clerk/api/settings/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ youtube_url: url })
  });
  updateYoutubePreview(url);
}
function updateYoutubePreview(url) {
  const preview = document.getElementById('youtube-preview');
  const iframe = document.getElementById('youtube-preview-iframe');
  if (!preview || !iframe) return;
  if (!url) { preview.classList.add('hidden'); return; }
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) {
    iframe.src = 'https://www.youtube.com/embed/' + m[1] + '?autoplay=0&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3';
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
  }
}

// ─── STREAM DISPLAY TOGGLE ───────────────────────────────────────────────────
let streamDisplayEnabled = false;

async function loadStreamDisplayState() {
  try {
    const res = await fetch('/clerk/api/settings/stream-display', { credentials: 'include' });
    const data = await res.json();
    streamDisplayEnabled = data.stream_display_enabled;
    updateStreamToggleUI();
  } catch (e) {}
}

async function toggleStreamDisplay() {
  streamDisplayEnabled = !streamDisplayEnabled;
  await fetch('/clerk/api/settings/stream-display', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled: streamDisplayEnabled })
  });
  updateStreamToggleUI();
}

function updateStreamToggleUI() {
  const btn = document.getElementById('stream-display-toggle');
  const label = document.getElementById('stream-toggle-label');
  const icon = document.getElementById('stream-toggle-icon');
  if (!btn) return;
  if (streamDisplayEnabled) {
    label.textContent = 'ON';
    btn.classList.add('toggle-on');
    btn.classList.remove('toggle-off');
  } else {
    label.textContent = 'OFF';
    btn.classList.remove('toggle-on');
    btn.classList.add('toggle-off');
  }
}


function showBuyerTab(tab, btn) {
  btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderBuyers(tab);
}

function renderBuyers(filter) {
  const list = document.getElementById('buyers-list');
  let filtered = buyers;
  if (filter === 'pending') filtered = buyers.filter(b => b.status === 'pending');
  else if (filter === 'approved') filtered = buyers.filter(b => b.status === 'approved');

  if (!filtered.length) {
    list.innerHTML = '<div class="list-empty">No buyers in this category.</div>';
    return;
  }
  list.innerHTML = filtered.map(b => `
    <div class="buyer-item">
      <div class="buyer-item-info">
        <span class="buyer-item-name clickable-buyer" onclick="openBuyerDetailById(${b.id})">${esc(b.full_name)}</span>
        <span class="buyer-item-detail">${esc(b.email || '')} ${b.buyer_number ? '• #' + b.buyer_number : ''}</span>
      </div>
      <div class="buyer-item-actions">
        ${b.status === 'pending' ? `
          <button class="btn btn-success btn-sm" onclick="approveBuyer(${b.id})">Approve</button>
          <button class="btn btn-outline btn-sm" onclick="denyBuyer(${b.id})">Deny</button>
        ` : `<span class="badge ${b.status === 'approved' ? 'badge-sold' : 'badge-skipped'}">${b.status}</span>`}
      </div>
    </div>
  `).join('');
}

async function approveBuyer(id) {
  await fetch(`/clerk/api/buyers/${id}/approve`, { method: 'POST', credentials: 'include' });
  await loadBuyers();
}

async function denyBuyer(id) {
  await fetch(`/clerk/api/buyers/${id}/deny`, { method: 'POST', credentials: 'include' });
  await loadBuyers();
}

// ─── SALES CRUD ──────────────────────────────────────────────────────────────
async function createNewSale() {
  const res = await fetch('/clerk/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: 'New Sale' })
  });
  const sale = await res.json();
  openSale(sale.id);
}

async function deleteSale(id) {
  if (!confirm('Delete this sale and all its horses?')) return;
  await fetch(`/clerk/api/sales/${id}`, { method: 'DELETE', credentials: 'include' });
  await loadSales();
}

async function openSale(id) {
  currentSaleId = id;
  const res = await fetch('/clerk/api/sales', { credentials: 'include' });
  const sales = await res.json();
  currentSale = sales.find(s => s.id === id);
  
  if (!currentSale) return;

  // If sale is live, go to live screen
  if (currentSale.status === 'live') {
    enterLiveSale();
    return;
  }
  
  // If sale is ended, show results
  if (currentSale.status === 'ended') {
    viewResults(id);
    return;
  }

  // Draft - show editor
  showScreen('sale-editor-screen');
  document.getElementById('sale-editor-title').textContent = currentSale.name || 'Create Sale';
  document.getElementById('sale-name').value = currentSale.name || '';
  document.getElementById('sale-date').value = currentSale.sale_date || '';
  
  const badge = document.getElementById('sale-status-badge');
  badge.textContent = 'Draft';
  badge.className = 'badge badge-draft';
  
  await loadAnimals();
}

async function autoSaveSale() {
  if (!currentSaleId) return;
  const data = {
    name: document.getElementById('sale-name').value || 'Untitled Sale',
    sale_date: document.getElementById('sale-date').value || null
  };
  await fetch(`/clerk/api/sales/${currentSaleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  document.getElementById('sale-editor-title').textContent = data.name;
}

// ─── ANIMALS ─────────────────────────────────────────────────────────────────
async function loadAnimals() {
  const res = await fetch(`/clerk/api/animals?sale_id=${currentSaleId}`, { credentials: 'include' });
  animals = await res.json();
  renderAnimals();
}

function renderAnimals() {
  const list = document.getElementById('animal-list');
  const empty = document.getElementById('animal-empty');
  
  if (!animals.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  
  list.innerHTML = animals.map((a, i) => `
    <div class="animal-item" data-id="${a.id}">
      <span class="drag-handle">&#x2807;</span>
      ${a.photo_path ? `<img class="animal-item-photo" src="${a.photo_path}">` : '<div class="animal-item-photo"></div>'}
      <div class="animal-item-info">
        <span class="animal-item-name">${esc(a.name)}</span>
        <span class="animal-item-meta">${[a.breed, a.age, a.sex].filter(Boolean).join(' &bull; ') || 'No details'} &bull; $${fmt(a.starting_price||0)}</span>
      </div>
      <div class="animal-item-actions">
        <button class="btn btn-outline btn-sm" onclick="editAnimal(${a.id})">Edit</button>
        <button class="btn btn-outline btn-sm" onclick="deleteAnimal(${a.id})">&times;</button>
      </div>
    </div>
  `).join('');
  
  initDragReorder();
}

function openAddAnimal() {
  document.getElementById('animal-modal-title').textContent = 'Add Horse';
  document.getElementById('animal-id').value = '';
  document.getElementById('animal-name').value = '';
  document.getElementById('animal-age').value = '';
  document.getElementById('animal-sex').value = '';
  document.getElementById('animal-breed').value = '';
  document.getElementById('animal-start').value = '0';
  document.getElementById('animal-desc').value = '';
  document.getElementById('animal-photo').value = '';
  const preview = document.getElementById('animal-photo-preview');
  preview.classList.add('hidden');
  preview.innerHTML = '';
  document.getElementById('animal-modal').classList.add('open');
}

function editAnimal(id) {
  const a = animals.find(x => x.id === id);
  if (!a) return;
  document.getElementById('animal-modal-title').textContent = 'Edit Horse';
  document.getElementById('animal-id').value = a.id;
  document.getElementById('animal-name').value = a.name || '';
  document.getElementById('animal-age').value = a.age || '';
  document.getElementById('animal-sex').value = a.sex || '';
  document.getElementById('animal-breed').value = a.breed || '';
  document.getElementById('animal-start').value = a.starting_price || 0;
  document.getElementById('animal-desc').value = a.description || '';
  document.getElementById('animal-photo').value = '';
  
  const preview = document.getElementById('animal-photo-preview');
  if (a.photo_path) {
    preview.innerHTML = `<img src="${a.photo_path}">`;
    preview.classList.remove('hidden');
  } else {
    preview.innerHTML = '';
    preview.classList.add('hidden');
  }
  
  document.getElementById('animal-modal').classList.add('open');
}

function closeAnimalModal() {
  document.getElementById('animal-modal').classList.remove('open');
}

async function saveAnimal(e) {
  if (e) e.preventDefault();
  const id = document.getElementById('animal-id').value;
  const formData = new FormData();
  formData.append('name', document.getElementById('animal-name').value);
  formData.append('age', document.getElementById('animal-age').value);
  formData.append('sex', document.getElementById('animal-sex').value);
  formData.append('breed', document.getElementById('animal-breed').value);
  formData.append('starting_price', document.getElementById('animal-start').value || '0');
  formData.append('description', document.getElementById('animal-desc').value);
  formData.append('sale_id', currentSaleId);
  
  const photoFile = document.getElementById('animal-photo').files[0];
  if (photoFile) formData.append('photo', photoFile);
  
  const url = id ? `/clerk/api/animals/${id}` : '/clerk/api/animals';
  const method = id ? 'PUT' : 'POST';
  
  await fetch(url, { method, credentials: 'include', body: formData });
  closeAnimalModal();
  await loadAnimals();
}

async function deleteAnimal(id) {
  if (!confirm('Delete this horse?')) return;
  await fetch(`/clerk/api/animals/${id}`, { method: 'DELETE', credentials: 'include' });
  await loadAnimals();
}

// ─── DRAG REORDER ────────────────────────────────────────────────────────────
let dragState = null;

function initDragReorder() {
  const list = document.getElementById('animal-list');
  if (!list) return;
  const handles = list.querySelectorAll('.drag-handle');
  
  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => { e.preventDefault(); });
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDrag(handle.closest('.animal-item'), e);
    });
    handle.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startDrag(handle.closest('.animal-item'), e.touches[0]);
    }, { passive: false });
  });
}

function startDrag(item, e) {
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';
  document.addEventListener('selectstart', preventSelect);
  
  const list = document.getElementById('animal-list');
  const items = Array.from(list.querySelectorAll('.animal-item'));
  const index = items.indexOf(item);
  const rect = item.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const itemRects = items.map(el => el.getBoundingClientRect());
  const itemHeight = rect.height;
  const gap = items.length > 1 ? itemRects[1].top - itemRects[0].bottom : 4;
  const slotHeight = itemHeight + gap;
  
  const spacer = document.createElement('div');
  spacer.style.height = itemHeight + 'px';
  spacer.style.flexShrink = '0';
  
  item.style.width = rect.width + 'px';
  item.style.height = itemHeight + 'px';
  item.style.position = 'fixed';
  item.style.left = rect.left + 'px';
  item.style.top = rect.top + 'px';
  item.style.zIndex = '1000';
  item.style.pointerEvents = 'none';
  item.style.transition = 'none';
  item.classList.add('dragging');
  
  list.insertBefore(spacer, item.nextSibling);
  
  const others = items.filter(el => el !== item);
  
  dragState = {
    item, spacer, list, startIndex: index, currentIndex: index,
    startY: e.clientY || e.pageY, itemTop: rect.top,
    itemHeight, slotHeight, gap, others, totalItems: items.length
  };
  
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onDragEnd);
}

function preventSelect(e) { e.preventDefault(); }

function onTouchMove(e) {
  e.preventDefault();
  if (!dragState) return;
  moveDrag(e.touches[0].clientY || e.touches[0].pageY);
}

function onDragMove(e) {
  if (!dragState) return;
  moveDrag(e.clientY);
}

function moveDrag(clientY) {
  const ds = dragState;
  const dy = clientY - ds.startY;
  ds.item.style.top = (ds.itemTop + dy) + 'px';
  
  const slotsOffset = Math.round(dy / ds.slotHeight);
  let newIndex = Math.max(0, Math.min(ds.startIndex + slotsOffset, ds.totalItems - 1));
  
  ds.others.forEach((el, i) => {
    const origIndex = i < ds.startIndex ? i : i + 1;
    let shift = 0;
    if (newIndex > ds.startIndex) {
      if (origIndex > ds.startIndex && origIndex <= newIndex) shift = -ds.slotHeight;
    } else if (newIndex < ds.startIndex) {
      if (origIndex >= newIndex && origIndex < ds.startIndex) shift = ds.slotHeight;
    }
    el.style.transition = 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)';
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
  
  ds.currentIndex = newIndex;
}

let pendingReorder = null;

function onDragEnd() {
  if (!dragState) return;
  const ds = dragState;
  
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onDragEnd);
  document.removeEventListener('selectstart', preventSelect);
  document.body.style.userSelect = '';
  document.body.style.webkitUserSelect = '';
  window.getSelection().removeAllRanges();
  
  const fromIndex = ds.startIndex;
  const toIndex = ds.currentIndex;
  
  const targetTop = ds.itemTop + (toIndex - fromIndex) * ds.slotHeight;
  ds.item.style.transition = 'top 0.25s cubic-bezier(0.2, 0, 0, 1)';
  ds.item.style.top = targetTop + 'px';
  
  setTimeout(() => {
    if (fromIndex !== toIndex) {
      // Store pending reorder and show confirmation
      pendingReorder = { ds, fromIndex, toIndex };
      const horseName = animals[fromIndex] ? animals[fromIndex].name : 'this horse';
      document.getElementById('reorder-msg').textContent = `Do you want to put "${horseName}" in position ${toIndex + 1}?`;
      document.getElementById('reorder-modal').classList.add('open');
    } else {
      // No movement - just clean up
      cleanupDrag(ds);
    }
  }, 280);
}

function cleanupDrag(ds) {
  ds.item.style.position = '';
  ds.item.style.left = '';
  ds.item.style.top = '';
  ds.item.style.width = '';
  ds.item.style.height = '';
  ds.item.style.zIndex = '';
  ds.item.style.pointerEvents = '';
  ds.item.style.transition = '';
  ds.item.classList.remove('dragging');
  ds.others.forEach(el => { el.style.transition = ''; el.style.transform = ''; });
  ds.spacer.remove();
  dragState = null;
}

function confirmReorder() {
  document.getElementById('reorder-modal').classList.remove('open');
  if (!pendingReorder) return;
  const { ds, fromIndex, toIndex } = pendingReorder;
  pendingReorder = null;
  
  cleanupDrag(ds);
  
  const moved = animals.splice(fromIndex, 1)[0];
  animals.splice(toIndex, 0, moved);
  renderAnimals();
  fetch('/clerk/api/animals/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ids: animals.map(a => a.id) })
  });
}

function cancelReorder() {
  document.getElementById('reorder-modal').classList.remove('open');
  if (!pendingReorder) return;
  const { ds } = pendingReorder;
  pendingReorder = null;
  
  // Snap back to original position
  cleanupDrag(ds);
  renderAnimals();
}

// ─── GO LIVE ─────────────────────────────────────────────────────────────────
function openGoLiveModal() {
  document.getElementById('golive-modal').classList.add('open');
}

function closeGoLiveModal() {
  document.getElementById('golive-modal').classList.remove('open');
}





async function goLive() {
  if (!currentSaleId) return;
  const preset = document.getElementById('golive-preset').value;
  
  const res = await fetch(`/clerk/api/sales/${currentSaleId}/golive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ preset })
  });
  const data = await res.json();
  if (data.ok) {
    closeGoLiveModal();
    enterLiveSale();
  } else {
    alert(data.error || 'Failed to go live');
  }
}

// ─── LIVE SALE ───────────────────────────────────────────────────────────────
async function enterLiveSale() {
  showScreen('live-sale-screen');
  startTimer();
  await loadLiveState();
  await loadLiveLineup();
}

function startTimer() {
  timerSeconds = 0;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSeconds++;
    const h = String(Math.floor(timerSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    document.getElementById('sale-timer').textContent = `${h}:${m}:${s}`;
  }, 1000);
}

async function loadLiveState() {
  const res = await fetch('/clerk/api/state', { credentials: 'include' });
  saleState = await res.json();
  updateLiveDisplay();
  refreshAuditTrail();
}

async function loadLiveLineup() {
  const res = await fetch(`/clerk/api/animals?sale_id=${currentSaleId}`, { credentials: 'include' });
  animals = await res.json();
  renderLiveLineup();
}

function updateLiveDisplay() {
  const waiting = document.getElementById('live-waiting');
  const display = document.getElementById('live-animal-display');
  
  if (!saleState || !saleState.current_animal) {
    waiting.classList.remove('hidden');
    display.classList.add('hidden');
    document.getElementById('btn-inperson').style.display = 'none';
    document.getElementById('btn-rollback').style.display = 'none';
    document.getElementById('btn-mark-sold').style.display = 'none';
    document.getElementById('btn-skip').style.display = 'none';
    document.getElementById('btn-next-animal').style.display = '';
    document.getElementById('btn-next-animal').disabled = false;
    document.getElementById('btn-next-animal').textContent = 'Start First Horse →';
    document.getElementById('increment-inline-edit').style.display = 'none';
    return;
  }
  
  waiting.classList.add('hidden');
  display.classList.remove('hidden');
  
  const a = saleState.current_animal;
  document.getElementById('live-animal-name').textContent = a.name;
  document.getElementById('live-animal-breed').textContent = a.breed || '';
  document.getElementById('live-animal-age').textContent = a.age || '';
  document.getElementById('live-animal-sex').textContent = a.sex || '';
  document.getElementById('live-animal-desc').textContent = a.description || '';
  
  const photoDiv = document.getElementById('live-photo');
  if (a.photo_path) {
    photoDiv.innerHTML = `<img src="${a.photo_path}">`;
  } else {
    photoDiv.innerHTML = '';
  }
  
  document.getElementById('live-current-bid').textContent = '$' + fmt(saleState.current_bid || a.starting_price || 0);
  
  // High bidder - make clickable if it's an online bidder
  const highBidderEl = document.getElementById('live-high-bidder');
  if (saleState.current_bidder_id) {
    highBidderEl.textContent = saleState.current_bidder_name || (saleState.current_bidder_number ? '#' + saleState.current_bidder_number : '—');
    highBidderEl.classList.add('clickable');
    highBidderEl.onclick = () => openBuyerDetailById(saleState.current_bidder_id);
  } else if (saleState.current_bidder_name) {
    highBidderEl.textContent = saleState.current_bidder_name;
    highBidderEl.classList.remove('clickable');
    highBidderEl.onclick = null;
  } else {
    highBidderEl.textContent = '—';
    highBidderEl.classList.remove('clickable');
    highBidderEl.onclick = null;
  }
  
  document.getElementById('live-increment').textContent = (a && a.increment) ? '$' + fmt(a.increment) : (saleState.increment ? '$' + fmt(saleState.increment) : '—');
  
  // Button states
  const isSoldOrWaiting = saleState.status === 'sold' || saleState.status === 'waiting' || (saleState.current_animal && (saleState.current_animal.status === 'sold' || saleState.current_animal.status === 'skipped'));
  document.getElementById('btn-inperson').style.display = isSoldOrWaiting ? 'none' : '';
  document.getElementById('btn-rollback').style.display = isSoldOrWaiting ? 'none' : '';
  document.getElementById('btn-mark-sold').style.display = isSoldOrWaiting ? 'none' : '';
  document.getElementById('btn-skip').style.display = isSoldOrWaiting ? 'none' : '';
  document.getElementById('increment-inline-edit').style.display = isSoldOrWaiting ? 'none' : 'inline-flex';
  document.getElementById('btn-next-animal').style.display = '';
  document.getElementById('btn-next-animal').textContent = 'Next Animal →';
  document.getElementById('btn-next-animal').disabled = !isSoldOrWaiting;
}

function renderLiveLineup() {
  const list = document.getElementById('live-lineup-list');
  list.innerHTML = animals.map((a, i) => {
    let cls = '';
    if (saleState && saleState.current_animal_id === a.id) cls = 'current';
    else if (a.status === 'sold') cls = 'sold';
    else if (a.status === 'skipped') cls = 'skipped';
    
    let badge = '';
    if (a.status === 'sold') badge = '<span class="badge badge-sold lineup-item-badge">Sold</span>';
    else if (a.status === 'skipped') badge = '<span class="badge badge-skipped lineup-item-badge">Skip</span>';
    else if (saleState && saleState.current_animal_id === a.id) badge = '<span class="badge badge-live lineup-item-badge">Now</span>';
    
    return `<div class="lineup-item ${cls}" onclick="goBackToAnimal(${a.id})">
      <span class="lineup-item-num">${i + 1}</span>
      <span class="lineup-item-name">${esc(a.name)}</span>
      ${badge}
    </div>`;
  }).join('');
}

// ─── LIVE ACTIONS ────────────────────────────────────────────────────────────
async function clerkInPersonBid() {
  const btn = document.getElementById('btn-inperson');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Processing...';
  const res = await fetch('/clerk/api/auction/inperson', { method: 'POST', credentials: 'include' });
  const data = await res.json();
  if (data.ok) {
    await loadLiveState();
    refreshAuditTrail();
  }
  btn.disabled = false;
  btn.textContent = 'In-Person Bid +';
}

// ─── ROLLBACK BID ───────────────────────────────────────────────────────────
async function clerkRollbackBid() {
  const btn = document.getElementById('btn-rollback');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Rolling back...';
  try {
    const res = await fetch('/clerk/api/auction/rollback', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (data.ok) {
      saleState = data.state;
      updateLiveDisplay();
      refreshAuditTrail();
    } else {
      alert(data.error || 'Cannot rollback.');
    }
  } catch(e) {
    alert('Error rolling back bid.');
  }
  btn.disabled = false;
  btn.textContent = '\u2193 Rollback';
}

// ─── BID AUDIT TRAIL ────────────────────────────────────────────────────────
async function refreshAuditTrail() {
  if (!saleState || !saleState.current_animal_id) return;
  try {
    const res = await fetch(`/clerk/api/auction/bids/${saleState.current_animal_id}`, { credentials: 'include' });
    const bids = await res.json();
    renderAuditTrail(bids);
  } catch(e) {
    console.error('Failed to load audit trail', e);
  }
}

function renderAuditTrail(bids) {
  const list = document.getElementById('audit-trail-list');
  if (!bids || !bids.length) {
    list.innerHTML = '<div class="list-empty" style="padding:0.75rem;font-size:0.8rem;">No bids yet for this horse.</div>';
    return;
  }
  list.innerHTML = bids.map((b, i) => {
    const typeClass = b.bid_type === 'online' ? 'online' : 'inperson';
    const typeLabel = b.bid_type === 'online' ? 'Online' : 'In-Person';
    const bidderDisplay = b.bid_type === 'online' && b.buyer_number
      ? `<span class="clickable-buyer" onclick="openBuyerDetailByNumber('${b.buyer_number}')">${esc(b.full_name || '')} #${b.buyer_number}</span>`
      : (b.bid_type === 'inperson' ? 'Floor Bidder' : (b.full_name || 'Unknown'));
    const time = b.created_at ? new Date(b.created_at + 'Z').toLocaleTimeString() : '';
    return `<div class="audit-trail-item">
      <span class="audit-num">${i + 1}</span>
      <span class="audit-amount">$${fmt(b.amount)}</span>
      <span class="audit-type ${typeClass}">${typeLabel}</span>
      <span class="audit-bidder">${bidderDisplay}</span>
      <span class="audit-time">${time}</span>
    </div>`;
  }).join('');
}

// ─── BUYER DETAIL MODAL ─────────────────────────────────────────────────────
async function openBuyerDetailById(buyerId) {
  document.getElementById('buyer-detail-modal').classList.add('open');
  document.getElementById('buyer-detail-content').innerHTML = '<p>Loading...</p>';
  try {
    const res = await fetch(`/clerk/api/buyers/${buyerId}/details`, { credentials: 'include' });
    if (!res.ok) { document.getElementById('buyer-detail-content').innerHTML = '<p>Buyer not found.</p>'; return; }
    const buyer = await res.json();
    renderBuyerDetail(buyer);
  } catch(e) {
    document.getElementById('buyer-detail-content').innerHTML = '<p>Error loading buyer details.</p>';
  }
}

async function openBuyerDetailByNumber(number) {
  document.getElementById('buyer-detail-modal').classList.add('open');
  document.getElementById('buyer-detail-content').innerHTML = '<p>Loading...</p>';
  try {
    const res = await fetch(`/clerk/api/buyers/number/${number}`, { credentials: 'include' });
    if (!res.ok) { document.getElementById('buyer-detail-content').innerHTML = '<p>Buyer not found.</p>'; return; }
    const buyer = await res.json();
    renderBuyerDetail(buyer);
  } catch(e) {
    document.getElementById('buyer-detail-content').innerHTML = '<p>Error loading buyer details.</p>';
  }
}

function renderBuyerDetail(buyer) {
  document.getElementById('buyer-detail-content').innerHTML = `
    <div class="buyer-detail-grid">
      <div class="buyer-detail-field"><label>Buyer Number</label><span>${buyer.buyer_number || 'Not assigned'}</span></div>
      <div class="buyer-detail-field"><label>Status</label><span>${buyer.status || 'N/A'}</span></div>
      <div class="buyer-detail-field full-width"><label>Full Name</label><span>${esc(buyer.full_name || 'N/A')}</span></div>
      <div class="buyer-detail-field"><label>Email</label><span>${esc(buyer.email || 'N/A')}</span></div>
      <div class="buyer-detail-field"><label>Phone</label><span>${esc(buyer.phone || 'N/A')}</span></div>
      <div class="buyer-detail-field full-width"><label>Address</label><span>${esc(buyer.address || 'N/A')}</span></div>
      <div class="buyer-detail-field"><label>Bank Name</label><span>${esc(buyer.bank_name || 'N/A')}</span></div>
      <div class="buyer-detail-field"><label>Bank Phone</label><span>${esc(buyer.bank_phone || 'N/A')}</span></div>
      <div class="buyer-detail-field full-width"><label>Loan Officer</label><span>${esc(buyer.loan_officer || 'N/A')}</span></div>
      <div class="buyer-detail-field"><label>Registered</label><span>${buyer.created_at || 'N/A'}</span></div>
    </div>
  `;
}

function closeBuyerDetailModal() {
  document.getElementById('buyer-detail-modal').classList.remove('open');
}

// ─── INLINE INCREMENT EDIT ──────────────────────────────────────────────────
async function applyInlineIncrement() {
  const input = document.getElementById('inline-increment-input');
  const val = parseFloat(input.value);
  if (!val || val <= 0) { alert('Enter a valid increment amount.'); return; }
  try {
    const res = await fetch('/clerk/api/auction/set-increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ increment: val })
    });
    const data = await res.json();
    if (data.ok) {
      saleState = data.state;
      updateLiveDisplay();
      input.value = '';
    } else {
      alert(data.error || 'Failed to change increment.');
    }
  } catch(e) {
    alert('Error changing increment.');
  }
}

function openSoldModal() {
  document.getElementById('sold-options').classList.remove('hidden');
  document.getElementById('inperson-form').classList.add('hidden');
  document.getElementById('sold-modal-cancel').classList.remove('hidden');
  document.getElementById('sold-modal').classList.add('open');
}

function closeSoldModal() {
  document.getElementById('sold-modal').classList.remove('open');
}

function showInPersonForm() {
  document.getElementById('sold-options').classList.add('hidden');
  document.getElementById('inperson-form').classList.remove('hidden');
  document.getElementById('sold-modal-cancel').classList.add('hidden');
  document.getElementById('sold-buyer-name').value = '';
  document.getElementById('sold-buyer-number').value = '';
}

function hideInPersonForm() {
  document.getElementById('sold-options').classList.remove('hidden');
  document.getElementById('inperson-form').classList.add('hidden');
  document.getElementById('sold-modal-cancel').classList.remove('hidden');
}

async function soldOnline() {
  const res = await fetch('/clerk/api/auction/sold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sold_type: 'online' })
  });
  const data = await res.json();
  if (data.ok) {
    closeSoldModal();
    await loadLiveState();
    await loadLiveLineup();
  }
}

async function soldInPerson() {
  const name = document.getElementById('sold-buyer-name').value;
  const number = document.getElementById('sold-buyer-number').value;
  if (!number) { alert('Please enter a bidder number'); return; }
  
  const res = await fetch('/clerk/api/auction/sold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sold_type: 'inperson', buyer_name: name, buyer_number: number })
  });
  const data = await res.json();
  if (data.ok) {
    closeSoldModal();
    await loadLiveState();
    await loadLiveLineup();
  }
}

function confirmSkip() {
  document.getElementById('skip-modal').classList.add('open');
}

function closeSkipModal() {
  document.getElementById('skip-modal').classList.remove('open');
}

async function doSkip() {
  const res = await fetch('/clerk/api/auction/skip', { method: 'POST', credentials: 'include' });
  const data = await res.json();
  if (data.ok) {
    closeSkipModal();
    await loadLiveState();
    await loadLiveLineup();
  }
}

function openIncrementModal() {
  document.getElementById('increment-input').value = '';
  document.getElementById('increment-input').style.display = 'none';
  document.getElementById('starting-price-input').value = '';
  document.querySelectorAll('.increment-preset-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('increment-modal').classList.add('open');
}
function selectIncrementPreset(value, btn) {
  document.querySelectorAll('.increment-preset-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  if (value === 'other') {
    document.getElementById('increment-input').style.display = 'block';
    document.getElementById('increment-input').value = '';
    document.getElementById('increment-input').focus();
  } else {
    document.getElementById('increment-input').style.display = 'none';
    document.getElementById('increment-input').value = value;
  }
}

function closeIncrementModal() {
  document.getElementById('increment-modal').classList.remove('open');
}

async function moveToNextAnimal() {
  const increment = document.getElementById('increment-input').value;
  if (!increment || parseFloat(increment) <= 0) { alert('Please select or enter a price increment'); return; }
  const startingPrice = document.getElementById('starting-price-input').value;
  const body = { increment: parseFloat(increment) };
  if (startingPrice && parseFloat(startingPrice) > 0) body.starting_price = parseFloat(startingPrice);
  const res = await fetch('/clerk/api/auction/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.ok) {
    closeIncrementModal();
    await loadLiveState();
    await loadLiveLineup();
  } else if (data.error) {
    closeIncrementModal();
    alert(data.error);
  }
}

async function goBackToAnimal(animalId) {
  if (!saleState || saleState.current_animal_id === animalId) return;
  if (!confirm('Go back to this horse? Its previous sold/skipped status will be reset.')) return;
  
  const res = await fetch('/clerk/api/auction/goback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ animal_id: animalId })
  });
  const data = await res.json();
  if (data.ok) {
    await loadLiveState();
    await loadLiveLineup();
  }
}

// ─── END SALE ────────────────────────────────────────────────────────────────
function confirmEndSale() {
  document.getElementById('endsale-modal').classList.add('open');
}

function closeEndSaleModal() {
  document.getElementById('endsale-modal').classList.remove('open');
}

async function doEndSale() {
  if (!currentSaleId) return;
  const res = await fetch(`/clerk/api/sales/${currentSaleId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ timer_seconds: timerSeconds })
  });
  const data = await res.json();
  if (data.ok) {
    if (timerInterval) clearInterval(timerInterval);
    closeEndSaleModal();
    viewResults(currentSaleId);
  }
}

// ─── POST-SALE RESULTS ───────────────────────────────────────────────────────
async function viewResults(saleId) {
  currentSaleId = saleId;
  showScreen('post-sale-screen');
  
  const animRes = await fetch(`/clerk/api/animals?sale_id=${saleId}`, { credentials: 'include' });
  const saleAnimals = await animRes.json();
  
  const sold = saleAnimals.filter(a => a.status === 'sold');
  const skipped = saleAnimals.filter(a => a.status === 'skipped');
  const totalRevenue = sold.reduce((sum, a) => sum + (a.sold_price || 0), 0);
  
  document.getElementById('sale-summary').innerHTML = `
    <div class="summary-stat"><div class="stat-value">${saleAnimals.length}</div><div class="stat-label">Total Horses</div></div>
    <div class="summary-stat"><div class="stat-value">${sold.length}</div><div class="stat-label">Sold</div></div>
    <div class="summary-stat"><div class="stat-value">${skipped.length}</div><div class="stat-label">Skipped</div></div>
    <div class="summary-stat"><div class="stat-value">$${fmt(totalRevenue)}</div><div class="stat-label">Total Revenue</div></div>
  `;
  
  window._saleAnimals = saleAnimals;
  showResultsTab('all', document.querySelector('#post-sale-screen .tab-btn'));
  
  // Load buyers for this sale
  try {
    const buyersRes = await fetch(`/clerk/api/sales/${saleId}/buyers`, { credentials: 'include' });
    window._saleBuyers = await buyersRes.json();
  } catch(e) { window._saleBuyers = { online: [], inperson: [] }; }
  showSaleBuyersTab('all', document.querySelector('#post-sale-screen .sale-buyers-list')?.closest('.western-box')?.querySelector('.tab-btn'));
}

function showResultsTab(filter, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  
  let items = window._saleAnimals || [];
  if (filter === 'sold') items = items.filter(a => a.status === 'sold');
  else if (filter === 'skipped') items = items.filter(a => a.status === 'skipped');
  
  const list = document.getElementById('results-list');
  if (!items.length) {
    list.innerHTML = '<div class="list-empty">No results in this category.</div>';
    return;
  }
  
  list.innerHTML = items.map(a => {
    let detail = '';
    let price = '';
    if (a.status === 'sold') {
      detail = `Sold to: ${esc(a.sold_to_name || 'Unknown')} ${a.sold_to_number ? '(#' + a.sold_to_number + ')' : ''} &bull; ${a.sold_type === 'inperson' ? 'In Person' : 'Online'}`;
      price = '$' + fmt(a.sold_price || 0);
    } else if (a.status === 'skipped') {
      detail = 'Skipped';
      price = '&mdash;';
    } else {
      detail = 'Not sold';
      price = '&mdash;';
    }
    return `<div class="result-item">
      <div class="result-item-info">
        <span class="result-item-name">${esc(a.name)}</span>
        <span class="result-item-detail">${detail}</span>
      </div>
      <span class="result-item-price">${price}</span>
    </div>`;
  }).join('');
}

function showSaleBuyersTab(filter, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  
  const data = window._saleBuyers || { online: [], inperson: [] };
  const list = document.getElementById('sale-buyers-list');
  
  let items = [];
  if (filter === 'all' || filter === 'online') {
    items = items.concat((data.online || []).map(b => ({ ...b, type: 'Online' })));
  }
  if (filter === 'all' || filter === 'inperson') {
    items = items.concat((data.inperson || []).map(b => ({ ...b, type: 'In Person' })));
  }
  
  if (!items.length) {
    list.innerHTML = '<div class="list-empty">No buyers in this category.</div>';
    return;
  }
  
  list.innerHTML = items.map(b => `
    <div class="buyer-item">
      <div class="buyer-item-info">
        <span class="buyer-item-name">${esc(b.full_name || b.name || 'Unknown')}</span>
        <span class="buyer-item-detail">${b.buyer_number ? '#' + b.buyer_number : ''} &bull; ${b.type}${b.email ? ' &bull; ' + esc(b.email) : ''}</span>
      </div>
    </div>
  `).join('');
}

function exportSale() {
  if (!currentSaleId) return;
  window.location.href = `/clerk/api/sales/${currentSaleId}/export`;
}

async function continueSale(saleId) {
  const res = await fetch('/clerk/api/sales/' + saleId + '/continue', { method: 'POST', credentials: 'include' });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  if (data.ok) {
    currentSaleId = saleId;
    showScreen('live-sale-screen');
    await loadLiveState();
    await loadLiveLineup();
    startTimer();
  }
}
async function rerunSale() {
  if (!confirm('Re-run this sale? All sold/skipped statuses will be reset.')) return;
  await fetch(`/clerk/api/sales/${currentSaleId}/rerun`, { method: 'POST', credentials: 'include' });
  openSale(currentSaleId);
}

// ─── SOCKET EVENTS ───────────────────────────────────────────────────────────
socket.on('state', (state) => {
  saleState = state;
  if (document.getElementById('live-sale-screen').classList.contains('active')) {
    updateLiveDisplay();
    renderLiveLineup();
  }
});

socket.on('bid', (data) => {
  if (document.getElementById('live-sale-screen').classList.contains('active')) {
    if (data.bidType === 'online') {
      const alertEl = document.getElementById('online-bid-alert');
      document.getElementById('online-bid-text').textContent = `Online bid: $${fmt(data.amount)} from ${data.bidderName || '#' + data.bidderNumber}`;
      alertEl.classList.remove('hidden');
      setTimeout(() => alertEl.classList.add('hidden'), 4000);
    }
    // Update bid display
    if (saleState) {
      saleState.current_bid = data.amount;
      saleState.current_bidder_name = data.bidderName;
      saleState.current_bidder_number = data.bidderNumber;
      updateLiveDisplay();
      refreshAuditTrail();
    }
  }
});

socket.on('sold', () => {
  loadLiveState();
  loadLiveLineup();
});

socket.on('animal_skipped', () => {
  loadLiveState();
  loadLiveLineup();
});

socket.on('animals_updated', () => {
  if (document.getElementById('live-sale-screen').classList.contains('active')) {
    loadLiveLineup();
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Close modals on overlay click
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
  });
});

// ─── ROSTER MANAGEMENT ──────────────────────────────────────────────────────
async function loadRoster() {
  // Populate the dropdown with all sales
  const res = await fetch('/clerk/api/sales', { credentials: 'include' });
  const sales = await res.json();
  const dropdown = document.getElementById('roster-sale-dropdown');
  dropdown.innerHTML = '<option value="">-- Select Sale --</option>';
  sales.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + (s.sale_date ? ' (' + s.sale_date + ')' : '') + (s.roster_published ? ' ✓ PUBLISHED' : '');
    if (s.roster_published) opt.selected = true;
    dropdown.appendChild(opt);
  });

  // Update badge and unpublish button
  const published = sales.find(s => s.roster_published);
  const badge = document.getElementById('roster-status-badge');
  const unpubBtn = document.getElementById('unpublish-roster-btn');
  if (published) {
    badge.textContent = 'Published';
    badge.className = 'badge badge-live';
    unpubBtn.style.display = 'inline-block';
  } else {
    badge.textContent = 'Not Published';
    badge.className = 'badge badge-draft';
    unpubBtn.style.display = 'none';
  }
}

async function publishRoster() {
  const saleId = document.getElementById('roster-sale-dropdown').value;
  if (!saleId) return alert('Please select a sale first.');
  await fetch(`/clerk/api/roster/publish/${saleId}`, { method: 'POST', credentials: 'include' });
  loadRoster();
}

async function unpublishRoster() {
  const saleId = document.getElementById('roster-sale-dropdown').value;
  if (!saleId) {
    // Find the currently published one
    const res = await fetch('/clerk/api/roster', { credentials: 'include' });
    const data = await res.json();
    if (data.sale) {
      await fetch(`/clerk/api/roster/unpublish/${data.sale.id}`, { method: 'POST', credentials: 'include' });
    }
  } else {
    await fetch(`/clerk/api/roster/unpublish/${saleId}`, { method: 'POST', credentials: 'include' });
  }
  loadRoster();
}

// ─── NEWSLETTER MANAGEMENT ──────────────────────────────────────────────────
async function loadNewsletters() {
  const res = await fetch('/clerk/api/newsletters', { credentials: 'include' });
  const newsletters = await res.json();
  const container = document.getElementById('newsletters-list');
  if (!newsletters.length) {
    container.innerHTML = '<p class="empty-msg">No newsletters yet. Post one to announce upcoming sales.</p>';
    return;
  }
  container.innerHTML = newsletters.map(nl => `
    <div class="newsletter-item">
      <div class="nl-header">
        <strong>${esc(nl.title)}</strong>
        ${nl.sale_date ? '<span class="nl-date">Sale: ' + nl.sale_date + '</span>' : ''}
      </div>
      ${nl.description ? '<p class="nl-desc">' + esc(nl.description) + '</p>' : ''}
      ${nl.photo_path ? '<img src="' + nl.photo_path + '" class="nl-thumb" alt="">' : ''}
      <div class="nl-actions">
        <button class="btn btn-outline btn-xs" onclick="editNewsletter(${nl.id})">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="deleteNewsletter(${nl.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

function openNewsletterModal(editData) {
  document.getElementById('newsletter-modal').classList.add('open');
  document.getElementById('nl-title').value = editData ? editData.title : '';
  document.getElementById('nl-sale-date').value = editData ? (editData.sale_date || '') : '';
  document.getElementById('nl-description').value = editData ? (editData.description || '') : '';
  document.getElementById('nl-photo').value = '';
  document.getElementById('nl-edit-id').value = editData ? editData.id : '';
  document.getElementById('newsletter-modal-title').textContent = editData ? 'Edit Newsletter' : 'Post Newsletter';
}

function closeNewsletterModal() {
  document.getElementById('newsletter-modal').classList.remove('open');
}

async function saveNewsletter(e) {
  e.preventDefault();
  const editId = document.getElementById('nl-edit-id').value;
  const formData = new FormData();
  formData.append('title', document.getElementById('nl-title').value);
  formData.append('sale_date', document.getElementById('nl-sale-date').value || '');
  formData.append('description', document.getElementById('nl-description').value || '');
  const photoFile = document.getElementById('nl-photo').files[0];
  if (photoFile) formData.append('photo', photoFile);

  const url = editId ? `/clerk/api/newsletters/${editId}` : '/clerk/api/newsletters';
  const method = editId ? 'PUT' : 'POST';
  await fetch(url, { method, credentials: 'include', body: formData });
  closeNewsletterModal();
  loadNewsletters();
}

async function editNewsletter(id) {
  const res = await fetch('/clerk/api/newsletters', { credentials: 'include' });
  const all = await res.json();
  const nl = all.find(n => n.id === id);
  if (nl) openNewsletterModal(nl);
}

async function deleteNewsletter(id) {
  if (!confirm('Delete this newsletter?')) return;
  await fetch(`/clerk/api/newsletters/${id}`, { method: 'DELETE', credentials: 'include' });
  loadNewsletters();
}

// ─── BUYER MESSAGE ──────────────────────────────────────────────────────────
async function loadBuyerMessage() {
  try {
    const r = await fetch('/clerk/api/buyer-message', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      document.getElementById('buyer-msg-title').value = data.title || '';
      document.getElementById('buyer-msg-desc').value = data.description || '';
    }
  } catch(e) {}
}
async function saveBuyerMessage() {
  const title = document.getElementById('buyer-msg-title').value.trim();
  const description = document.getElementById('buyer-msg-desc').value.trim();
  try {
    const r = await fetch('/clerk/api/buyer-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, description })
    });
    if (r.ok) {
      alert('Buyer message saved!');
    }
  } catch(e) {
    alert('Error saving message.');
  }
}

// ===== Change Increment on the Fly =====
let ciSelectedValue = null;

function openChangeIncrementModal() {
  ciSelectedValue = null;
  document.getElementById('ci-custom-wrap').classList.add('hidden');
  document.getElementById('ci-custom-input').value = '';
  document.querySelectorAll('#ci-presets .preset-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('change-increment-modal').classList.add('active');
}

function closeCIModal() {
  document.getElementById('change-increment-modal').classList.remove('active');
}

function selectCIPreset(val) {
  document.querySelectorAll('#ci-presets .preset-btn').forEach(b => b.classList.remove('selected'));
  if (val === 'other') {
    ciSelectedValue = 'other';
    document.getElementById('ci-custom-wrap').classList.remove('hidden');
    event.target.classList.add('selected');
  } else {
    ciSelectedValue = val;
    document.getElementById('ci-custom-wrap').classList.add('hidden');
    event.target.classList.add('selected');
  }
}

async function confirmChangeIncrement() {
  let increment = ciSelectedValue;
  if (increment === 'other') {
    increment = parseFloat(document.getElementById('ci-custom-input').value);
    if (!increment || increment <= 0) {
      alert('Please enter a valid increment amount.');
      return;
    }
  }
  if (!increment) {
    alert('Please select an increment amount.');
    return;
  }
  
  try {
    const res = await fetch('/clerk/api/auction/set-increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ increment })
    });
    const data = await res.json();
    if (data.ok) {
      closeCIModal();
      saleState = data.state;
      updateLiveDisplay();
    } else {
      alert(data.error || 'Failed to change increment.');
    }
  } catch(e) {
    alert('Error changing increment.');
  }
}
