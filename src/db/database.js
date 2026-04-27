const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB_PATH is configurable so the file can live on a mounted persistent disk
// at any conventional path (/data on Fly volumes, /var/lib/sqlite, etc.)
// without editing code. Default keeps backwards-compat with existing dev DBs.
const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, 'giftcards.db');

let db = null;
let bootDiagLogged = false;

function logBootDiagnostics() {
    if (bootDiagLogged) return;
    bootDiagLogged = true;
    let exists = false;
    let mtime = null;
    let sizeBytes = 0;
    try {
        const stat = fs.statSync(DB_PATH);
        exists = true;
        mtime = stat.mtime.toISOString();
        sizeBytes = stat.size;
    } catch (_) { /* file doesn't exist yet — first boot or wiped storage */ }

    console.log('========================================');
    console.log(`[db] DB_PATH:           ${DB_PATH}`);
    console.log(`[db] File exists:       ${exists ? 'yes' : 'NO (will be created)'}`);
    if (exists) {
        console.log(`[db] Last modified:     ${mtime}`);
        console.log(`[db] Size:              ${(sizeBytes / 1024).toFixed(1)} KB`);
    }
    if (!exists && process.env.NODE_ENV === 'production') {
        console.warn('[db] ⚠️  DB file does not exist in production. If this happens on every');
        console.warn('[db]    redeploy, your storage is EPHEMERAL — you need a persistent');
        console.warn('[db]    disk mounted at the directory containing DB_PATH.');
        console.warn('[db]    See README → "Persistent storage" section.');
    }
    console.log('========================================');
}

function getDatabase() {
    if (!db) {
        // Ensure parent dir exists — important when DB_PATH points at a freshly
        // mounted volume that has nothing but a mountpoint.
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        logBootDiagnostics();
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    }
    return db;
}

function initializeDatabase() {
    const database = getDatabase();
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    database.exec(schema);
    console.log('Database initialized successfully');
    return database;
}

function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

// Transaction wrapper for atomic operations
function runTransaction(callback) {
    const database = getDatabase();
    return database.transaction(callback)();
}

module.exports = {
    getDatabase,
    initializeDatabase,
    closeDatabase,
    runTransaction,
    DB_PATH
};
