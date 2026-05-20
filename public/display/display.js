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
let lastAnimal = null; // Keep track of last shown animal for between-horse state

socket.on('state', (state) => {
  window._lastState = state;
  applyState(state);
});

socket.on('lot_change', ({ state }) => {
  window._lastState = state;
  applyState(state);
});

socket.on('bid', (bid) => {
  // Update bid amount with bump animation
  const amountEl = document.getElementById('bid-amount');
  amountEl.textContent = '$' + fmt(bid.amount);
  amountEl.classList.remove('bump');
  void amountEl.offsetWidth;
  amountEl.classList.add('bump');

  // Update bidder - don't show buyer number to public, just show "Online" or "In-person"
  if (bid.bidType === 'online') {
    document.getElementById('bidder-value').textContent = 'Online Bidder';
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

  const animal = state.current_animal;

  // If we have an animal, remember it
  if (animal) {
    lastAnimal = animal;
  }

  // If sold and we have animal info, show SOLD over the price
  if (state.status === 'sold' && (animal || lastAnimal)) {
    const displayAnimal = animal || lastAnimal;
    document.getElementById('board-idle').classList.add('hidden');
    document.getElementById('board-active').classList.remove('hidden');
    renderAnimal(displayAnimal);
    // Show SOLD over the price
    document.getElementById('bid-amount').innerHTML = '<span class="sold-inline">SOLD</span> $' + fmt(state.current_bid || 0);
    document.getElementById('bidder-value').textContent = '\u2014';
    document.getElementById('next-value').textContent = '\u2014';
    return;
  }

  // Between horses - no current animal but sale is active
  if (!state.current_animal_id || !animal) {
    if (state.status === 'active' || state.status === 'waiting') {
      // Keep showing "Preparing Next Horse" instead of idle
      document.getElementById('board-idle').classList.add('hidden');
      document.getElementById('board-active').classList.add('hidden');
      document.getElementById('board-waiting').classList.remove('hidden');
      return;
    }
    // Truly idle (no sale running)
    document.getElementById('board-idle').classList.remove('hidden');
    document.getElementById('board-active').classList.add('hidden');
    document.getElementById('board-waiting').classList.add('hidden');
    return;
  }

  document.getElementById('board-idle').classList.add('hidden');
  document.getElementById('board-active').classList.remove('hidden');
  document.getElementById('board-waiting').classList.add('hidden');

  renderAnimal(animal);

  const bid = state.current_bid || animal.starting_price || 0;
  document.getElementById('bid-amount').textContent = '$' + fmt(bid);

  const bidder = state.current_bidder_number ? 'Buyer #' + state.current_bidder_number : '\u2014';
  document.getElementById('bidder-value').textContent = bidder;

  updateNextBid(bid, animal.increment);
}

function renderAnimal(animal) {
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
}

function updateNextBid(currentBid, increment) {
  const state = window._lastState;
  const inc = increment || (state && state.current_animal ? state.current_animal.increment : 100);
  document.getElementById('next-value').textContent = '$' + fmt(currentBid + inc);
}

function flashOnlineBid(bid) {
  const banner = document.getElementById('bid-flash-banner');
  document.getElementById('flash-amount').textContent = '$' + fmt(bid.amount);
  document.getElementById('flash-bidder').textContent = 'Online Bidder';

  banner.classList.remove('hidden');

  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    banner.classList.add('hidden');
  }, 3000);
}

function showSold(data) {
  // Show SOLD over the price area instead of full-screen overlay
  const name = data.animal ? data.animal.name : 'Lot';
  const amountEl = document.getElementById('bid-amount');
  amountEl.innerHTML = '<span class="sold-inline">SOLD</span> $' + fmt(data.amount);
  
  // Also show a brief banner at the top
  const overlay = document.getElementById('sold-overlay');
  const sub = document.getElementById('sold-sub');
  sub.textContent = `${name}  \u2014  SOLD for $${fmt(data.amount)}`;
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 5000);
}

function fmt(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function formatDate(d) { if (!d) return ''; const [y,m,day] = d.split('-'); return `${m}/${day}/${y}`; }
