require('dotenv').config();
'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const BetterSqliteStore = require('better-sqlite3-session-store');
const SqliteSessionStore = BetterSqliteStore(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clerk2024';
const SESSION_SECRET = process.env.SESSION_SECRET || 'horse-auction-secret-change-me';

// Trust proxy for Railway / HTTPS
app.set('trust proxy', 1);

// ─── UPLOADS ─────────────────────────────────────────────────────────────────
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    cb(ok ? null : new Error('Images only'), ok);
  }
});

// ─── SESSIONS ────────────────────────────────────────────────────────────────
const sessionDb = require('./database').db;

const buyerSessionMiddleware = session({
  name: 'buyer.sid',
  store: new SqliteSessionStore({ client: sessionDb }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
});

const adminSessionMiddleware = session({
  name: 'clerk.sid',
  store: new SqliteSessionStore({ client: sessionDb }),
  secret: SESSION_SECRET + '-admin',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000
  }
});

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── STATIC FILES ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/home', express.static(path.join(__dirname, 'public', 'home')));
app.use('/clerk-static', express.static(path.join(__dirname, 'public', 'clerk')));
app.use('/display-static', express.static(path.join(__dirname, 'public', 'display')));
app.use('/bidder-static', express.static(path.join(__dirname, 'public', 'bidder')));

// Apply buyer session to non-clerk routes
app.use((req, res, next) => {
  if (req.path.startsWith('/clerk')) return next();
  buyerSessionMiddleware(req, res, next);
});

// Apply admin session to clerk routes
app.use('/clerk', adminSessionMiddleware);

// ─── AUTH GUARDS ──────────────────────────────────────────────────────────────
function requireBuyer(req, res, next) {
  if (!req.session.buyerId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Not authorized' });
  next();
}

// ─── PAGE ROUTES ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home', 'index.html')));
app.get('/bidder', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bidder', 'index.html')));
app.get('/bidder/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bidder', 'register.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display', 'index.html')));
app.get('/clerk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'clerk', 'index.html')));

// ─── BUYER AUTH API ───────────────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { full_name, email, password, phone, address, bank_name, bank_phone, loan_officer } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const result = db.registerBuyer({ full_name, email, password, phone, address, bank_name, bank_phone, loan_officer });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already registered.' });
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const buyer = db.verifyBuyer(email, password);
  if (!buyer) return res.status(401).json({ error: 'Invalid email or password.' });
  req.session.buyerId = buyer.id;
  req.session.buyerNumber = buyer.buyer_number;
  const { password: _, ...safe } = buyer;
  res.json({ ok: true, buyer: safe });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ─── FORGOT PASSWORD ─────────────────────────────────────────────────────────
app.post('/api/forgot-password', (req, res) => {
  const { email, phone, new_password } = req.body;
  if (!email || !phone || !new_password) return res.status(400).json({ error: 'Email, phone, and new password are required.' });
  if (new_password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  const buyer = db.getBuyerByEmail(email);
  if (!buyer) return res.status(404).json({ error: 'No account found with that email and phone combination.' });
  // Verify phone matches (normalize by removing non-digits)
  const normalizePhone = (p) => (p || '').replace(/[^0-9]/g, '');
  if (normalizePhone(buyer.phone) !== normalizePhone(phone)) {
    return res.status(404).json({ error: 'No account found with that email and phone combination.' });
  }
  // Update password
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(new_password, 10);
  db.updateBuyerPassword(buyer.id, hash);
  res.json({ ok: true, message: 'Password reset successfully. You can now log in with your new password.' });
});

app.get('/api/me', (req, res) => {
  if (!req.session.buyerId) return res.status(401).json({ error: 'Not authenticated' });
  const buyer = db.getBuyerById(req.session.buyerId);
  if (!buyer) return res.status(401).json({ error: 'Not found' });
  const { password: _, ...safe } = buyer;
  res.json({ buyer: safe });
});

// ─── PUBLIC AUCTION API ───────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  const state = db.getSaleState() || {};
  // Use enrichState for consistency
  res.json(enrichState(state));
});

// Get all animals for the active sale (for bidder browsing)
app.get('/api/animals', (req, res) => {
  const state = db.getSaleState();
  if (!state || !state.active_sale_id) return res.json([]);
  const animals = db.getAnimals(state.active_sale_id);
  // Strip sensitive fields, return public info
  res.json(animals.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    age: a.age,
    breed: a.breed,
    sex: a.sex,
    starting_price: a.starting_price,
    photo_path: a.photo_path,
    status: a.status,
    sort_order: a.sort_order
  })));
});

app.post('/api/bid', requireBuyer, (req, res) => {
  const buyer = db.getBuyerById(req.session.buyerId);
  if (!buyer || buyer.status !== 'approved') return res.status(403).json({ error: 'Your account is not approved to bid.' });

  const state = db.getSaleState();
  if (!state || state.status !== 'active') return res.status(400).json({ error: 'No active auction.' });

  const animal = state.current_animal;
  if (!animal || !animal.increment) return res.status(400).json({ error: 'No increment set for this animal.' });

  const nextBid = (state.current_bid || 0) + animal.increment;

  const result = db.placeBid(state.current_animal_id, buyer.id, buyer.buyer_number, buyer.full_name, nextBid, 'online');
  if (result.error) return res.status(400).json({ error: result.error });

  io.emit('bid', {
    amount: nextBid,
    bidderNumber: buyer.buyer_number,
    bidderName: buyer.full_name,
    bidType: 'online',
    animalId: state.current_animal_id
  });

  emitState(result);
  res.json({ ok: true, state: result });
});

// ─── CLERK AUTH ──────────────────────────────────────────────────────────────
app.post('/clerk/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong password.' });
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/clerk/api/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/clerk/api/check', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// ─── CLERK: SETTINGS ────────────────────────────────────────────────────────
app.get('/clerk/api/settings/youtube', requireAdmin, (req, res) => {
  res.json({ youtube_url: db.getSetting('youtube_url') || '' });
});

app.post('/clerk/api/settings/youtube', requireAdmin, (req, res) => {
  const { youtube_url } = req.body;
  db.setSetting('youtube_url', youtube_url || '');
  // Build embed URL for clients
  const embedUrl = buildYoutubeEmbed(youtube_url || '');
  const displayEnabled = db.getSetting('stream_display_enabled') === '1';
  io.emit('youtube_updated', { youtube_url: embedUrl, stream_display_enabled: displayEnabled });
  res.json({ ok: true, youtube_url: youtube_url || '' });
});

// Toggle stream display on/off
app.post('/clerk/api/settings/stream-display', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  db.setSetting('stream_display_enabled', enabled ? '1' : '0');
  const youtubeUrl = db.getSetting('youtube_url') || '';
  const embedUrl = buildYoutubeEmbed(youtubeUrl);
  io.emit('stream_display_toggled', { stream_display_enabled: !!enabled, youtube_url: embedUrl });
  res.json({ ok: true, stream_display_enabled: !!enabled });
});

app.get('/clerk/api/settings/stream-display', requireAdmin, (req, res) => {
  const enabled = db.getSetting('stream_display_enabled') === '1';
  res.json({ stream_display_enabled: enabled });
});

// Helper: convert YouTube watch URL to embed URL with autoplay and no branding
function buildYoutubeEmbed(url) {
  if (!url) return '';
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!m) return '';
  return `https://www.youtube.com/embed/${m[1]}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&disablekb=1&fs=0&playsinline=1&loop=1&playlist=${m[1]}`;
}

// Helper: enrich any state object with stream info before emitting
function enrichState(state) {
  if (!state) state = {};
  const rawUrl = db.getSetting('youtube_url') || '';
  const displayEnabled = db.getSetting('stream_display_enabled') === '1';
  const embedUrl = buildYoutubeEmbed(rawUrl);
  // Always include stream fields so clients never lose stream state
  state.youtube_url = (displayEnabled && embedUrl) ? embedUrl : null;
  state.stream_display_enabled = displayEnabled;
  return state;
}

// Emit enriched state to all clients
function emitState(state) {
  io.emit('state', enrichState(state));
}

// ─── CLERK: SALES CRUD ──────────────────────────────────────────────────────
app.get('/clerk/api/sales', requireAdmin, (req, res) => {
  res.json(db.getAllSales());
});

app.post('/clerk/api/sales', requireAdmin, (req, res) => {
  const { name, sale_date } = req.body;
  const sale = db.createSale({ name: name || 'Untitled Sale', sale_date: sale_date || null });
  res.json(sale);
});

app.put('/clerk/api/sales/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const sale = db.updateSale(id, req.body);
  res.json(sale);
});

app.delete('/clerk/api/sales/:id', requireAdmin, (req, res) => {
  db.deleteSale(parseInt(req.params.id));
  res.json({ ok: true });
});

// Go Live
app.post('/clerk/api/sales/:id/golive', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const sale = db.getSaleById(id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  
  // Update youtube URL and preset if provided
  if (req.body.youtube_url !== undefined || req.body.preset !== undefined) {
    db.updateSale(id, { youtube_url: req.body.youtube_url, preset: req.body.preset });
  }
  
  const state = db.goLive(id);
  io.emit('sale_live', { sale: db.getSaleById(id), state: enrichState(state) });
  emitState(state);
  res.json({ ok: true, state });
});

// End a sale
app.post('/clerk/api/sales/:id/end', requireAdmin, (req, res) => {
  const { timer_seconds } = req.body;
  const state = db.endSale(parseInt(req.params.id), timer_seconds || 0);
  io.emit('sale_ended', { saleId: parseInt(req.params.id) });
  emitState(state);
  res.json({ ok: true, state });
});

// Continue Sale (resume ended sale that has unsold horses)
app.post('/clerk/api/sales/:id/continue', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const sale = db.getSaleById(id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (sale.status !== 'ended') return res.status(400).json({ error: 'Sale is not ended' });
  
  // Check if there are unsold horses
  const animals = db.getAnimals(id);
  const unsold = animals.filter(a => a.status === 'pending');
  if (!unsold.length) return res.status(400).json({ error: 'All horses have been sold or skipped' });
  
  // Resume the sale - set to live, keep existing data
  db.updateSale(id, { status: 'live', ended_at: null });
  sessionDb.prepare("UPDATE sale_state SET active_sale_id = ?, status = 'live', current_animal_id = NULL, current_bid = NULL, current_bidder_id = NULL, current_bidder_number = NULL, current_bidder_name = NULL, updated_at = datetime('now') WHERE id = 1").run(id);
  const state = db.getSaleState();
  io.emit('sale_live', { sale: db.getSaleById(id), state: enrichState(state) });
  emitState(state);
  res.json({ ok: true, state });
});

// ─── CLERK: ANIMALS (go live again with same sale)
app.post('/clerk/api/sales/:id/rerun', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  // Reset all animals to pending
  const animals = db.getAnimals(id);
  animals.forEach(a => {
    db.updateAnimal(a.id, { status: 'pending', sold_price: null, sold_to_buyer_id: null, sold_to_name: null, sold_to_number: null, sold_type: null });
  });
  db.updateSale(id, { status: 'draft', started_at: null, ended_at: null, timer_seconds: 0 });
  res.json({ ok: true });
});

// ─── CLERK: ANIMALS CRUD ─────────────────────────────────────────────────────
app.get('/clerk/api/animals', requireAdmin, (req, res) => {
  const { sale_id } = req.query;
  res.json(db.getAnimals(sale_id ? parseInt(sale_id) : null));
});

app.post('/clerk/api/animals', requireAdmin, upload.single('photo'), (req, res) => {
  const { name, description, age, breed, sex, starting_price, increment, sale_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const photo_path = req.file ? `/uploads/${req.file.filename}` : null;
  const animal = db.addAnimal({
    sale_id: sale_id ? parseInt(sale_id) : null,
    name,
    description: description || null,
    age: age || null,
    breed: breed || null,
    sex: sex || null,
    starting_price: parseFloat(starting_price) || 0,
    increment: increment ? parseFloat(increment) : null,
    photo_path
  });
  io.to('clerk').emit('animals_updated', db.getAnimals(sale_id ? parseInt(sale_id) : null));
  res.json(animal);
});

app.put('/clerk/api/animals/:id', requireAdmin, upload.single('photo'), (req, res) => {
  const id = parseInt(req.params.id);
  const updates = {};
  const fields = ['name', 'description', 'age', 'breed', 'sex', 'starting_price', 'increment', 'sort_order'];
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (updates.starting_price) updates.starting_price = parseFloat(updates.starting_price);
  if (updates.increment) updates.increment = parseFloat(updates.increment);
  if (req.file) updates.photo_path = `/uploads/${req.file.filename}`;
  if (req.body.remove_photo === 'true') updates.photo_path = null;

  const animal = db.updateAnimal(id, updates);
  
  // Get the sale_id for this animal to emit updated list
  const fullAnimal = db.getAnimalById(id);
  if (fullAnimal && fullAnimal.sale_id) {
    io.to('clerk').emit('animals_updated', db.getAnimals(fullAnimal.sale_id));
  }

  // If this is the current lot, push updated state to all
  const state = db.getSaleState();
  if (state.current_animal_id === id) {
    emitState(db.getSaleState());
  }

  res.json(animal);
});

app.delete('/clerk/api/animals/:id', requireAdmin, (req, res) => {
  const animal = db.getAnimalById(parseInt(req.params.id));
  db.deleteAnimal(parseInt(req.params.id));
  if (animal && animal.sale_id) {
    io.to('clerk').emit('animals_updated', db.getAnimals(animal.sale_id));
  }
  res.json({ ok: true });
});

app.post('/clerk/api/animals/reorder', requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  db.reorderAnimals(ids);
  res.json({ ok: true });
});

// ─── CLERK: AUCTION CONTROL ──────────────────────────────────────────────────
app.get('/clerk/api/state', requireAdmin, (req, res) => {
  res.json(db.getSaleState());
});

// Start first animal / move to next
app.post('/clerk/api/auction/next', requireAdmin, (req, res) => {
  const { increment, starting_price } = req.body;
  const state = db.getSaleState();
  if (!state || !state.active_sale_id) return res.status(400).json({ error: 'No active sale.' });
  
  const nextState = db.startNextAnimal(state.active_sale_id);
  if (!nextState) return res.status(400).json({ error: 'No more animals.' });
  
  // Set the increment and starting price for this animal if provided
  if (nextState.current_animal_id) {
    const updates = {};
    if (increment) updates.increment = parseFloat(increment);
    if (starting_price) updates.starting_price = parseFloat(starting_price);
    if (Object.keys(updates).length) db.updateAnimal(nextState.current_animal_id, updates);
    
    // If starting price was set, update the current bid in sale_state
    if (starting_price) {
      sessionDb.prepare("UPDATE sale_state SET current_bid = ? WHERE id = 1").run(parseFloat(starting_price));
    }
  }
  
  const finalState = db.getSaleState();
  io.emit('lot_change', { state: enrichState(finalState), direction: 'next' });
  emitState(finalState);
  res.json({ ok: true, state: finalState });
});

// Set increment for current animal (when moving to next, clerk is prompted)
app.post('/clerk/api/auction/set-increment', requireAdmin, (req, res) => {
  const { increment } = req.body;
  const state = db.getSaleState();
  if (!state || !state.current_animal_id) return res.status(400).json({ error: 'No active animal.' });
  
  db.updateAnimal(state.current_animal_id, { increment: parseFloat(increment) || 100 });
  const newState = db.getSaleState();
  emitState(newState);
  res.json({ ok: true, state: newState });
});

// In-person bid (clerk clicks to raise bid)
app.post('/clerk/api/auction/inperson', requireAdmin, (req, res) => {
  const state = db.getSaleState();
  if (!state || state.status !== 'active') return res.status(400).json({ error: 'No active auction.' });

  const animal = db.getAnimalById(state.current_animal_id);
  const increment = animal ? (animal.increment || 100) : 100;
  const nextBid = (state.current_bid || 0) + increment;

  const result = db.placeBid(state.current_animal_id, null, null, null, nextBid, 'inperson');
  if (result.error) return res.status(400).json({ error: result.error });

  io.emit('bid', {
    amount: nextBid,
    bidderNumber: null,
    bidderName: 'In-Person',
    bidType: 'inperson',
    animalId: state.current_animal_id
  });
  emitState(result);
  res.json({ ok: true, state: result });
});

// Mark as sold
app.post('/clerk/api/auction/sold', requireAdmin, (req, res) => {
  const { sold_type, buyer_name, buyer_number } = req.body;
  const state = db.getSaleState();
  if (!state || !state.current_animal_id) return res.status(400).json({ error: 'No active lot.' });

  let soldToName, soldToNumber, soldToBuyerId;
  
  if (sold_type === 'inperson') {
    soldToName = buyer_name || 'In-Person Buyer';
    soldToNumber = buyer_number || null;
    soldToBuyerId = null;
  } else {
    // Online - use the current high bidder
    soldToName = state.current_bidder_name || null;
    soldToNumber = state.current_bidder_number || null;
    soldToBuyerId = state.current_bidder_id || null;
  }

  const animal = db.markAnimalSold(
    state.current_animal_id,
    state.current_bid,
    sold_type || 'online',
    soldToBuyerId,
    soldToName,
    soldToNumber
  );

  // Update sale state to 'sold' (waiting for next)
  db.setSaleState({ status: 'sold' });
  const newState = db.getSaleState();

  // Create notification for online buyer
  if (sold_type === 'online' && soldToBuyerId) {
    const buyerMsg = db.getSetting('buyer_message_title') || 'Purchase Confirmed!';
    const buyerDesc = db.getSetting('buyer_message_description') || 'Congratulations on your purchase!';
    const animalData = db.getAnimalById ? db.getAnimalById(state.current_animal_id) : animal;
    db.createNotification(soldToBuyerId, {
      type: 'purchase',
      title: buyerMsg,
      message: buyerDesc,
      horse_name: animalData ? animalData.name : 'Unknown',
      price: state.current_bid
    });
    // Emit notification to the specific buyer via socket
    io.emit('purchase_notification', {
      buyer_id: soldToBuyerId,
      title: buyerMsg,
      message: buyerDesc,
      horse_name: animalData ? animalData.name : 'Unknown',
      price: state.current_bid
    });
  }
  // Emit sold to everyone but WITHOUT revealing who won
  io.emit('sold', {
    animal,
    amount: state.current_bid,
    soldType: sold_type
  });

  // Send winner info only to the winning buyer's private room
  if (sold_type === 'online' && soldToBuyerId) {
    io.to('buyer_' + soldToBuyerId).emit('you_won', {
      animal,
      amount: state.current_bid
    });
  }
  emitState(newState);
  res.json({ ok: true, state: newState, animal });
});

// Rollback bid (decrease by one increment / undo last bid)
app.post('/clerk/api/auction/rollback', requireAdmin, (req, res) => {
  const state = db.getSaleState();
  if (!state || state.status !== 'active') return res.status(400).json({ error: 'No active auction.' });
  if (!state.current_animal_id) return res.status(400).json({ error: 'No active lot.' });

  const animal = db.getAnimalById(state.current_animal_id);
  
  // Delete the last bid
  const deleted = db.deleteLastBid(state.current_animal_id);
  if (!deleted) {
    return res.status(400).json({ error: 'No bids to rollback.' });
  }

  // Get the new last bid (the previous one)
  const prevBid = db.getLastBidForAnimal(state.current_animal_id);
  
  if (prevBid) {
    // Roll back to the previous bid
    db.setSaleState({
      current_bid: prevBid.amount,
      current_bidder_id: prevBid.buyer_id || null,
      current_bidder_number: prevBid.buyer_number || null,
      current_bidder_name: prevBid.full_name || (prevBid.bid_type === 'inperson' ? 'In-Person' : null)
    });
  } else {
    // No more bids — reset to starting price
    db.setSaleState({
      current_bid: animal.starting_price || 0,
      current_bidder_id: null,
      current_bidder_number: null,
      current_bidder_name: null
    });
  }

  const newState = db.getSaleState();
  io.emit('bid_rollback', { animalId: state.current_animal_id, state: newState });
  emitState(newState);
  res.json({ ok: true, state: newState });
});

// Get bid audit trail for a specific animal
app.get('/clerk/api/auction/bids/:animalId', requireAdmin, (req, res) => {
  const animalId = parseInt(req.params.animalId);
  const bids = db.getBidAuditTrail(animalId);
  res.json(bids);
});

// Get full buyer details by ID
app.get('/clerk/api/buyers/:id/details', requireAdmin, (req, res) => {
  const buyer = db.getBuyerById(parseInt(req.params.id));
  if (!buyer) return res.status(404).json({ error: 'Buyer not found' });
  const { password: _, ...safe } = buyer;
  res.json(safe);
});

// Get buyer details by buyer_number
app.get('/clerk/api/buyers/number/:number', requireAdmin, (req, res) => {
  const allBuyers = db.getAllBuyers();
  const buyer = allBuyers.find(b => String(b.buyer_number) === req.params.number);
  if (!buyer) return res.status(404).json({ error: 'Buyer not found' });
  res.json(buyer);
});

// Skip animal
app.post('/clerk/api/auction/skip', requireAdmin, (req, res) => {
  const state = db.getSaleState();
  if (!state || !state.current_animal_id) return res.status(400).json({ error: 'No active lot.' });

  db.skipAnimal(state.current_animal_id);
  db.setSaleState({ status: 'waiting' });
  const newState = db.getSaleState();

  io.emit('animal_skipped', { animalId: state.current_animal_id });
  emitState(newState);
  res.json({ ok: true, state: newState });
});

// Go back to a previous animal
app.post('/clerk/api/auction/goback', requireAdmin, (req, res) => {
  const { animal_id } = req.body;
  if (!animal_id) return res.status(400).json({ error: 'animal_id required' });
  
  const newState = db.goToAnimal(parseInt(animal_id));
  if (!newState) return res.status(400).json({ error: 'Animal not found.' });

  io.emit('lot_change', { state: enrichState(newState), direction: 'back' });
  emitState(newState);
  res.json({ ok: true, state: newState });
});

// ─── CLERK: BUYERS ───────────────────────────────────────────────────────────
app.get('/clerk/api/buyers', requireAdmin, (req, res) => {
  res.json(db.getAllBuyers());
});

app.post('/clerk/api/buyers/:id/approve', requireAdmin, (req, res) => {
  const buyer = db.approveBuyer(parseInt(req.params.id));
  res.json(buyer);
});

app.post('/clerk/api/buyers/:id/deny', requireAdmin, (req, res) => {
  db.denyBuyer(parseInt(req.params.id));
  res.json({ ok: true });
});

// ─── CLERK: EXPORT ───────────────────────────────────────────────────────────
app.get('/clerk/api/sales/:id/export', requireAdmin, (req, res) => {
  const saleId = parseInt(req.params.id);
  const animals = db.getSaleAnimalsForExport(saleId);
  
  // Build Excel XML (SpreadsheetML) for .xls compatibility
  let xml = '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
  xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
  xml += '<Worksheet ss:Name="Sale Results"><Table>\n';
  
  // Header row
  xml += '<Row>';
  const headers = ['Horse Name', 'Age', 'Breed', 'Sex', 'Status', 'Sale Type', 'Sale Price', 'Buyer Name', 'Bidder Number', 'Email', 'Phone', 'Address', 'Bank Name', 'Bank Phone', 'Loan Officer'];
  headers.forEach(h => { xml += `<Cell><Data ss:Type="String">${escXml(h)}</Data></Cell>`; });
  xml += '</Row>\n';
  
  // Data rows
  animals.forEach(a => {
    xml += '<Row>';
    let status = a.status;
    let saleType = '', price = '', buyerName = '', bidderNum = '', email = '', phone = '', address = '', bankName = '', bankPhone = '', loanOfficer = '';
    
    if (a.status === 'sold') {
      saleType = a.sold_type === 'inperson' ? 'In Person' : 'Online';
      price = a.sold_price ? '$' + a.sold_price.toFixed(2) : '';
      buyerName = a.sold_to_name || a.buyer_full_name || '';
      bidderNum = a.sold_to_number || (a.buyer_num ? String(a.buyer_num) : '');
      
      if (a.sold_type === 'online' && a.sold_to_buyer_id) {
        email = a.buyer_email || '';
        phone = a.buyer_phone || '';
        address = a.buyer_address || '';
        bankName = a.bank_name || '';
        bankPhone = a.bank_phone || '';
        loanOfficer = a.loan_officer || '';
      }
    } else if (a.status === 'skipped') {
      saleType = 'Skipped';
      price = 'Skipped';
      buyerName = 'Skipped';
      bidderNum = 'Skipped';
    } else {
      // pending / not sold
      saleType = 'N/A';
      price = 'N/A';
      buyerName = 'N/A';
      bidderNum = 'N/A';
    }
    
    const cells = [a.name, a.age || '', a.breed || '', a.sex || '', status, saleType, price, buyerName, bidderNum, email, phone, address, bankName, bankPhone, loanOfficer];
    cells.forEach(c => { xml += `<Cell><Data ss:Type="String">${escXml(String(c))}</Data></Cell>`; });
    xml += '</Row>\n';
  });
  
  xml += '</Table></Worksheet></Workbook>';
  
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename="sale_results.xls"');
  res.send(xml);
});

// Sale buyers list
app.get('/clerk/api/sales/:id/buyers', requireAdmin, (req, res) => {
  const saleId = parseInt(req.params.id);
  const buyers = db.getSaleBuyers(saleId);
  res.json(buyers);
});

function escXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── ROSTER (CLERK) ──────────────────────────────────────────────────────────
app.post('/clerk/api/roster/publish/:saleId', requireAdmin, (req, res) => {
  const saleId = parseInt(req.params.saleId);
  const sale = db.publishRoster(saleId);
  res.json({ ok: true, sale });
});

app.post('/clerk/api/roster/unpublish/:saleId', requireAdmin, (req, res) => {
  const saleId = parseInt(req.params.saleId);
  const sale = db.unpublishRoster(saleId);
  res.json({ ok: true, sale });
});

app.get('/clerk/api/roster', requireAdmin, (req, res) => {
  const roster = db.getPublishedRoster();
  res.json(roster || { sale: null, animals: [] });
});

// ─── NEWSLETTERS (CLERK) ─────────────────────────────────────────────────────
app.get('/clerk/api/newsletters', requireAdmin, (req, res) => {
  const newsletters = db.getAllNewsletters();
  res.json(newsletters);
});

app.post('/clerk/api/newsletters', requireAdmin, upload.single('photo'), (req, res) => {
  const data = {
    title: req.body.title || 'Untitled',
    description: req.body.description || null,
    sale_date: req.body.sale_date || null,
    photo_path: req.file ? '/uploads/' + req.file.filename : null
  };
  const newsletter = db.createNewsletter(data);
  res.json({ ok: true, newsletter });
});

app.put('/clerk/api/newsletters/:id', requireAdmin, upload.single('photo'), (req, res) => {
  const id = parseInt(req.params.id);
  const data = {
    title: req.body.title,
    description: req.body.description || null,
    sale_date: req.body.sale_date || null
  };
  if (req.file) data.photo_path = '/uploads/' + req.file.filename;
  const newsletter = db.updateNewsletter(id, data);
  res.json({ ok: true, newsletter });
});

app.delete('/clerk/api/newsletters/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const nl = db.getNewsletterById(id);
  if (nl && nl.photo_path) {
    const fullPath = path.join(UPLOADS_DIR, path.basename(nl.photo_path));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }
  db.deleteNewsletter(id);
  res.json({ ok: true });
});

// ─── BUYER MESSAGE SETTINGS ─────────────────────────────────────────────────────
app.get('/clerk/api/buyer-message', requireAdmin, (req, res) => {
  res.json({
    title: db.getSetting('buyer_message_title') || 'Purchase Confirmed!',
    description: db.getSetting('buyer_message_description') || 'Congratulations on your purchase!'
  });
});
app.post('/clerk/api/buyer-message', requireAdmin, (req, res) => {
  const { title, description } = req.body;
  db.setSetting('buyer_message_title', title || 'Purchase Confirmed!');
  db.setSetting('buyer_message_description', description || '');
  res.json({ ok: true });
});

// ─── NOTIFICATIONS API (for bidders) ─────────────────────────────────────────
app.get('/api/notifications', (req, res) => {
  if (!req.session || !req.session.buyerId) return res.status(401).json({ error: 'Not logged in' });
  const notifications = db.getNotificationsByBuyer(req.session.buyerId);
  const unread = db.getUnreadCount(req.session.buyerId);
  res.json({ notifications, unread });
});
app.post('/api/notifications/:id/read', (req, res) => {
  if (!req.session || !req.session.buyerId) return res.status(401).json({ error: 'Not logged in' });
  db.markNotificationRead(parseInt(req.params.id), req.session.buyerId);
  res.json({ ok: true });
});

// ─── PUBLIC API (NO AUTH) ────────────────────────────────────────────────────
app.get('/api/roster', (req, res) => {
  const roster = db.getPublishedRoster();
  res.json(roster || { sale: null, animals: [] });
});

app.get('/api/roster/animal/:id', (req, res) => {
  const animal = db.getAnimalById(parseInt(req.params.id));
  if (!animal) return res.status(404).json({ error: 'Not found' });
  res.json(animal);
});

app.get('/api/newsletters', (req, res) => {
  const newsletters = db.getAllNewsletters();
  res.json(newsletters);
});

app.get('/api/past-sales', (req, res) => {
  const sales = db.getEndedSales();
  res.json(sales);
});

app.get('/api/past-sales/:id', (req, res) => {
  const results = db.getPublicSaleResults(parseInt(req.params.id));
  if (!results) return res.status(404).json({ error: 'Not found' });
  res.json(results);
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join', (room) => {
    if (['home', 'bidder', 'display', 'clerk'].includes(room)) {
      socket.join(room);
    }
  });

  // Allow buyers to join their own private room for targeted events
  socket.on('join_buyer', (buyerId) => {
    if (buyerId) {
      socket.join('buyer_' + buyerId);
    }
  });

  // Send current state on connect (include stream info)
  socket.emit('state', enrichState(db.getSaleState()));

  socket.on('disconnect', () => {});
});

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Horse Auction server running on port ${PORT}`);
  console.log(`  Home:    http://localhost:${PORT}/`);
  console.log(`  Bidder:  http://localhost:${PORT}/bidder`);
  console.log(`  Display: http://localhost:${PORT}/display`);
  console.log(`  Clerk:   http://localhost:${PORT}/clerk`);
});
