require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const { initializeDatabase } = require('./db/database');
const { apiLimiter, addRequestMetadata } = require('./middleware/security');
const cardsRoutes = require('./routes/cards');
const adminRoutes = require('./routes/admin');
const loyaltyRoutes = require('./routes/loyalty');

const userAuthRoutes = require('./routes/userAuth');
const spotifyRoutes = require('./routes/spotify');
const campaignsRoutes = require('./routes/campaigns');
const tasksRoutes = require('./routes/tasks');
const rewardsRoutes = require('./routes/rewards');
const leaderboardRoutes = require('./routes/leaderboard');
const squadsRoutes = require('./routes/squads');
const { initScheduler } = require('./services/scheduler');
const { eventBus } = require('./services/eventBusService');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initializeDatabase();

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
            scriptSrc: ["'self'", "'unsafe-inline'", "https://labs.pathfix.com", "https://ajax.googleapis.com"],
            frameSrc: ["'self'", "https://labs.pathfix.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "https://accounts.spotify.com", "https://api.spotify.com", "https://api.pathfix.com", "https://labs.pathfix.com", "https://storage.googleapis.com"],
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

// Request metadata
app.use(addRequestMetadata);

// Rate limiting for API
app.use('/api', apiLimiter);

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api/cards', cardsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/user', userAuthRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/squads', squadsRoutes);

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
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎤 Mavin SuperFan Hub running on http://localhost:${PORT}`);
    console.log(`📊 Admin Dashboard: http://localhost:${PORT}/admin`);
    console.log(`🔐 User Login: http://localhost:${PORT}/login`);
    console.log(`📝 User Register: http://localhost:${PORT}/register`);
});

module.exports = app;
