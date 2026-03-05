/**
 * Theme Service
 * Card personalization themes and styles
 */

// Available card themes
const THEMES = {
    classic: {
        name: 'Classic',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)',
        accent: '#A2812E',
        textColor: '#ffffff',
        borderColor: 'rgba(162, 129, 46, 0.3)'
    },
    emerald: {
        name: 'Emerald',
        background: 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)',
        accent: '#10b981',
        textColor: '#ffffff',
        borderColor: 'rgba(16, 185, 129, 0.3)'
    },
    sunset: {
        name: 'Sunset',
        background: 'linear-gradient(135deg, #7c2d12 0%, #431407 100%)',
        accent: '#f97316',
        textColor: '#ffffff',
        borderColor: 'rgba(249, 115, 22, 0.3)'
    },
    ocean: {
        name: 'Ocean',
        background: 'linear-gradient(135deg, #1e3a5f 0%, #0a1628 100%)',
        accent: '#3b82f6',
        textColor: '#ffffff',
        borderColor: 'rgba(59, 130, 246, 0.3)'
    },
    purple: {
        name: 'Royal Purple',
        background: 'linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)',
        accent: '#8b5cf6',
        textColor: '#ffffff',
        borderColor: 'rgba(139, 92, 246, 0.3)'
    },
    rose: {
        name: 'Rose Gold',
        background: 'linear-gradient(135deg, #4a1942 0%, #1f0a1d 100%)',
        accent: '#ec4899',
        textColor: '#ffffff',
        borderColor: 'rgba(236, 72, 153, 0.3)'
    },
    midnight: {
        name: 'Midnight',
        background: 'linear-gradient(135deg, #111827 0%, #030712 100%)',
        accent: '#6366f1',
        textColor: '#ffffff',
        borderColor: 'rgba(99, 102, 241, 0.3)'
    },
    gold: {
        name: 'Premium Gold',
        background: 'linear-gradient(135deg, #422006 0%, #1c0a02 100%)',
        accent: '#fbbf24',
        textColor: '#ffffff',
        borderColor: 'rgba(251, 191, 36, 0.3)'
    }
};

/**
 * Get all available themes
 */
function getThemes() {
    return Object.entries(THEMES).map(([id, theme]) => ({
        id,
        ...theme
    }));
}

/**
 * Get a specific theme
 */
function getTheme(themeId) {
    return THEMES[themeId] || THEMES.classic;
}

/**
 * Generate CSS for a theme
 */
function getThemeCSS(themeId) {
    const theme = getTheme(themeId);
    return `
        --card-bg: ${theme.background};
        --card-accent: ${theme.accent};
        --card-text: ${theme.textColor};
        --card-border: ${theme.borderColor};
    `;
}

/**
 * Apply theme to card metadata
 */
function applyThemeToCard(cardId, themeId, db) {
    const card = db.prepare('SELECT metadata FROM gift_cards WHERE id = ?').get(cardId);
    let metadata = {};

    try {
        metadata = card.metadata ? JSON.parse(card.metadata) : {};
    } catch (e) {
        metadata = {};
    }

    metadata.theme = themeId;

    db.prepare('UPDATE gift_cards SET metadata = ?, updated_at = datetime("now") WHERE id = ?')
        .run(JSON.stringify(metadata), cardId);

    return { success: true, theme: getTheme(themeId) };
}

module.exports = {
    THEMES,
    getThemes,
    getTheme,
    getThemeCSS,
    applyThemeToCard
};
