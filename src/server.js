require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const { initializeDatabase } = require('./db/database');
const { seedAdminIfNeeded } = require('./db/seedAdmin');
const { apiLimiter, addRequestMetadata, addRequestId } = require('./middleware/security');
const { blockUntilPasswordChanged } = require('./middleware/auth');
const cardsRoutes = require('./routes/cards');
const adminRoutes = require('./routes/admin');
const loyaltyRoutes = require('./routes/loyalty');

const userAuthRoutes = require('./routes/userAuth');
const spotifyRoutes = require('./routes/spotify');
const lastfmRoutes = require('./routes/lastfm');
const campaignsRoutes = require('./routes/campaigns');
const tasksRoutes = require('./routes/tasks');
const rewardsRoutes = require('./routes/rewards');
const leaderboardRoutes = require('./routes/leaderboard');
const squadsRoutes = require('./routes/squads');
const artistsRoutes = require('./routes/artists');
const { initScheduler } = require('./services/scheduler');
const { eventBus } = require('./services/eventBusService');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initializeDatabase();

// Seed admin user from ADMIN_USERNAME / ADMIN_PASSWORD env vars (or admin/admin123 fallback).
// Idempotent — no-op if the admin row already exists.
seedAdminIfNeeded();

// Initialize event bus
eventBus.initialize();

// Initialize scheduler (expiry reminders + task automation)
initScheduler();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://ajax.googleapis.com"],
            // accounts.spotify.com — Spotify OAuth popup (direct, no Pathfix).
            // Last.fm uses simple GET/POST from our server, no browser-side frame.
            frameSrc: ["'self'", "https://accounts.spotify.com"],
            imgSrc: ["'self'", "data:", "https://i.scdn.co", "https://lastfm.freetls.fastly.net"],
            // api.spotify.com / accounts.spotify.com — our server calls these directly,
            // not the browser, but keeping in connectSrc is defense-in-depth if a frontend
            // ever needs to call them (e.g. Spotify Web Playback SDK in the future).
            connectSrc: ["'self'", "https://accounts.spotify.com", "https://api.spotify.com", "https://ws.audioscrobbler.com", "https://storage.googleapis.com"],
        },
    },
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
app.use(session({
    secret: process.env.SESSION_SECRET || 'superfan-hub-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));

// Request correlation ID + metadata
app.use(addRequestId);
app.use(addRequestMetadata);

// Rate limiting for API
app.use('/api', apiLimiter);

// Block admin endpoints (except /change-password) when default password not yet changed
app.use('/api/admin', blockUntilPasswordChanged);

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api/cards', cardsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/user', userAuthRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/lastfm', lastfmRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/squads', squadsRoutes);
app.use('/api/artists', artistsRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Serve frontend pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/gift-cards', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/gift-cards.html'));
});

app.get('/redeem', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/redeem.html'));
});

app.get('/campaigns', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/campaigns.html'));
});

app.get('/tasks', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/tasks.html'));
});

app.get('/leaderboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/leaderboard.html'));
});

app.get('/rewards', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/rewards.html'));
});

app.get('/squads', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/squads.html'));
});

// 404 handler
app.use((req, res) => {
    // Return JSON for API requests, HTML for browser
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

// Error handler
app.use((err, req, res, next) => {
    const rid = req.requestId || '-';
    console.error(`[${rid}] [${req.method} ${req.path}] Unhandled error:`, err);
    res.status(500).json({ error: 'Internal server error', requestId: rid });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎤 Mavin SuperFan Hub running on http://localhost:${PORT}`);
    console.log(`📊 Admin Dashboard: http://localhost:${PORT}/admin`);
    console.log(`🔐 User Login: http://localhost:${PORT}/login`);
    console.log(`📝 User Register: http://localhost:${PORT}/register`);
});

module.exports = app;
