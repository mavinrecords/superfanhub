const { issueCard } = require('../src/services/cardService');
const { initializeDatabase } = require('../src/db/database');

// Initialize DB (required for services to work)
initializeDatabase();

async function run() {
    try {
        console.log('Issuing test card...');
        const result = await issueCard({
            tier: 'premium',
            cardType: 'value',
            initialValue: 50.00,
            issuedBy: 'System Test',
            metadata: { type: 'test_verification' }
        });

        console.log('\n--- TEST CARD ISSUED ---');
        console.log(`Code: ${result.code}`);
        console.log(`Balance: $${result.initialValue}`);
        console.log(`Tier: ${result.tier}`);
        console.log('------------------------\n');

    } catch (error) {
        console.error('Failed to issue card:', error);
    }
}

run();
