const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'giftcards.db');

let db = null;

function getDatabase() {
    if (!db) {
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
