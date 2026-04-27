const { initializeDatabase, getDatabase } = require('./database');
const bcrypt = require('bcrypt');

async function init() {
    console.log('Initializing database...');
    initializeDatabase();

    // Read seed credentials from env (override defaults for production deploys).
    const seedUsername = process.env.ADMIN_USERNAME || 'admin';
    const seedPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const usingDefaults = !process.env.ADMIN_PASSWORD;

    if (seedPassword.length < 8) {
        console.error('❌ ADMIN_PASSWORD must be at least 8 characters.');
        process.exit(1);
    }

    const db = getDatabase();
    const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(seedUsername);

    if (!existingAdmin) {
        const passwordHash = await bcrypt.hash(seedPassword, 12);

        // Detect whether must_change_password column exists (added by migrate.js).
        // If the operator set ADMIN_PASSWORD explicitly, trust it and skip forced rotation.
        const cols = db.pragma('table_info(admin_users)').map(c => c.name);
        const hasMustChangeColumn = cols.includes('must_change_password');
        const mustChange = usingDefaults ? 1 : 0;

        if (hasMustChangeColumn) {
            db.prepare(`
                INSERT INTO admin_users (username, password_hash, role, must_change_password)
                VALUES (?, ?, 'superadmin', ?)
            `).run(seedUsername, passwordHash, mustChange);
        } else {
            db.prepare(`
                INSERT INTO admin_users (username, password_hash, role)
                VALUES (?, ?, 'superadmin')
            `).run(seedUsername, passwordHash);
        }

        if (usingDefaults) {
            console.log(`Default admin user created (username: ${seedUsername}, password: admin123)`);
            console.log('⚠️  IMPORTANT: You will be forced to change this password on first login.');
        } else {
            console.log(`Admin user "${seedUsername}" created from ADMIN_USERNAME / ADMIN_PASSWORD env vars.`);
            console.log('   No forced rotation — the password you supplied is the live password.');
        }
    } else {
        console.log(`Admin user "${seedUsername}" already exists — leaving credentials untouched.`);
        console.log('   To rotate, log in and use the password-change flow in /admin.');
    }

    console.log('Database initialization complete');
    process.exit(0);
}

init().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
