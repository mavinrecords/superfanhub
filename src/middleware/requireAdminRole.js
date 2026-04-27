/**
 * Role-gated admin middleware (T0-7)
 *
 * Current admin_users.role CHECK constraint allows only 'admin' | 'superadmin'
 * (src/db/schema.sql:54). Rather than migrate the CHECK constraint now (which
 * requires a full table recreate in SQLite), we work within the two existing
 * roles and treat 'superadmin' as the elevated privilege.
 *
 * When Tier 1/2 needs finer-grained roles (moderator / support / readonly),
 * do a single schema migration that recreates admin_users with an expanded
 * CHECK constraint.
 *
 * Usage:
 *   const { requireAdminRole } = require('../middleware/requireAdminRole');
 *   router.patch('/admin/config/:key', requireAdmin, requireAdminRole('superadmin'),
 *     (req, res) => { ... });
 */

function requireAdminRole(...allowedRoles) {
    const allowed = allowedRoles.flat().filter(Boolean);
    return function (req, res, next) {
        if (!req.admin) {
            // requireAdmin should have already run; double-check so we don't
            // accidentally authorize an anonymous request.
            return res.status(401).json({ error: 'Authentication required' });
        }
        const role = req.admin.role || 'admin';
        if (!allowed.includes(role)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                requiredRoles: allowed,
                yourRole: role
            });
        }
        next();
    };
}

module.exports = { requireAdminRole };
