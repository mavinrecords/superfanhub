const { addPoints } = require('../src/services/loyaltyCardService');
const { getDatabase, initializeDatabase } = require('../src/db/database');

// Initialize DB
initializeDatabase();
const db = getDatabase();

const USER_EMAIL = 'verify@example.com';
const MINUTES_TO_STREAM = 2000; // Should be enough for Silver tier (1000 pts)

async function simulate() {
    try {
        console.log(`Simulating streaming for ${USER_EMAIL}...`);

        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(USER_EMAIL);
        if (!user) {
            console.error('User not found. Please run the verification/registration step first.');
            return;
        }

        const userId = user.id;

        // 1. Add fake streaming history records
        console.log(`Adding ${MINUTES_TO_STREAM} minutes of streaming history...`);

        const stmt = db.prepare(`
            INSERT INTO streaming_history 
            (user_id, spotify_track_id, track_name, artist_name, duration_ms, played_at, is_mavin_artist, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), 1, datetime('now'))
        `);

        // Add a few bulk records to represent the time
        // We'll just add one big record per 100 minutes to keep DB clean but show history
        const batches = Math.ceil(MINUTES_TO_STREAM / 100);

        db.transaction(() => {
            for (let i = 0; i < batches; i++) {
                stmt.run(
                    userId,
                    `sim_track_${Date.now()}_${i}`,
                    'Simulated Mavin Hit',
                    'Mavin All Stars',
                    100 * 60 * 1000, // 100 mins in ms
                );
            }
        })();

        // 2. Award Points (simulating the service picking it up)
        console.log('Awarding points...');
        const points = MINUTES_TO_STREAM * 1; // 1 point per minute
        const result = addPoints(userId, points, 'Simulated Streaming Session', 'streaming');

        console.log('\n--- SIMULATION COMPLETE ---');
        console.log(`User: ${USER_EMAIL}`);
        console.log(`Points Added: ${points}`);
        console.log(`New Balance: ${result.newBalance}`);
        console.log(`New Tier: ${result.tier.toUpperCase()}`);
        console.log('---------------------------\n');

    } catch (error) {
        console.error('Simulation failed:', error);
    }
}

simulate();
