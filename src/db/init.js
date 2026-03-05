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
        db.prepare(`
      INSERT INTO admin_users (username, password_hash, role)
      VALUES (?, ?, 'superadmin')
    `).run('admin', passwordHash);
        console.log('Default admin user created (username: admin, password: admin123)');
        console.log('⚠️  IMPORTANT: Change this password immediately in production!');
    }

    console.log('Database initialization complete');
    process.exit(0);
}

init().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
