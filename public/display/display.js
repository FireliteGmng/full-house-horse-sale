'use strict';

const socket = io({
  transports: ['polling', 'websocket'],
  upgrade: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});
socket.on('connect', () => { socket.emit('join', 'display'); });

let flashTimer = null;

socket.on('state', (state) => {
  applyState(state);
});

socket.on('lot_change', ({ state }) => {
  applyState(state);
});

socket.on('bid', (bid) => {
  // Update bid amount with bump animation
  const amountEl = document.getElementById('bid-amount');
  amountEl.textContent = '$' + fmt(bid.amount);
  amountEl.classList.remove('bump');
  void amountEl.offsetWidth;
  amountEl.classList.add('bump');

  // Update bidder
  if (bid.bidType === 'online') {
    document.getElementById('bidder-value').textContent = 'Buyer #' + bid.bidderNumber;
    flashOnlineBid(bid);
  } else {
    document.getElementById('bidder-value').textContent = 'In-person';
  }

  // Update next bid
  updateNextBid(bid.amount);
});

socket.on('sold', (data) => {
  showSold(data);
});

function applyState(state) {
  // Sale date
  if (state.sale_date) {
    document.getElementById('sale-date-label').textContent = formatDate(state.sale_date);
  }

  // Status pill
  const pill = document.getElementById('status-pill');
  if (state.status === 'active') { pill.textContent = 'Live'; pill.className = 'status-pill active'; }
  else if (state.status === 'sold') { pill.textContent = 'Sold'; pill.className = 'status-pill sold'; }
  else { pill.textContent = 'Waiting'; pill.className = 'status-pill'; }

  if (!state.current_animal_id || !state.current_animal) {
    document.getElementById('board-idle').classList.remove('hidden');
    document.getElementById('board-active').classList.add('hidden');
    return;
  }

  document.getElementById('board-idle').classList.add('hidden');
  document.getElementById('board-active').classList.remove('hidden');

  const animal = state.current_animal;

  // Photo
  const photo = document.getElementById('lot-photo');
  const placeholder = document.getElementById('lot-photo-placeholder');
  if (animal.photo_path) {
    photo.src = animal.photo_path;
    photo.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    photo.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }

  document.getElementById('lot-name').textContent = animal.name;
  
  // Show breed/age details if available
  const detailParts = [];
  if (animal.breed) detailParts.push(animal.breed);
  if (animal.age) detailParts.push(animal.age + ' yrs');
  if (animal.sex) detailParts.push(animal.sex);
  const detailEl = document.getElementById('lot-details');
  if (detailEl) detailEl.textContent = detailParts.join(' \u2022 ');

  const bid = state.current_bid || animal.starting_price || 0;
  document.getElementById('bid-amount').textContent = '$' + fmt(bid);

  const bidder = state.current_bidder_number ? 'Buyer #' + state.current_bidder_number : '—';
  document.getElementById('bidder-value').textContent = bidder;

  updateNextBid(bid, animal.increment);
}

function updateNextBid(currentBid, increment) {
  // Try to get increment from current state
  const state = window._lastState;
  const inc = increment || (state && state.current_animal ? state.current_animal.increment : 100);
  document.getElementById('next-value').textContent = '$' + fmt(currentBid + inc);
}

function flashOnlineBid(bid) {
  const banner = document.getElementById('bid-flash-banner');
  document.getElementById('flash-amount').textContent = '$' + fmt(bid.amount);
  document.getElementById('flash-bidder').textContent = 'Buyer #' + bid.bidderNumber;

  banner.classList.remove('hidden');

  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    banner.classList.add('hidden');
  }, 3000);
}

function showSold(data) {
  const overlay = document.getElementById('sold-overlay');
  const sub = document.getElementById('sold-sub');
  const name = data.animal ? data.animal.name : 'Lot';
  const bidder = data.bidderNumber ? 'Buyer #' + data.bidderNumber : 'In-person buyer';
  sub.textContent = `${name}  —  $${fmt(data.amount)}  —  ${bidder}`;
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 5000);
}

// Store state for increment reference
socket.on('state', (state) => { window._lastState = state; });

function fmt(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function formatDate(d) { if (!d) return ''; const [y,m,day] = d.split('-'); return `${m}/${day}/${y}`; }
