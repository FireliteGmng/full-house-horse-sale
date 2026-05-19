'use strict';

const socket = io({ transports: ['websocket', 'polling'] });
socket.emit('join', 'home');

let currentUser = null;
let currentState = null;
let bidCount = 0;
let lotTransitioning = false;

// ─── INIT ─────────────────────────────────────────────────────────────────
async function init() {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setUser(data.buyer);
    }
  } catch (e) {}
}

// ─── AUTH ─────────────────────────────────────────────────────────────────
function setUser(buyer) {
  currentUser = buyer;
  document.getElementById('auth-area').classList.add('hidden');
  document.getElementById('user-area').classList.remove('hidden');
  document.getElementById('user-greeting').textContent = 'Welcome, ' + buyer.full_name.split(' ')[0];

  if (buyer.status === 'approved') {
    document.getElementById('login-to-bid').classList.add('hidden');
    document.getElementById('how-card').classList.add('hidden');
    updateBidButton();
  } else if (buyer.status === 'pending') {
    document.getElementById('login-to-bid').innerHTML = '<p>Your account is pending approval by the clerk. You can watch the sale but cannot bid yet.</p>';
  } else if (buyer.status === 'denied') {
    document.getElementById('login-to-bid').innerHTML = '<p>Your account registration was not approved. Please contact the auction house.</p>';
  }
}

function updateBidButton() {
  if (!currentUser || currentUser.status !== 'approved') return;
  const state = currentState;
  const bidArea = document.getElementById('bid-area');
  const btn = document.getElementById('bid-btn');
  const hint = document.getElementById('bid-hint');

  if (!state || state.status !== 'active') {
    bidArea.classList.add('hidden');
    return;
  }

  bidArea.classList.remove('hidden');
  const animal = state.current_animal;
  const inc = animal ? animal.increment : 100;
  const next = (state.current_bid || 0) + inc;
  btn.textContent = `Place Bid — $${fmt(next)}`;
  btn.disabled = false;
  hint.textContent = `Bid increments: $${fmt(inc)} | Your buyer #: ${currentUser.buyer_number}`;
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  document.getElementById('auth-area').classList.remove('hidden');
  document.getElementById('user-area').classList.add('hidden');
  document.getElementById('bid-area').classList.add('hidden');
  document.getElementById('login-to-bid').classList.remove('hidden');
  document.getElementById('how-card').classList.remove('hidden');
  document.getElementById('login-to-bid').innerHTML = '<p>Want to place bids? <button class="link-btn" onclick="openModal(\'login\')">Log in</button> or <button class="link-btn" onclick="openModal(\'register\')">register</button> to participate.</p>';
}

// ─── BID ──────────────────────────────────────────────────────────────────
async function placeBid() {
  const btn = document.getElementById('bid-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/bid', { method: 'POST', credentials: 'include' });
    const data = await r.json();
    if (!r.ok) {
      alert(data.error || 'Bid failed.');
      btn.disabled = false;
    }
    // State update comes via socket
  } catch (e) {
    alert('Network error. Please try again.');
    btn.disabled = false;
  }
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────
socket.on('state', (state) => {
  const prev = currentState;
  currentState = state;

  // Show/hide live indicator
  if (state.status === 'active' || state.status === 'sold') {
    document.getElementById('live-indicator').classList.remove('hidden');
  }

  // Stream
  if (state.youtube_url) {
    const iframe = document.getElementById('stream-iframe');
    const placeholder = document.getElementById('stream-placeholder');
    if (iframe.src !== state.youtube_url) {
      iframe.src = state.youtube_url;
      iframe.classList.remove('hidden');
      placeholder.classList.add('hidden');
    }
    document.getElementById('stream-status').textContent = 'Live';
    document.getElementById('stream-status').className = 'badge badge-green';
  }

  // Lot change detection
  const prevAnimalId = prev ? prev.current_animal_id : null;
  const newAnimalId = state.current_animal_id;

  if (newAnimalId && newAnimalId !== prevAnimalId && !lotTransitioning) {
    transitionLot(state);
  } else if (newAnimalId) {
    updateLotDisplay(state);
  } else if (!newAnimalId) {
    showIdleLot();
  }

  updateBidButton();
});

socket.on('lot_change', ({ state }) => {
  currentState = state;
  transitionLot(state);
  updateBidButton();
  // Clear feed on new lot
  bidCount = 0;
  document.getElementById('feed-count').textContent = '0 bids';
  document.getElementById('feed-list').innerHTML = '<div class="feed-empty" id="feed-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M8 12h8M8 8h5M5 20V4a1 1 0 011-1h12a1 1 0 011 1v16l-4-2-4 2-4-2-2 2z"/></svg><p>Bids will appear here in real time</p></div>';
});

socket.on('bid', (bid) => {
  addFeedItem(bid);
  // Flash the lot card
  const card = document.getElementById('lot-card');
  card.classList.remove('bid-flash');
  void card.offsetWidth;
  card.classList.add('bid-flash');
  setTimeout(() => card.classList.remove('bid-flash'), 600);

  // Bump the bid amount
  const amountEl = document.getElementById('lot-bid');
  amountEl.classList.remove('bump');
  void amountEl.offsetWidth;
  amountEl.classList.add('bump');
});

socket.on('sold', (data) => {
  showSold(data);
});

// ─── LOT TRANSITION ───────────────────────────────────────────────────────
function transitionLot(state) {
  if (lotTransitioning) return;
  lotTransitioning = true;

  const wrapper = document.getElementById('lot-wrapper');
  const card = document.getElementById('lot-card');

  // Exit animation
  card.classList.add('lot-exit');

  setTimeout(() => {
    card.classList.remove('lot-exit');
    updateLotDisplay(state);
    card.classList.add('lot-enter');
    setTimeout(() => {
      card.classList.remove('lot-enter');
      lotTransitioning = false;
    }, 500);
  }, 400);
}

function updateLotDisplay(state) {
  const animal = state.current_animal;
  if (!animal) { showIdleLot(); return; }

  document.getElementById('lot-idle').classList.add('hidden');
  document.getElementById('lot-active').classList.remove('hidden');

  // Photo
  const photoWrap = document.getElementById('lot-photo-wrap');
  const photo = document.getElementById('lot-photo');
  if (animal.photo_path) {
    photo.src = animal.photo_path;
    photo.alt = animal.name;
    photoWrap.classList.remove('hidden');
  } else {
    photoWrap.classList.add('hidden');
  }

  document.getElementById('lot-name').textContent = animal.name;
  document.getElementById('lot-desc').textContent = animal.description || '';

  const bid = state.current_bid || animal.starting_price || 0;
  document.getElementById('lot-bid').textContent = '$' + fmt(bid);

  const bidder = state.current_bidder_number ? '#' + state.current_bidder_number : '—';
  document.getElementById('lot-bidder').textContent = bidder;

  const inc = animal.increment || 100;
  document.getElementById('lot-next').textContent = '$' + fmt(bid + inc);

  // Status badge
  const badge = document.getElementById('lot-status-badge');
  if (state.status === 'sold') {
    badge.textContent = 'Sold';
    badge.className = 'badge badge-red';
  } else {
    badge.textContent = 'Active';
    badge.className = 'badge badge-gold';
  }
}

function showIdleLot() {
  document.getElementById('lot-idle').classList.remove('hidden');
  document.getElementById('lot-active').classList.add('hidden');
}

// ─── FEED ─────────────────────────────────────────────────────────────────
function addFeedItem(bid) {
  const list = document.getElementById('feed-list');
  const empty = document.getElementById('feed-empty');
  if (empty) empty.remove();

  bidCount++;
  document.getElementById('feed-count').textContent = bidCount + (bidCount === 1 ? ' bid' : ' bids');

  const item = document.createElement('div');
  item.className = 'feed-item new';
  item.innerHTML = `
    <span class="feed-dot ${bid.bidType}"></span>
    <span class="feed-amount">$${fmt(bid.amount)}</span>
    <span class="feed-who">${bid.bidType === 'online' ? 'Buyer #' + bid.bidderNumber : 'In-person'}</span>
  `;
  list.insertBefore(item, list.firstChild);

  setTimeout(() => item.classList.remove('new'), 800);

  // Keep max 50 items
  while (list.children.length > 50) list.removeChild(list.lastChild);
}

// ─── SOLD ─────────────────────────────────────────────────────────────────
function showSold(data) {
  const overlay = document.getElementById('sold-overlay');
  const details = document.getElementById('sold-details');
  const name = data.animal ? data.animal.name : 'Lot';
  const bidder = data.bidderNumber ? 'Buyer #' + data.bidderNumber : 'In-person buyer';
  details.textContent = `${name} — $${fmt(data.amount)} — ${bidder}`;
  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 4000);
}

// ─── MODALS ───────────────────────────────────────────────────────────────
function openModal(t) { document.getElementById(t + '-modal').classList.add('open'); }
function closeModal(t) { document.getElementById(t + '-modal').classList.remove('open'); }
function switchModal(f, t) { closeModal(f); openModal(t); }

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

function showAlert(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}
function hideAlerts(prefix) {
  [prefix + '-error', prefix + '-success'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
}

async function submitLogin() {
  hideAlerts('login');
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  if (!email || !pass) return showAlert('login-error', 'Please fill in all fields.');
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password: pass })
    });
    const data = await r.json();
    if (!r.ok) return showAlert('login-error', data.error || 'Login failed.');
    setUser(data.buyer);
    closeModal('login');
  } catch (e) {
    showAlert('login-error', 'Network error. Please try again.');
  }
}

async function submitRegister() {
  hideAlerts('register');
  const fields = {
    full_name: document.getElementById('reg-name').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-password').value,
    phone: document.getElementById('reg-phone').value.trim(),
    address: document.getElementById('reg-address').value.trim(),
    bank_name: document.getElementById('reg-bank-name').value.trim(),
    bank_phone: document.getElementById('reg-bank-phone').value.trim(),
    loan_officer: document.getElementById('reg-loan-officer').value.trim()
  };
  if (!fields.full_name || !fields.email || !fields.password) {
    return showAlert('register-error', 'Name, email, and password are required.');
  }
  try {
    const r = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(fields)
    });
    const data = await r.json();
    if (!r.ok) return showAlert('register-error', data.error || 'Registration failed.');
    showAlert('register-success', 'Registration submitted. The clerk will review and approve your account.');
  } catch (e) {
    showAlert('register-error', 'Network error. Please try again.');
  }
}

// ─── UTILS ────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function scrollToSale(e) {
  if (e) e.preventDefault();
  document.getElementById('sale').scrollIntoView({ behavior: 'smooth' });
}

// ─── START ────────────────────────────────────────────────────────────────
init();
