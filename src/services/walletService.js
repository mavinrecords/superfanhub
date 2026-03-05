/**
 * Wallet Service
 * Generates Apple Wallet and Google Wallet pass data
 */

/**
 * Generate Apple Wallet pass.json data
 * @param {object} card - Gift card details
 */
function generateApplePassJSON(card) {
    return {
        formatVersion: 1,
        passTypeIdentifier: "pass.com.giftcardagent.card",
        serialNumber: card.code,
        teamIdentifier: "TEAMID12345",
        organizationName: "Gift Card Agent",
        description: "Gift Card",
        logoText: "Gift Card",
        foregroundColor: "rgb(255, 255, 255)",
        backgroundColor: "rgb(26, 26, 26)",
        labelColor: "rgb(16, 185, 129)",
        storeCard: {
            primaryFields: [
                {
                    key: "balance",
                    label: "BALANCE",
                    value: card.currentBalance,
                    currencyCode: "USD"
                }
            ],
            secondaryFields: [
                {
                    key: "tier",
                    label: "TIER",
                    value: (card.tier || 'standard').toUpperCase()
                }
            ],
            auxiliaryFields: [
                {
                    key: "code",
                    label: "CARD CODE",
                    value: card.codeFormatted || card.code
                },
                {
                    key: "expires",
                    label: "EXPIRES",
                    value: card.expiresAt ? new Date(card.expiresAt).toLocaleDateString() : "Never"
                }
            ],
            backFields: [
                {
                    key: "terms",
                    label: "Terms",
                    value: "This gift card is redeemable for merchandise only. Not redeemable for cash."
                }
            ]
        },
        barcode: {
            message: card.code,
            format: "PKBarcodeFormatQR",
            messageEncoding: "iso-8859-1"
        }
    };
}

/**
 * Generate Google Wallet object
 */
function generateGooglePassObject(card) {
    return {
        id: card.code,
        classId: "gift_card_class_id",
        genericType: "GENERIC_TYPE_UNSPECIFIED",
        cardTitle: {
            defaultValue: {
                language: "en-US",
                value: "Gift Card"
            }
        },
        header: {
            defaultValue: {
                language: "en-US",
                value: `$${card.currentBalance.toFixed(2)}`
            }
        },
        barcode: {
            type: "QR_CODE",
            value: card.code
        },
        hexBackgroundColor: "#1a1a1a"
    };
}

module.exports = {
    generateApplePassJSON,
    generateGooglePassObject
};
