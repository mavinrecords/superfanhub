const fetch = require('node-fetch'); // Assuming node-fetch or similar is available or I can use http module.
// Actually, node 18+ has native fetch. Environment is Node 22.

const BASE_URL = 'http://localhost:3000/api';
let cookie = '';
let adminCookie = '';
let userToken = '';

async function runTest() {
    console.log('--- Starting Campaign Module Verification ---');

    // 1. Admin Login
    console.log('1. Logging in as Admin...');
    const adminRes = await fetch(`${BASE_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });

    if (adminRes.ok) {
        console.log('   Admin login success');
        const headers = adminRes.headers.get('set-cookie');
        if (headers) {
            // extract connect.sid
            cookie = headers.split(';')[0];
            adminCookie = cookie;
        }
    } else {
        console.error('   Admin login failed', await adminRes.text());
        return;
    }

    // 2. Create Campaign
    console.log('2. Creating Engagement Campaign...');
    const campaignPayload = {
        title: 'Test Verify Campaign ' + Date.now(),
        type: 'social',
        points: 500,
        description: 'A test campaign',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString()
    };

    const createRes = await fetch(`${BASE_URL}/campaigns`, { // Admin Route
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': adminCookie
        },
        body: JSON.stringify(campaignPayload)
    });

    let campaignId;
    if (createRes.ok) {
        const camp = await createRes.json();
        campaignId = camp.id;
        console.log('   Campaign created:', camp.title, `(ID: ${campaignId})`);
    } else {
        console.error('   Create campaign failed', await createRes.text());
        return;
    }

    // 3. User Register/Login (to simulate user)
    console.log('3. Registering/Logging in User...');
    const userEmail = `testuser_${Date.now()}@example.com`;
    const userRegRes = await fetch(`${BASE_URL}/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: userEmail,
            password: 'password123',
            name: 'Test User',
            phone: '1234567890'
        })
    });

    let userId;
    if (userRegRes.ok) {
        const u = await userRegRes.json();
        userId = u.user.id; // Or might be in result
        console.log('   User registered');
    } else {
        // Try login if exists (though unique email used)
        console.log('   Registration failed (maybe exists?), trying login');
    }

    const userLoginRes = await fetch(`${BASE_URL}/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, password: 'password123' })
    });

    if (userLoginRes.ok) {
        const u = await userLoginRes.json();
        userToken = u.token; // authService returns token
        console.log('   User login success');
    } else {
        console.error('   User login failed', await userLoginRes.text());
        return;
    }

    // 3b. Apply for Loyalty Card
    console.log('3b. Applying for Loyalty Card...');
    const applyRes = await fetch(`${BASE_URL}/loyalty/apply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` }
    });

    if (applyRes.ok || applyRes.status === 409) {
        // 409 means already has card, which is fine
        console.log('   Loyalty card applied/exists');
    } else {
        console.error('   Apply failed', await applyRes.text());
    }

    // 4. List Campaigns as User
    console.log('4. Listing Campaigns as User...');
    const listRes = await fetch(`${BASE_URL}/campaigns`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
    });

    if (listRes.ok) {
        const list = await listRes.json();
        const found = list.find(c => c.id === campaignId);
        if (found) console.log('   Campaign found in list OK');
        else console.error('   Campaign NOT found in list');
    } else {
        console.error('   List failed', await listRes.text());
    }

    // 5. Join Campaign
    console.log('5. Joining Campaign...');
    const joinRes = await fetch(`${BASE_URL}/campaigns/${campaignId}/join`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json'
        }
    });

    if (joinRes.ok) {
        console.log('   Joined OK');
    } else {
        console.error('   Join failed', await joinRes.text());
    }

    // 6. Complete Campaign
    console.log('6. Completing Campaign...');
    const completeRes = await fetch(`${BASE_URL}/campaigns/${campaignId}/complete`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${userToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ proof: 'automated_test' })
    });

    if (completeRes.ok) {
        const res = await completeRes.json();
        console.log('   Completed OK. Points awarded:', res.points);
    } else {
        console.error('   Complete failed', await completeRes.text());
    }

    console.log('--- Verification Complete ---');
}

runTest();
