const { initializeDatabase, getDatabase } = require('./database');
const bcrypt = require('bcrypt');

async function init() {
    console.log('Initializing database...');
    initializeDatabase();

    // Create default admin user if not exists
    const db = getDatabase();
    const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');

    if (!existingAdmin) {
        const passwordHash = await bcrypt.hash('admin123', 12);

        // Detect whether must_change_password column exists (added by migrate.js)
        const cols = db.pragma('table_info(admin_users)').map(c => c.name);
        const hasMustChangeColumn = cols.includes('must_change_password');

        if (hasMustChangeColumn) {
            db.prepare(`
                INSERT INTO admin_users (username, password_hash, role, must_change_password)
                VALUES (?, ?, 'superadmin', 1)
            `).run('admin', passwordHash);
        } else {
            db.prepare(`
                INSERT INTO admin_users (username, password_hash, role)
                VALUES (?, ?, 'superadmin')
            `).run('admin', passwordHash);
        }

        console.log('Default admin user created (username: admin, password: admin123)');
        console.log('⚠️  IMPORTANT: You will be forced to change this password on first login.');
    }

    console.log('Database initialization complete');
    process.exit(0);
}

init().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
