'use strict';

const socket = io({
  transports: ['polling', 'websocket'],
  upgrade: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});
socket.on('connect', () => { socket.emit('join', 'bidder'); });

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
    } else {
      showAuthScreen();
    }
  } catch (e) {
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('bidder-portal').classList.add('hidden');
}

function setUser(buyer) {
  currentUser = buyer;
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('bidder-portal').classList.remove('hidden');

  document.getElementById('user-name-label').textContent = buyer.full_name;

  if (buyer.status === 'approved') {
    document.getElementById('buyer-number-badge').textContent = 'Buyer #' + buyer.buyer_number;
    document.getElementById('buyer-number-badge').classList.remove('hidden');
    updateBidButton();
  } else if (buyer.status === 'pending') {
    document.getElementById('pending-banner').classList.remove('hidden');
  } else if (buyer.status === 'denied') {
    document.getElementById('denied-banner').classList.remove('hidden');
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
  hint.textContent = `Increment: $${fmt(inc)} per bid`;
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  showAuthScreen();
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
  } catch (e) {
    alert('Network error. Please try again.');
    btn.disabled = false;
  }
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────
socket.on('state', (state) => {
  const prev = currentState;
  currentState = state;

  if (state.status === 'active') {
    document.getElementById('live-badge').classList.remove('hidden');
  }

  // Stream
  const iframe = document.getElementById('stream-iframe');
  const streamPlaceholder = document.getElementById('stream-placeholder');
  if (state.youtube_url && state.stream_display_enabled) {
    if (iframe.src !== state.youtube_url) {
      iframe.src = state.youtube_url;
      iframe.classList.remove('hidden');
      streamPlaceholder.classList.add('hidden');
    }
    document.getElementById('stream-badge').textContent = 'Live';
    document.getElementById('stream-badge').className = 'badge badge-green';
  } else {
    iframe.src = '';
    iframe.classList.add('hidden');
    streamPlaceholder.classList.remove('hidden');
    document.getElementById('stream-badge').textContent = 'Waiting';
    document.getElementById('stream-badge').className = 'badge badge-muted';
  }

  const prevId = prev ? prev.current_animal_id : null;
  if (state.current_animal_id && state.current_animal_id !== prevId && !lotTransitioning) {
    transitionLot(state);
  } else if (state.current_animal_id) {
    updateLotDisplay(state);
  } else {
    showIdleLot();
  }

  updateBidButton();
});

socket.on('lot_change', ({ state }) => {
  currentState = state;
  transitionLot(state);
  updateBidButton();
  bidCount = 0;
  document.getElementById('feed-count').textContent = '0 bids';
  document.getElementById('feed-list').innerHTML = '<div class="feed-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M8 12h8M8 8h5M5 20V4a1 1 0 011-1h12a1 1 0 011 1v16l-4-2-4 2-4-2-2 2z"/></svg><p>Bids will appear here in real time</p></div>';
});

socket.on('bid', (bid) => {
  addFeedItem(bid);
  const card = document.getElementById('lot-card');
  card.classList.remove('bid-flash');
  void card.offsetWidth;
  card.classList.add('bid-flash');
  setTimeout(() => card.classList.remove('bid-flash'), 600);

  const amountEl = document.getElementById('lot-bid');
  amountEl.classList.remove('bump');
  void amountEl.offsetWidth;
  amountEl.classList.add('bump');
});

socket.on('sold', (data) => {
  showSold(data);
});

socket.on('stream_display_toggled', (data) => {
  const iframe = document.getElementById('stream-iframe');
  const streamPlaceholder = document.getElementById('stream-placeholder');
  if (data.stream_display_enabled && data.youtube_url) {
    iframe.src = data.youtube_url;
    iframe.classList.remove('hidden');
    streamPlaceholder.classList.add('hidden');
    document.getElementById('stream-badge').textContent = 'Live';
    document.getElementById('stream-badge').className = 'badge badge-green';
  } else {
    iframe.src = '';
    iframe.classList.add('hidden');
    streamPlaceholder.classList.remove('hidden');
    document.getElementById('stream-badge').textContent = 'Waiting';
    document.getElementById('stream-badge').className = 'badge badge-muted';
  }
});

// ─── LOT TRANSITION ───────────────────────────────────────────────────────
function transitionLot(state) {
  if (lotTransitioning) return;
  lotTransitioning = true;

  const card = document.getElementById('lot-card');
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
  const waitingEl = document.getElementById('lot-waiting');
  
  // Handle waiting/between-horses state
  if (!animal && state.status === 'active') {
    document.getElementById('lot-idle').classList.add('hidden');
    document.getElementById('lot-active').classList.add('hidden');
    waitingEl.classList.remove('hidden');
    return;
  }
  if (!animal) { showIdleLot(); return; }

  document.getElementById('lot-idle').classList.add('hidden');
  document.getElementById('lot-active').classList.remove('hidden');
  waitingEl.classList.add('hidden');

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
  
  // Show horse details (age, breed, sex)
  const details = [];
  if (animal.breed) details.push(animal.breed);
  if (animal.age) details.push(animal.age + ' years');
  if (animal.sex) details.push(animal.sex);
  document.getElementById('lot-details').textContent = details.join(' \u2022 ');
  
  document.getElementById('lot-desc').textContent = animal.description || '';

  const bid = state.current_bid || animal.starting_price || 0;
  document.getElementById('lot-bid').textContent = '$' + fmt(bid);

  const bidder = state.current_bidder_number ? '#' + state.current_bidder_number : '\u2014';
  document.getElementById('lot-bidder').textContent = bidder;

  const inc = animal.increment || 100;
  document.getElementById('lot-next').textContent = '$' + fmt(bid + inc);

  const badge = document.getElementById('lot-badge');
  if (state.status === 'sold') { badge.textContent = 'Sold'; badge.className = 'badge badge-red'; }
  else { badge.textContent = 'Active'; badge.className = 'badge badge-gold'; }
}

function showIdleLot() {
  document.getElementById('lot-idle').classList.remove('hidden');
  document.getElementById('lot-active').classList.add('hidden');
  document.getElementById('lot-waiting').classList.add('hidden');
}

// ─── FEED ─────────────────────────────────────────────────────────────────
function addFeedItem(bid) {
  const list = document.getElementById('feed-list');
  const empty = list.querySelector('.feed-empty');
  if (empty) empty.remove();

  bidCount++;
  document.getElementById('feed-count').textContent = bidCount + (bidCount === 1 ? ' bid' : ' bids');

  const isMine = currentUser && bid.bidType === 'online' && bid.bidderNumber === currentUser.buyer_number;
  const item = document.createElement('div');
  item.className = 'feed-item new' + (isMine ? ' mine' : '');
  item.innerHTML = `
    <span class="feed-dot ${bid.bidType}"></span>
    <span class="feed-amount">$${fmt(bid.amount)}</span>
    <span class="feed-who">${bid.bidType === 'online' ? 'Buyer #' + bid.bidderNumber + (isMine ? ' (You)' : '') : 'In-person'}</span>
  `;
  list.insertBefore(item, list.firstChild);
  setTimeout(() => item.classList.remove('new'), 800);
  while (list.children.length > 50) list.removeChild(list.lastChild);
}

// ─── SOLD ─────────────────────────────────────────────────────────────────
function showSold(data) {
  const overlay = document.getElementById('sold-overlay');
  const details = document.getElementById('sold-details');
  const name = data.animal ? data.animal.name : 'Lot';
  const bidder = data.bidderNumber ? 'Buyer #' + data.bidderNumber : 'In-person buyer';
  details.textContent = `${name} — $${fmt(data.amount)} — ${bidder}`;
  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 4500);
}

// ─── AUTH ─────────────────────────────────────────────────────────────────
function showAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
}

function showAlert(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.classList.add('show'); }
function hideAlert(id) { const el = document.getElementById(id); if (el) el.classList.remove('show'); }

async function submitLogin() {
  hideAlert('login-error');
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
  } catch (e) {
    showAlert('login-error', 'Network error. Please try again.');
  }
}

async function submitRegister() {
  hideAlert('register-error');
  hideAlert('register-success');
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
  if (!fields.email || !fields.password) {
    return showAlert('register-error', 'Email and password are required.');
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
    showAlert('register-success', 'Registration submitted. The clerk will review and approve your account shortly.');
  } catch (e) {
    showAlert('register-error', 'Network error. Please try again.');
  }
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────
let notifOpen = false;

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  notifOpen = !notifOpen;
  panel.classList.toggle('hidden', !notifOpen);
  if (notifOpen) loadNotifications();
}

async function loadNotifications() {
  try {
    const r = await fetch('/api/notifications', { credentials: 'include' });
    if (!r.ok) return;
    const data = await r.json();
    renderNotifications(data.notifications);
    updateNotifBadge(data.unread);
  } catch(e) {}
}

function renderNotifications(notifs) {
  const list = document.getElementById('notif-list');
  if (!notifs || !notifs.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  list.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markRead(${n.id})">
      <div class="notif-item-title">${n.title}</div>
      <div class="notif-item-horse">${n.horse_name || ''}</div>
      <div class="notif-item-price">$${fmt(n.price || 0)}</div>
      <div class="notif-item-msg">${n.message || ''}</div>
      <div class="notif-item-time">${new Date(n.created_at).toLocaleString()}</div>
    </div>
  `).join('');
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function markRead(id) {
  try {
    await fetch('/api/notifications/' + id + '/read', { method: 'POST', credentials: 'include' });
    loadNotifications();
  } catch(e) {}
}

function showPurchasePopup(data) {
  document.getElementById('purchase-popup-title').textContent = data.title || 'Purchase Confirmed!';
  document.getElementById('purchase-popup-message').textContent = data.message || '';
  document.getElementById('purchase-popup-horse').textContent = data.horse_name || '';
  document.getElementById('purchase-popup-price').textContent = '$' + fmt(data.price || 0);
  document.getElementById('purchase-popup').classList.remove('hidden');
  loadNotifications();
}

function closePurchasePopup() {
  document.getElementById('purchase-popup').classList.add('hidden');
}

// Listen for purchase notifications via socket
socket.on('purchase_notification', (data) => {
  if (currentUser && data.buyer_id === currentUser.id) {
    showPurchasePopup(data);
  }
});

// Load notifications on login
const origSetUser = setUser;
setUser = function(buyer) {
  origSetUser(buyer);
  setTimeout(loadNotifications, 500);
};

// ─── UTILS ────────────────────────────────────────────────────────────────
function fmt(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ─── START ────────────────────────────────────────────────────────────────
init();
