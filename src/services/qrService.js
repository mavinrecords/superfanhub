/**
 * QR Code Service
 * Generates QR codes for gift cards
 */

const QRCode = require('qrcode');

/**
 * Generate QR code as data URL
 * @param {string} cardCode - The full gift card code
 * @param {object} options - QR code options
 * @returns {Promise<string>} Data URL of QR code
 */
async function generateQRCode(cardCode, options = {}) {
    const defaultOptions = {
        type: 'png',
        width: 300,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
    };

    const qrOptions = { ...defaultOptions, ...options };

    // Create redemption URL
    const redemptionUrl = `${process.env.BASE_URL || 'http://localhost:3000'}?code=${encodeURIComponent(cardCode)}`;

    try {
        const dataUrl = await QRCode.toDataURL(redemptionUrl, qrOptions);
        return dataUrl;
    } catch (error) {
        console.error('QR code generation error:', error);
        throw new Error('Failed to generate QR code');
    }
}

/**
 * Generate QR code as buffer (for file downloads)
 * @param {string} cardCode - The full gift card code
 * @returns {Promise<Buffer>} PNG buffer
 */
async function generateQRCodeBuffer(cardCode) {
    const redemptionUrl = `${process.env.BASE_URL || 'http://localhost:3000'}?code=${encodeURIComponent(cardCode)}`;

    try {
        const buffer = await QRCode.toBuffer(redemptionUrl, {
            type: 'png',
            width: 400,
            margin: 2,
            errorCorrectionLevel: 'H'
        });
        return buffer;
    } catch (error) {
        console.error('QR code buffer generation error:', error);
        throw new Error('Failed to generate QR code');
    }
}

module.exports = {
    generateQRCode,
    generateQRCodeBuffer
};
