#!/usr/bin/env node
/**
 * One-shot helper to resolve Spotify artist IDs by display name.
 *
 *   node scripts/lookup-spotify-artist-ids.js "CupidSZN" "Lovn"
 *
 * Uses Spotify's client-credentials flow (no user consent needed for search).
 * Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.
 *
 * If those aren't set, prints instructions for the manual workflow:
 *   1. Open open.spotify.com, search for the artist
 *   2. Copy the 22-char ID from the URL (/artist/<ID>)
 *   3. Paste into migrate.js or set via POST /api/admin/artists
 */

require('dotenv').config();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

async function getToken() {
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
        },
        body: 'grant_type=client_credentials'
    });
    if (!res.ok) {
        throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
    }
    const { access_token } = await res.json();
    return access_token;
}

async function search(token, name) {
    const url = `https://api.spotify.com/v1/search?type=artist&limit=5&q=${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        throw new Error(`Search failed for "${name}": ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return body.artists?.items || [];
}

function printFallbackInstructions(names) {
    console.log('\n⚠️  SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not found in .env.\n');
    console.log('Automated lookup is unavailable. You have two options:\n');
    console.log('  Option 1 — manual lookup (fastest for just a few artists):');
    for (const name of names) {
        console.log(`    • Open https://open.spotify.com/search/${encodeURIComponent(name)}`);
        console.log(`      Click the artist, copy the 22-char ID from the URL.`);
    }
    console.log('\n  Option 2 — enable automated lookup:');
    console.log('    • Register a Spotify app at https://developer.spotify.com/dashboard');
    console.log('    • Add to .env:');
    console.log('        SPOTIFY_CLIENT_ID=<your-client-id>');
    console.log('        SPOTIFY_CLIENT_SECRET=<your-client-secret>');
    console.log('    • Re-run this script.\n');
    console.log('Once you have the IDs, add artists via the admin API:');
    console.log('    POST /api/admin/artists { display_name, spotify_artist_id }');
    console.log('or edit the seed list in src/db/migrate.js before running `npm run migrate`.\n');
}

async function main() {
    const names = process.argv.slice(2);
    if (names.length === 0) {
        console.error('Usage: node scripts/lookup-spotify-artist-ids.js "Artist Name" ["Another"] ...');
        process.exit(1);
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
        printFallbackInstructions(names);
        process.exit(2);
    }

    console.log('🎵 Requesting Spotify client-credentials token...');
    const token = await getToken();
    console.log('   ✓ Token acquired.\n');

    for (const name of names) {
        console.log(`🔎 Searching for "${name}"...`);
        const items = await search(token, name);
        if (items.length === 0) {
            console.log(`   ✗ No matches found for "${name}".\n`);
            continue;
        }
        console.log('   Top candidates (pick the one that matches):');
        items.forEach((a, i) => {
            const flag = i === 0 ? ' ← best match' : '';
            const genres = a.genres?.length ? ` [${a.genres.slice(0, 3).join(', ')}]` : '';
            console.log(
                `     ${i + 1}. ${a.name.padEnd(30)} id=${a.id}  popularity=${a.popularity}${genres}${flag}`
            );
        });
        console.log('');
    }

    console.log('Paste the chosen IDs into the NEW_ARTISTS seed array in src/db/migrate.js,');
    console.log('then run: npm run migrate');
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
