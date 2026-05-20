'use strict';
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'auction.db');
const db = new Database(DB_PATH);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS buyers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name   TEXT,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    phone       TEXT,
    address     TEXT,
    bank_name   TEXT,
    bank_phone  TEXT,
    loan_officer TEXT,
    buyer_number INTEGER UNIQUE,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL DEFAULT 'Untitled Sale',
    sale_date     TEXT,
    youtube_url   TEXT,
    preset        TEXT,
    status        TEXT NOT NULL DEFAULT 'draft',
    started_at    TEXT,
    ended_at      TEXT,
    timer_seconds INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS animals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id       INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    age           TEXT,
    breed         TEXT,
    sex           TEXT,
    starting_price REAL NOT NULL DEFAULT 0,
    increment     REAL,
    photo_path    TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending',
    sold_price    REAL,
    sold_to_buyer_id INTEGER REFERENCES buyers(id),
    sold_to_name  TEXT,
    sold_to_number TEXT,
    sold_type     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bids (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id   INTEGER NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
    buyer_id    INTEGER REFERENCES buyers(id),
    amount      REAL NOT NULL,
    bid_type    TEXT NOT NULL DEFAULT 'online',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sale_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    active_sale_id      INTEGER REFERENCES sales(id),
    current_animal_id   INTEGER REFERENCES animals(id),
    current_bid         REAL,
    current_bidder_id   INTEGER REFERENCES buyers(id),
    current_bidder_number TEXT,
    current_bidder_name TEXT,
    status              TEXT NOT NULL DEFAULT 'idle',
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO sale_state (id, status) VALUES (1, 'idle');

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS newsletters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    sale_date   TEXT,
    photo_path  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id    INTEGER NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'purchase',
    title       TEXT NOT NULL,
    message     TEXT,
    horse_name  TEXT,
    price       REAL,
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// Migration: add columns if they don't exist (safe for existing DBs)
try { db.exec("ALTER TABLE animals ADD COLUMN sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE"); } catch(e) {}
try { db.exec("ALTER TABLE animals ADD COLUMN age TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE animals ADD COLUMN breed TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE animals ADD COLUMN sex TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE animals ADD COLUMN sold_to_name TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE animals ADD COLUMN sold_to_number TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE animals ADD COLUMN sold_type TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE animals ADD COLUMN sold_to_buyer_id INTEGER REFERENCES buyers(id)"); } catch(e) {}
try { db.exec("ALTER TABLE sales ADD COLUMN roster_published INTEGER DEFAULT 0"); } catch(e) {}

// ─── BUYERS ──────────────────────────────────────────────────────────────────
function registerBuyer(data) {
  const hash = bcrypt.hashSync(data.password, 10);
  const stmt = db.prepare(`
    INSERT INTO buyers (full_name, email, password, phone, address, bank_name, bank_phone, loan_officer)
    VALUES (@full_name, @email, @password, @phone, @address, @bank_name, @bank_phone, @loan_officer)
  `);
  return stmt.run({ ...data, password: hash });
}

function getBuyerByEmail(email) {
  return db.prepare('SELECT * FROM buyers WHERE email = ?').get(email);
}

function getBuyerById(id) {
  return db.prepare('SELECT * FROM buyers WHERE id = ?').get(id);
}

function getAllBuyers() {
  return db.prepare('SELECT id, full_name, email, phone, address, bank_name, bank_phone, loan_officer, buyer_number, status, created_at FROM buyers ORDER BY created_at DESC').all();
}

function approveBuyer(id) {
  const maxRow = db.prepare('SELECT MAX(buyer_number) as m FROM buyers').get();
  const nextNum = (maxRow.m && maxRow.m >= 1100) ? maxRow.m + 1 : 1100;
  db.prepare('UPDATE buyers SET status = ?, buyer_number = ? WHERE id = ?').run('approved', nextNum, id);
  return getBuyerById(id);
}

function denyBuyer(id) {
  db.prepare("UPDATE buyers SET status = 'denied' WHERE id = ?").run(id);
}

function verifyBuyer(email, password) {
  const buyer = getBuyerByEmail(email);
  if (!buyer) return null;
  if (!bcrypt.compareSync(password, buyer.password)) return null;
  return buyer;
}

// ─── SALES ──────────────────────────────────────────────────────────────────
function createSale(data) {
  const stmt = db.prepare(`
    INSERT INTO sales (name, sale_date, youtube_url, preset, status)
    VALUES (@name, @sale_date, @youtube_url, @preset, 'draft')
  `);
  const result = stmt.run({
    name: data.name || 'Untitled Sale',
    sale_date: data.sale_date || null,
    youtube_url: data.youtube_url || null,
    preset: data.preset || null
  });
  return getSaleById(result.lastInsertRowid);
}

function getSaleById(id) {
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
}

function getAllSales() {
  return db.prepare('SELECT * FROM sales ORDER BY created_at DESC').all();
}

function updateSale(id, data) {
  const fields = [];
  const params = [];
  const allowed = ['name', 'sale_date', 'youtube_url', 'preset', 'status', 'started_at', 'ended_at', 'timer_seconds'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  if (!fields.length) return getSaleById(id);
  params.push(id);
  db.prepare(`UPDATE sales SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getSaleById(id);
}

function deleteSale(id) {
  db.prepare('DELETE FROM bids WHERE animal_id IN (SELECT id FROM animals WHERE sale_id = ?)').run(id);
  db.prepare('DELETE FROM animals WHERE sale_id = ?').run(id);
  db.prepare('DELETE FROM sales WHERE id = ?').run(id);
}

function goLive(saleId) {
  db.prepare("UPDATE sales SET status = 'live', started_at = datetime('now') WHERE id = ?").run(saleId);
  db.prepare("UPDATE sale_state SET active_sale_id = ?, status = 'live', current_animal_id = NULL, current_bid = NULL, current_bidder_id = NULL, current_bidder_number = NULL, current_bidder_name = NULL, updated_at = datetime('now') WHERE id = 1").run(saleId);
  return getSaleState();
}

function endSale(saleId, timerSeconds) {
  db.prepare("UPDATE sales SET status = 'ended', ended_at = datetime('now'), timer_seconds = ? WHERE id = ?").run(timerSeconds || 0, saleId);
  db.prepare("UPDATE sale_state SET status = 'ended', current_animal_id = NULL, current_bid = NULL, current_bidder_id = NULL, current_bidder_number = NULL, current_bidder_name = NULL, updated_at = datetime('now') WHERE id = 1").run();
  return getSaleState();
}

// ─── ANIMALS ─────────────────────────────────────────────────────────────────
function getAnimals(saleId) {
  if (saleId) {
    return db.prepare("SELECT * FROM animals WHERE sale_id = ? ORDER BY sort_order ASC, id ASC").all(saleId);
  }
  return db.prepare("SELECT * FROM animals ORDER BY sort_order ASC, id ASC").all();
}

function getAnimalById(id) {
  return db.prepare('SELECT * FROM animals WHERE id = ?').get(id);
}

function addAnimal(data) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM animals WHERE sale_id = ?').get(data.sale_id || null);
  const order = (maxOrder && maxOrder.m !== null && maxOrder.m !== undefined) ? maxOrder.m + 1 : 0;
  const stmt = db.prepare(`
    INSERT INTO animals (sale_id, name, description, age, breed, sex, starting_price, increment, photo_path, sort_order)
    VALUES (@sale_id, @name, @description, @age, @breed, @sex, @starting_price, @increment, @photo_path, @sort_order)
  `);
  const result = stmt.run({
    sale_id: data.sale_id || null,
    name: data.name,
    description: data.description || null,
    age: data.age || null,
    breed: data.breed || null,
    sex: data.sex || null,
    starting_price: parseFloat(data.starting_price) || 0,
    increment: data.increment ? parseFloat(data.increment) : null,
    photo_path: data.photo_path || null,
    sort_order: order
  });
  return getAnimalById(result.lastInsertRowid);
}

function updateAnimal(id, data) {
  const fields = [];
  const params = [];
  const allowed = ['name', 'description', 'age', 'breed', 'sex', 'starting_price', 'increment', 'photo_path', 'sort_order', 'status', 'sold_price', 'sold_to_buyer_id', 'sold_to_name', 'sold_to_number', 'sold_type'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  if (!fields.length) return getAnimalById(id);
  params.push(id);
  db.prepare(`UPDATE animals SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getAnimalById(id);
}

function deleteAnimal(id) {
  db.prepare('DELETE FROM bids WHERE animal_id = ?').run(id);
  db.prepare('DELETE FROM animals WHERE id = ?').run(id);
}

function reorderAnimals(orderedIds) {
  const update = db.prepare('UPDATE animals SET sort_order = ? WHERE id = ?');
  const tx = db.transaction((ids) => {
    ids.forEach((id, idx) => update.run(idx, id));
  });
  tx(orderedIds);
}

function markAnimalSold(animalId, soldPrice, soldType, buyerId, buyerName, buyerNumber) {
  db.prepare(`
    UPDATE animals SET status = 'sold', sold_price = ?, sold_type = ?, sold_to_buyer_id = ?, sold_to_name = ?, sold_to_number = ?
    WHERE id = ?
  `).run(soldPrice, soldType, buyerId || null, buyerName || null, buyerNumber || null, animalId);
  return getAnimalById(animalId);
}

function skipAnimal(animalId) {
  db.prepare("UPDATE animals SET status = 'skipped' WHERE id = ?").run(animalId);
  return getAnimalById(animalId);
}

function resetAnimalStatus(animalId) {
  db.prepare("UPDATE animals SET status = 'pending', sold_price = NULL, sold_to_buyer_id = NULL, sold_to_name = NULL, sold_to_number = NULL, sold_type = NULL WHERE id = ?").run(animalId);
  return getAnimalById(animalId);
}

// ─── BIDS ────────────────────────────────────────────────────────────────────
function addBid(animalId, buyerId, amount, bidType) {
  db.prepare('INSERT INTO bids (animal_id, buyer_id, amount, bid_type) VALUES (?, ?, ?, ?)').run(animalId, buyerId, amount, bidType);
}

function getBidsForAnimal(animalId) {
  return db.prepare(`
    SELECT b.*, bu.full_name, bu.buyer_number
    FROM bids b
    LEFT JOIN buyers bu ON b.buyer_id = bu.id
    WHERE b.animal_id = ?
    ORDER BY b.created_at DESC
    LIMIT 50
  `).all(animalId);
}

function getLastBidForAnimal(animalId) {
  return db.prepare(`
    SELECT b.*, bu.full_name, bu.buyer_number
    FROM bids b
    LEFT JOIN buyers bu ON b.buyer_id = bu.id
    WHERE b.animal_id = ?
    ORDER BY b.id DESC
    LIMIT 1
  `).get(animalId);
}

function deleteLastBid(animalId) {
  const lastBid = db.prepare('SELECT id FROM bids WHERE animal_id = ? ORDER BY id DESC LIMIT 1').get(animalId);
  if (lastBid) {
    db.prepare('DELETE FROM bids WHERE id = ?').run(lastBid.id);
  }
  return lastBid;
}

function getBidAuditTrail(animalId) {
  return db.prepare(`
    SELECT b.id, b.amount, b.bid_type, b.created_at, bu.full_name, bu.buyer_number
    FROM bids b
    LEFT JOIN buyers bu ON b.buyer_id = bu.id
    WHERE b.animal_id = ?
    ORDER BY b.id ASC
  `).all(animalId);
}

// ─── SALE STATE ──────────────────────────────────────────────────────────────
function getSaleState() {
  const state = db.prepare('SELECT * FROM sale_state WHERE id = 1').get();
  if (state && state.current_animal_id) {
    state.current_animal = getAnimalById(state.current_animal_id);
  }
  if (state && state.active_sale_id) {
    state.sale = getSaleById(state.active_sale_id);
  }
  return state;
}

function setSaleState(data) {
  const fields = [];
  const params = [];
  const allowed = ['active_sale_id', 'current_animal_id', 'current_bid', 'current_bidder_id', 'current_bidder_number', 'current_bidder_name', 'status'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  fields.push("updated_at = datetime('now')");
  params.push(1);
  db.prepare(`UPDATE sale_state SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getSaleState();
}

function startNextAnimal(saleId) {
  const state = getSaleState();
  let nextAnimal;

  if (!state.current_animal_id) {
    nextAnimal = db.prepare("SELECT * FROM animals WHERE sale_id = ? AND status = 'pending' ORDER BY sort_order ASC, id ASC LIMIT 1").get(saleId);
  } else {
    const current = getAnimalById(state.current_animal_id);
    nextAnimal = db.prepare("SELECT * FROM animals WHERE sale_id = ? AND status = 'pending' AND (sort_order > ? OR (sort_order = ? AND id > ?)) ORDER BY sort_order ASC, id ASC LIMIT 1")
      .get(saleId, current ? current.sort_order : 0, current ? current.sort_order : 0, state.current_animal_id);
  }

  if (!nextAnimal) return null;

  db.prepare("UPDATE sale_state SET current_animal_id = ?, current_bid = ?, current_bidder_id = NULL, current_bidder_number = NULL, current_bidder_name = NULL, status = 'active', updated_at = datetime('now') WHERE id = 1")
    .run(nextAnimal.id, nextAnimal.starting_price);

  return getSaleState();
}

function goToAnimal(animalId) {
  const animal = getAnimalById(animalId);
  if (!animal) return null;
  db.prepare("UPDATE sale_state SET current_animal_id = ?, current_bid = ?, current_bidder_id = NULL, current_bidder_number = NULL, current_bidder_name = NULL, status = 'active', updated_at = datetime('now') WHERE id = 1")
    .run(animal.id, animal.starting_price);
  // Reset animal status back to pending if it was sold/skipped (going back)
  if (animal.status === 'sold' || animal.status === 'skipped') {
    resetAnimalStatus(animalId);
  }
  return getSaleState();
}

function placeBid(animalId, buyerId, buyerNumber, buyerName, amount, bidType) {
  const state = getSaleState();
  if (!state || state.current_animal_id !== animalId) return { error: 'Not the active lot' };
  if (state.status !== 'active') return { error: 'Auction not active' };
  if (amount <= (state.current_bid || 0)) return { error: 'Bid too low' };

  addBid(animalId, buyerId, amount, bidType);
  db.prepare("UPDATE sale_state SET current_bid = ?, current_bidder_id = ?, current_bidder_number = ?, current_bidder_name = ?, updated_at = datetime('now') WHERE id = 1")
    .run(amount, buyerId || null, buyerNumber || null, buyerName || null);

  return getSaleState();
}

// ─── EXPORT HELPERS ──────────────────────────────────────────────────────────
function getSaleAnimalsForExport(saleId) {
  return db.prepare(`
    SELECT 
      a.id, a.name, a.age, a.breed, a.sex, a.starting_price, a.status,
      a.sold_price, a.sold_type, a.sold_to_name, a.sold_to_number, a.sold_to_buyer_id,
      b.full_name as buyer_full_name, b.buyer_number as buyer_num, b.email as buyer_email,
      b.phone as buyer_phone, b.address as buyer_address,
      b.bank_name, b.bank_phone, b.loan_officer
    FROM animals a
    LEFT JOIN buyers b ON a.sold_to_buyer_id = b.id
    WHERE a.sale_id = ?
    ORDER BY a.sort_order ASC, a.id ASC
  `).all(saleId);
}

function getSaleBuyers(saleId) {
  // Get all buyers who participated in this sale (online bids or sold to)
  const onlineBuyers = db.prepare(`
    SELECT DISTINCT bu.id, bu.full_name, bu.email, bu.phone, bu.address, bu.bank_name, bu.bank_phone, bu.loan_officer, bu.buyer_number, 'online' as source
    FROM bids bi
    JOIN buyers bu ON bi.buyer_id = bu.id
    WHERE bi.animal_id IN (SELECT id FROM animals WHERE sale_id = ?)
  `).all(saleId);
  
  // Get in-person buyers (from sold_to_name where sold_type = 'inperson')
  const inPersonBuyers = db.prepare(`
    SELECT DISTINCT sold_to_name as full_name, sold_to_number as buyer_number, 'inperson' as source
    FROM animals
    WHERE sale_id = ? AND sold_type = 'inperson' AND sold_to_name IS NOT NULL
  `).all(saleId);
  
  return { online: onlineBuyers, inperson: inPersonBuyers };
}

// ─── ROSTER ─────────────────────────────────────────────────────────────────
function publishRoster(saleId) {
  // Unpublish any currently published roster
  db.prepare("UPDATE sales SET roster_published = 0 WHERE roster_published = 1").run();
  db.prepare("UPDATE sales SET roster_published = 1 WHERE id = ?").run(saleId);
  return getSaleById(saleId);
}

function unpublishRoster(saleId) {
  db.prepare("UPDATE sales SET roster_published = 0 WHERE id = ?").run(saleId);
  return getSaleById(saleId);
}

function getPublishedRoster() {
  const sale = db.prepare("SELECT * FROM sales WHERE roster_published = 1").get();
  if (!sale) return null;
  const animals = getAnimals(sale.id);
  return { sale, animals };
}

// ─── NEWSLETTERS ────────────────────────────────────────────────────────────
function createNewsletter(data) {
  const stmt = db.prepare(`
    INSERT INTO newsletters (title, description, sale_date, photo_path)
    VALUES (@title, @description, @sale_date, @photo_path)
  `);
  const result = stmt.run({
    title: data.title || 'Untitled',
    description: data.description || null,
    sale_date: data.sale_date || null,
    photo_path: data.photo_path || null
  });
  return getNewsletterById(result.lastInsertRowid);
}

function getNewsletterById(id) {
  return db.prepare('SELECT * FROM newsletters WHERE id = ?').get(id);
}

function getAllNewsletters() {
  return db.prepare('SELECT * FROM newsletters ORDER BY created_at DESC').all();
}

function updateNewsletter(id, data) {
  const fields = [];
  const params = [];
  const allowed = ['title', 'description', 'sale_date', 'photo_path'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }
  if (!fields.length) return getNewsletterById(id);
  params.push(id);
  db.prepare(`UPDATE newsletters SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getNewsletterById(id);
}

function deleteNewsletter(id) {
  db.prepare('DELETE FROM newsletters WHERE id = ?').run(id);
}

// ─── PUBLIC PAST SALES ──────────────────────────────────────────────────────
function getEndedSales() {
  return db.prepare("SELECT * FROM sales WHERE status = 'ended' ORDER BY ended_at DESC").all();
}

function getPublicSaleResults(saleId) {
  const sale = getSaleById(saleId);
  if (!sale || sale.status !== 'ended') return null;
  const animals = db.prepare(`
    SELECT name, age, breed, sex, status, sold_price, sold_to_name, sold_to_number, sold_type, photo_path
    FROM animals WHERE sale_id = ? ORDER BY sort_order ASC, id ASC
  `).all(saleId);
  return { sale, animals };
}

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────────────
function createNotification(buyerId, data) {
  const stmt = db.prepare(`
    INSERT INTO notifications (buyer_id, type, title, message, horse_name, price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(buyerId, data.type || 'purchase', data.title, data.message, data.horse_name, data.price);
}
function getNotificationsByBuyer(buyerId) {
  return db.prepare('SELECT * FROM notifications WHERE buyer_id = ? ORDER BY created_at DESC').all(buyerId);
}
function markNotificationRead(id, buyerId) {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND buyer_id = ?').run(id, buyerId);
}
function getUnreadCount(buyerId) {
  const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE buyer_id = ? AND read = 0').get(buyerId);
  return row ? row.count : 0;
}

module.exports = {
  db,
  registerBuyer, getBuyerByEmail, getBuyerById, getAllBuyers,
  approveBuyer, denyBuyer, verifyBuyer,
  createSale, getSaleById, getAllSales, updateSale, deleteSale, goLive, endSale,
  getAnimals, getAnimalById, addAnimal, updateAnimal, deleteAnimal, reorderAnimals,
  markAnimalSold, skipAnimal, resetAnimalStatus,
  addBid, getBidsForAnimal, getLastBidForAnimal, deleteLastBid, getBidAuditTrail,
  getSaleState, setSaleState, startNextAnimal, goToAnimal, placeBid,
  getSaleAnimalsForExport, getSaleBuyers,
  getSetting, setSetting,
  publishRoster, unpublishRoster, getPublishedRoster,
  createNotification,
  getNotificationsByBuyer,
  markNotificationRead,
  getUnreadCount,
  createNewsletter, getNewsletterById, getAllNewsletters, updateNewsletter, deleteNewsletter,
  getEndedSales, getPublicSaleResults
};
