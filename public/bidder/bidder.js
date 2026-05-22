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
let lastStreamUrl = null; // Track stream URL independently

// ─── INIT ─────────────────────────────────────────────────────────────────
async function init() {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setUser(data.buyer);
    } else {
      showAuthScreen();
      // Still show the portal in "view only" mode for non-logged-in users
      showViewOnlyMode();
    }
  } catch (e) {
    showAuthScreen();
    showViewOnlyMode();
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('bidder-portal').classList.add('hidden');
  // Scroll to top so user sees the form from the beginning
  window.scrollTo(0, 0);
}

function showViewOnlyMode() {
  // Show the portal but with bid button grayed out
  // Non-logged-in users can still see the sale
  document.getElementById('bidder-portal').classList.remove('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  updateBidButton();
}

function setUser(buyer) {
  currentUser = buyer;
  document.getElementById('auth-screen').classList.add('hidden');

  if (buyer.status === 'approved') {
    // Show full portal
    document.getElementById('pending-lock-screen').classList.add('hidden');
    document.getElementById('denied-lock-screen').classList.add('hidden');
    document.getElementById('bidder-portal').classList.remove('hidden');
    document.getElementById('user-name-label').textContent = buyer.full_name;
    document.getElementById('buyer-number-badge').textContent = 'Buyer #' + buyer.buyer_number;
    document.getElementById('buyer-number-badge').classList.remove('hidden');
    updateBidButton();
    // Join buyer room for private notifications
    socket.emit('join_buyer', buyer.buyer_number);
  } else if (buyer.status === 'pending') {
    // Show lock screen — user cannot access portal
    document.getElementById('bidder-portal').classList.add('hidden');
    document.getElementById('denied-lock-screen').classList.add('hidden');
    document.getElementById('pending-lock-screen').classList.remove('hidden');
    // Join a pending room so server can notify when approved
    socket.emit('join_pending', buyer.id);
  } else if (buyer.status === 'denied') {
    // Show denied screen
    document.getElementById('bidder-portal').classList.add('hidden');
    document.getElementById('pending-lock-screen').classList.add('hidden');
    document.getElementById('denied-lock-screen').classList.remove('hidden');
  }
}

function updateBidButton() {
  const state = currentState;
  const bidArea = document.getElementById('bid-area');
  const btn = document.getElementById('bid-btn');
  const hint = document.getElementById('bid-hint');

  // Always show bid area during active sale
  if (!state || (state.status !== 'active' && state.status !== 'sold')) {
    bidArea.classList.add('hidden');
    return;
  }

  bidArea.classList.remove('hidden');

  // If sold, disable button
  if (state.status === 'sold') {
    btn.textContent = 'SOLD';
    btn.disabled = true;
    btn.classList.add('btn-disabled');
    hint.textContent = '';
    return;
  }

  // If not logged in or not approved, show grayed out button
  if (!currentUser || currentUser.status !== 'approved') {
    const animal = state.current_animal;
    const inc = animal ? animal.increment : 100;
    const next = (state.current_bid || 0) + inc;
    btn.textContent = `Sign In to Bid — $${fmt(next)}`;
    btn.disabled = true;
    btn.classList.add('btn-disabled');
    hint.textContent = 'You must be signed in and approved to place bids.';
    return;
  }

  // Active and approved
  btn.classList.remove('btn-disabled');
  const animal = state.current_animal;
  const inc = animal ? animal.increment : 100;
  const next = (state.current_bid || 0) + inc;
  btn.textContent = `Place Bid — $${fmt(next)}`;
  btn.disabled = false;
  hint.textContent = `Increment: $${fmt(inc)} per bid`;
}

// ─── BID ──────────────────────────────────────────────────────────────────
async function placeBid() {
  if (!currentUser || currentUser.status !== 'approved') return;
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

  if (state.status === 'active' || state.status === 'sold') {
    document.getElementById('live-badge').classList.remove('hidden');
  }

  // Stream — only update if stream_display_enabled explicitly changed
  // This prevents the stream from disappearing during lot transitions
  updateStream(state);

  const prevId = prev ? prev.current_animal_id : null;
  if (state.current_animal_id && state.current_animal_id !== prevId && !lotTransitioning) {
    transitionLot(state);
  } else if (state.current_animal_id || state.current_animal) {
    updateLotDisplay(state);
  } else if (state.status === 'idle' || state.status === 'ended') {
    showIdleLot();
  }
  // If status is 'sold' or 'waiting' but we have a current_animal, keep showing it
  // (don't go to idle)

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

// Winner-only notification (targeted via socket room, so if we receive it, we won)
socket.on('you_won', (data) => {
  showWinnerPopup(data);
});

socket.on('stream_display_toggled', (data) => {
  if (data.stream_display_enabled && data.youtube_url) {
    lastStreamUrl = data.youtube_url;
    showStream(data.youtube_url);
  } else {
    lastStreamUrl = null;
    hideStream();
  }
});

// ─── ACCOUNT APPROVAL / DENIAL (real-time from clerk) ─────────────────────
socket.on('account_approved', (data) => {
  // Clerk approved this account — unlock the portal
  if (currentUser && currentUser.id === data.buyer_id) {
    currentUser.status = 'approved';
    currentUser.buyer_number = data.buyer_number;
    document.getElementById('pending-lock-screen').classList.add('hidden');
    document.getElementById('bidder-portal').classList.remove('hidden');
    document.getElementById('user-name-label').textContent = currentUser.full_name;
    document.getElementById('buyer-number-badge').textContent = 'Buyer #' + data.buyer_number;
    document.getElementById('buyer-number-badge').classList.remove('hidden');
    updateBidButton();
    socket.emit('join_buyer', data.buyer_number);
    // Show approval notification
    addNotification('Your account has been approved! You are now Buyer #' + data.buyer_number + '. You can place bids.');
  }
});

socket.on('account_denied', (data) => {
  // Clerk denied this account — show denied screen
  if (currentUser && currentUser.id === data.buyer_id) {
    currentUser.status = 'denied';
    document.getElementById('pending-lock-screen').classList.add('hidden');
    document.getElementById('bidder-portal').classList.add('hidden');
    document.getElementById('denied-lock-screen').classList.remove('hidden');
  }
});

// ─── STREAM MANAGEMENT ───────────────────────────────────────────────────
function updateStream(state) {
  // Only hide the stream if the server EXPLICITLY says stream_display_enabled === false
  // Never hide it just because the field is missing/undefined
  if (state.stream_display_enabled === true && state.youtube_url) {
    // Stream should be showing
    if (state.youtube_url !== lastStreamUrl) {
      lastStreamUrl = state.youtube_url;
      showStream(state.youtube_url);
    } else {
      // Just make sure it's still visible (don't reload iframe)
      const iframe = document.getElementById('stream-iframe');
      const streamPlaceholder = document.getElementById('stream-placeholder');
      if (iframe.classList.contains('hidden')) {
        iframe.classList.remove('hidden');
        streamPlaceholder.classList.add('hidden');
      }
      document.getElementById('stream-badge').textContent = 'Live';
      document.getElementById('stream-badge').className = 'badge badge-green';
    }
  } else if (state.stream_display_enabled === false) {
    // ONLY hide if server explicitly says disabled
    lastStreamUrl = null;
    hideStream();
  }
  // If stream_display_enabled is undefined/null/missing, leave stream as-is
  // This prevents the stream from disappearing during state transitions
}

function showStream(url) {
  const iframe = document.getElementById('stream-iframe');
  const streamPlaceholder = document.getElementById('stream-placeholder');

  streamPlaceholder.classList.add('hidden');
  document.getElementById('stream-badge').textContent = 'Live';
  document.getElementById('stream-badge').className = 'badge badge-green';

  // Only set src if it changed (prevents reloading/pausing the stream)
  if (iframe.src !== url) {
    iframe.src = url;
  }
  iframe.classList.remove('hidden');
}

function hideStream() {
  const iframe = document.getElementById('stream-iframe');
  const streamPlaceholder = document.getElementById('stream-placeholder');
  iframe.src = '';
  iframe.classList.add('hidden');
  streamPlaceholder.classList.remove('hidden');
  document.getElementById('stream-badge').textContent = 'Waiting';
  document.getElementById('stream-badge').className = 'badge badge-muted';
}

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
  
  // If status is 'sold' and we have an animal, show the lot with SOLD overlay
  if (state.status === 'sold' && animal) {
    document.getElementById('lot-idle').classList.add('hidden');
    document.getElementById('lot-active').classList.remove('hidden');
    waitingEl.classList.add('hidden');
    renderAnimalCard(animal, state);
    // Show SOLD badge on the lot
    const badge = document.getElementById('lot-badge');
    badge.textContent = 'Sold';
    badge.className = 'badge badge-red';
    // Show SOLD over the price
    document.getElementById('lot-bid').innerHTML = '<span class="sold-price-label">SOLD</span> $' + fmt(state.current_bid || 0);
    return;
  }

  // If status is 'waiting' (between horses) - show "preparing next lot"
  if ((state.status === 'waiting' || state.status === 'sold') && !animal) {
    document.getElementById('lot-idle').classList.add('hidden');
    document.getElementById('lot-active').classList.add('hidden');
    waitingEl.classList.remove('hidden');
    return;
  }

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

  renderAnimalCard(animal, state);

  const badge = document.getElementById('lot-badge');
  badge.textContent = 'Active';
  badge.className = 'badge badge-gold';
  document.getElementById('lot-bid').textContent = '$' + fmt(state.current_bid || animal.starting_price || 0);
}

function renderAnimalCard(animal, state) {
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
  const bidder = state.current_bidder_number ? '#' + state.current_bidder_number : '\u2014';
  document.getElementById('lot-bidder').textContent = bidder;

  const inc = animal.increment || 100;
  document.getElementById('lot-next').textContent = '$' + fmt(bid + inc);
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
  // Don't show full-screen overlay. Instead show "SOLD" in the lot card price area.
  // The state update will handle showing SOLD in the lot card via updateLotDisplay
  // Just flash a brief notification banner
  const name = data.animal ? data.animal.name : 'Lot';
  const soldBanner = document.getElementById('sold-banner');
  if (soldBanner) {
    soldBanner.querySelector('.sold-banner-text').textContent = `${name} — SOLD for $${fmt(data.amount)}`;
    soldBanner.classList.remove('hidden');
    setTimeout(() => soldBanner.classList.add('hidden'), 5000);
  }
}

function showWinnerPopup(data) {
  const name = data.animal ? data.animal.name : 'Lot';
  document.getElementById('purchase-popup-title').textContent = 'You Won!';
  document.getElementById('purchase-popup-message').textContent = 'Congratulations! You are the winning bidder.';
  document.getElementById('purchase-popup-horse').textContent = name;
  document.getElementById('purchase-popup-price').textContent = '$' + fmt(data.amount || 0);
  document.getElementById('purchase-popup').classList.remove('hidden');
  loadNotifications();
}

// ─── AUTH ─────────────────────────────────────────────────────────────────
function showAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('tab-forgot').classList.toggle('active', tab === 'forgot');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('forgot-form').classList.toggle('hidden', tab !== 'forgot');
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

async function submitForgotPassword() {
  hideAlert('forgot-error');
  hideAlert('forgot-success');
  const email = document.getElementById('forgot-email').value.trim();
  const phone = document.getElementById('forgot-phone').value.trim();
  const newPass = document.getElementById('forgot-new-password').value;
  if (!email || !phone || !newPass) return showAlert('forgot-error', 'All fields are required.');
  if (newPass.length < 4) return showAlert('forgot-error', 'Password must be at least 4 characters.');
  try {
    const r = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone, new_password: newPass })
    });
    const data = await r.json();
    if (!r.ok) return showAlert('forgot-error', data.error || 'Reset failed.');
    showAlert('forgot-success', data.message || 'Password reset successfully.');
    // Switch back to login after 2 seconds
    setTimeout(() => showAuthTab('login'), 2500);
  } catch (e) {
    showAlert('forgot-error', 'Network error. Please try again.');
  }
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  showAuthScreen();
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

// Load notifications on login + join buyer's private room for winner notifications
const origSetUser = setUser;
setUser = function(buyer) {
  origSetUser(buyer);
  // Join private room for targeted events (like you_won)
  socket.emit('join_buyer', buyer.id);
  setTimeout(loadNotifications, 500);
};

// ─── UTILS ────────────────────────────────────────────────────────────────
function fmt(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ─── START ────────────────────────────────────────────────────────────────
init();
