# Live Horse Auction Platform

A premium, real-time auction platform built with Node.js, Express, Socket.IO, and SQLite. Designed with a fluid, glass-inspired UI in bronze, brown, and white.

## Features

- **Four Distinct Views:**
  - `/` — Public homepage and live spectator view. Watch the stream, see the current lot (with photo), and view the live bid feed.
  - `/bidder` — Buyer portal. Register, log in, and place bids with a single click.
  - `/clerk` — Admin panel. Manage the animal lineup, upload photos, approve buyers, and control the sale (Start, In-Person Bid, Mark Sold, Next).
  - `/display` — Auctioneer board. Full-screen display that flashes on online bids and shows the current lot and high bidder.
- **Real-Time Sync:** Powered by Socket.IO. When the clerk advances the sale, all screens update instantly with smooth slide animations.
- **Photo Support:** Upload photos for each lot directly from the clerk panel.
- **Zero-Config Database:** Uses `better-sqlite3` for a fast, local database that requires no external services.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
3. Start the server:
   ```bash
   node server.js
   ```
4. Open `http://localhost:3000` in your browser.

## Default Credentials

- **Clerk Panel Password:** `AuctionClerk2024!` (Configurable via `ADMIN_PASSWORD` in `.env`)

## Deployment to Railway

This project is 100% ready to be deployed to Railway.

1. Push this repository to GitHub.
2. Create a new project on Railway and connect your GitHub repository.
3. Add a **Shared Volume** in Railway and mount it to `/app/data` (or update the database path in `database.js` to point to your volume).
4. Set the following Environment Variables in Railway:
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
5. Deploy! Railway will automatically detect the `package.json` and `railway.toml` and build the app using Nixpacks.
