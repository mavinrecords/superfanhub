require('dotenv').config();
const { initializeDatabase } = require('./database');
const { seedAdminIfNeeded } = require('./seedAdmin');

async function init() {
    console.log('Initializing database...');
    initializeDatabase();
    seedAdminIfNeeded();
    console.log('Database initialization complete');
    process.exit(0);
}

init().catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
