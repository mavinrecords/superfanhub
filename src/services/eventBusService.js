/**
 * Event Bus Service - Mavin Community Task Master
 * In-process EventEmitter for event-driven automation.
 * Listens to Social Hub events and triggers task evaluation.
 */

const EventEmitter = require('events');

class MavinEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);
        this._initialized = false;
    }

    initialize() {
        if (this._initialized) return;
        this._initialized = true;
        console.log('⚡ Event Bus initialized');
    }

    // Emit standard events
    emitUGCCreated(userId, data) {
        this.emit('ugc:created', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitContentShared(userId, data) {
        this.emit('content:shared', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitArtistHubJoined(userId, data) {
        this.emit('artist_hub:joined', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitQRScanned(userId, data) {
        this.emit('qr:scanned', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitCampaignInteraction(userId, data) {
        this.emit('campaign:interacted', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitStreamingActivity(userId, data) {
        this.emit('streaming:activity', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitTaskCompleted(userId, data) {
        this.emit('task:completed', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitReferralCompleted(userId, data) {
        this.emit('referral:completed', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitStreakUpdated(userId, data) {
        this.emit('streak:updated', { userId, ...data, timestamp: new Date().toISOString() });
    }

    emitTierChanged(userId, data) {
        this.emit('tier:changed', { userId, ...data, timestamp: new Date().toISOString() });
    }
}

// Singleton
const eventBus = new MavinEventBus();

module.exports = { eventBus };
