/**
 * Artists Routes — roster CRUD.
 *
 * Public:
 *   GET    /api/artists            → list active artists (frontend display)
 *
 * Admin:
 *   GET    /api/artists/admin      → list all artists (incl. inactive)
 *   POST   /api/artists/admin      → create a new artist
 *   PATCH  /api/artists/admin/:slug → update fields on an artist
 *   DELETE /api/artists/admin/:slug → hard-delete with cascade
 *
 * Admin sub-routes are gated by requireAdmin + the global
 * blockUntilPasswordChanged middleware already mounted on /api/admin — we
 * re-apply requireAdmin here since this route lives at /api/artists.
 */

const express = require('express');
const router = express.Router();
const artistService = require('../services/artistService');
const { requireAdmin } = require('../middleware/auth');
const { blockUntilPasswordChanged } = require('../middleware/auth');

// ─── PUBLIC ────────────────────────────────────────────────────────────────

// GET /api/artists → active roster for frontend display
router.get('/', (req, res) => {
    try {
        const artists = artistService.listActiveArtists();
        res.json({ success: true, data: artists, total: artists.length });
    } catch (error) {
        const rid = req.requestId || '-';
        console.error(`[${rid}] List artists error:`, error);
        res.status(500).json({ success: false, error: 'Failed to list artists' });
    }
});

// ─── ADMIN ─────────────────────────────────────────────────────────────────

// Admin middleware stack: login required + force-password-change gate + role check
const adminStack = [requireAdmin, blockUntilPasswordChanged];

// GET /api/artists/admin → all artists including inactive
router.get('/admin', adminStack, (req, res) => {
    try {
        const artists = artistService.listAllArtists();
        res.json({ success: true, data: artists, total: artists.length });
    } catch (error) {
        const rid = req.requestId || '-';
        console.error(`[${rid}] Admin list artists error:`, error);
        res.status(500).json({ success: false, error: 'Failed to list artists' });
    }
});

// POST /api/artists/admin → create
router.post('/admin', adminStack, (req, res) => {
    const rid = req.requestId || '-';
    try {
        const { display_name, spotify_artist_id, slug, sort_order, active } = req.body || {};
        const created = artistService.addArtist({
            display_name,
            spotify_artist_id,
            slug,
            sort_order,
            active: active === undefined ? 1 : active
        });
        res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error(`[${rid}] Create artist error:`, error);
        // UNIQUE constraint (duplicate slug or spotify_artist_id) → 409
        if (String(error.message).includes('UNIQUE')) {
            return res.status(409).json({ success: false, error: 'Artist with that slug or Spotify ID already exists' });
        }
        res.status(400).json({ success: false, error: error.message || 'Failed to create artist' });
    }
});

// PATCH /api/artists/admin/:slug → update
router.patch('/admin/:slug', adminStack, (req, res) => {
    const rid = req.requestId || '-';
    try {
        const updated = artistService.updateArtist(req.params.slug, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Artist not found' });
        }
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error(`[${rid}] Update artist error:`, error);
        if (String(error.message).includes('UNIQUE')) {
            return res.status(409).json({ success: false, error: 'Another artist already uses that Spotify ID' });
        }
        res.status(400).json({ success: false, error: error.message || 'Failed to update artist' });
    }
});

// DELETE /api/artists/admin/:slug → hard delete with cascade
router.delete('/admin/:slug', adminStack, (req, res) => {
    const rid = req.requestId || '-';
    try {
        const result = artistService.deleteArtist(req.params.slug);
        if (result.counts.artists_deleted === 0 && Object.values(result.counts).every(n => n === 0)) {
            return res.status(404).json({ success: false, error: 'Artist not found' });
        }
        res.json({ success: true, data: result });
    } catch (error) {
        console.error(`[${rid}] Delete artist error:`, error);
        res.status(500).json({ success: false, error: error.message || 'Failed to delete artist' });
    }
});

module.exports = router;
