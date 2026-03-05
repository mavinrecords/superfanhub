# 🎁 Digital Gift Card & Ticket Discount System

A production-ready, closed-ecosystem gift card infrastructure supporting stored-value cards, percentage-based discounts, and hybrid cards.

## Features

- **Card Types**: Value, Discount, and Hybrid cards
- **Secure Codes**: Cryptographically random, bcrypt-hashed codes
- **Atomic Transactions**: SQLite with WAL mode ensures no double-spending
- **Rate Limiting**: Protection against brute-force attacks
- **Full Audit Trail**: Every operation logged with timestamps
- **Admin Dashboard**: Issue, freeze, revoke cards and view audit logs
- **Fan Redemption**: Simple interface for customers to redeem cards

## Quick Start

```bash
# Install dependencies
npm install

# Initialize database (creates default admin user)
npm run init-db

# Start the server
npm run dev
```

**Default Admin Credentials:**
- Username: `admin`
- Password: `admin123`
- ⚠️ **Change this immediately in production!**

## Access Points

- **Customer Redemption**: http://localhost:3000
- **Admin Dashboard**: http://localhost:3000/admin

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cards/validate` | POST | Validate a card code |
| `/api/cards/redeem` | POST | Redeem value from a card |
| `/api/cards/apply-discount` | POST | Apply discount to a ticket |
| `/api/cards/check-balance` | POST | Check card balance |

### Admin Endpoints (Authenticated)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/login` | POST | Admin login |
| `/api/admin/logout` | POST | Admin logout |
| `/api/admin/stats` | GET | Dashboard statistics |
| `/api/admin/cards` | GET | List all cards |
| `/api/admin/cards` | POST | Issue new card |
| `/api/admin/cards/bulk` | POST | Bulk issue cards |
| `/api/admin/cards/:id/freeze` | POST | Freeze a card |
| `/api/admin/cards/:id/unfreeze` | POST | Unfreeze a card |
| `/api/admin/cards/:id/revoke` | POST | Revoke a card |
| `/api/admin/transactions` | GET | View audit log |
| `/api/admin/cards/export/csv` | GET | Export cards as CSV |

## Security Features

1. **Code Hashing**: Gift card codes are bcrypt-hashed before storage
2. **Rate Limiting**: 5 validation attempts per minute per IP
3. **Suspicious Activity Detection**: 15-minute lockout after 10 failed attempts
4. **Atomic Operations**: All balance changes wrapped in transactions
5. **Session-Based Auth**: Secure admin authentication with HTTP-only cookies
6. **Helmet.js**: Security headers for XSS, clickjacking protection

## Project Structure

```
├── src/
│   ├── server.js           # Express app entry point
│   ├── db/
│   │   ├── schema.sql      # Database schema
│   │   ├── database.js     # SQLite connection
│   │   └── init.js         # DB initialization script
│   ├── routes/
│   │   ├── cards.js        # Public API routes
│   │   └── admin.js        # Admin API routes
│   ├── services/
│   │   └── cardService.js  # Core business logic
│   └── middleware/
│       ├── security.js     # Rate limiting, validation
│       └── auth.js         # Admin authentication
├── public/
│   ├── index.html          # Customer redemption UI
│   ├── admin.html          # Admin dashboard
│   ├── css/styles.css      # Shared styles
│   └── js/
│       ├── redemption.js   # Customer UI logic
│       └── admin.js        # Admin UI logic
├── package.json
└── README.md
```

## Card Tiers

- **Standard**: Basic tier
- **Premium**: Mid-tier with enhanced visibility
- **VIP**: Top-tier cards

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `SESSION_SECRET` | (dev secret) | Session encryption key |
| `NODE_ENV` | development | Environment mode |

## Production Deployment

1. Set secure `SESSION_SECRET` environment variable
2. Change default admin password
3. Set `NODE_ENV=production` for secure cookies
4. Consider migrating to PostgreSQL for scale >10K cards
5. Add HTTPS termination (nginx/Cloudflare)

## License

MIT
