/**
 * Scratch-to-Reveal Animation
 * Canvas-based scratch effect for revealing gift card values
 */

class ScratchCard {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.options = {
            width: options.width || 300,
            height: options.height || 150,
            coverColor: options.coverColor || '#A2812E',
            brushSize: options.brushSize || 40,
            revealThreshold: options.revealThreshold || 50,
            onReveal: options.onReveal || (() => { }),
            ...options
        };

        this.isRevealed = false;
        this.percentScratched = 0;

        this.init();
    }

    init() {
        // Create wrapper
        this.wrapper = document.createElement('div');
        this.wrapper.style.cssText = `
            position: relative;
            width: ${this.options.width}px;
            height: ${this.options.height}px;
            margin: 0 auto;
            border-radius: 12px;
            overflow: hidden;
        `;

        // Create content layer (what's revealed underneath)
        this.contentLayer = document.createElement('div');
        this.contentLayer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);
            color: #fff;
            font-family: inherit;
        `;
        this.contentLayer.innerHTML = this.options.content || `
            <div style="font-size: 0.8rem; color: #888; margin-bottom: 8px;">Your Balance</div>
            <div style="font-size: 2rem; font-weight: 700; color: #10b981;">$0.00</div>
        `;

        // Create canvas layer
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.options.width;
        this.canvas.height = this.options.height;
        this.canvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            cursor: crosshair;
            border-radius: 12px;
        `;

        this.ctx = this.canvas.getContext('2d');

        // Draw cover with pattern
        this.drawCover();

        // Add elements
        this.wrapper.appendChild(this.contentLayer);
        this.wrapper.appendChild(this.canvas);
        this.container.appendChild(this.wrapper);

        // Bind events
        this.bindEvents();
    }

    drawCover() {
        const ctx = this.ctx;
        const { width, height, coverColor } = this.options;

        // Gradient background
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, coverColor);
        gradient.addColorStop(1, this.adjustColor(coverColor, -30));

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Add pattern overlay
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        for (let x = 0; x < width; x += 20) {
            for (let y = 0; y < height; y += 20) {
                if ((x + y) % 40 === 0) {
                    ctx.fillRect(x, y, 10, 10);
                }
            }
        }

        // Add text
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✨ SCRATCH TO REVEAL ✨', width / 2, height / 2);
    }

    adjustColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
        const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
        const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
        return `rgb(${r}, ${g}, ${b})`;
    }

    bindEvents() {
        let isDrawing = false;

        const scratch = (e) => {
            if (!isDrawing) return;

            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
            const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.beginPath();
            this.ctx.arc(x, y, this.options.brushSize, 0, Math.PI * 2);
            this.ctx.fill();

            this.checkProgress();
        };

        const startScratch = (e) => {
            isDrawing = true;
            scratch(e);
        };

        const stopScratch = () => {
            isDrawing = false;
        };

        // Mouse events
        this.canvas.addEventListener('mousedown', startScratch);
        this.canvas.addEventListener('mousemove', scratch);
        this.canvas.addEventListener('mouseup', stopScratch);
        this.canvas.addEventListener('mouseleave', stopScratch);

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startScratch(e);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            scratch(e);
        });
        this.canvas.addEventListener('touchend', stopScratch);
    }

    checkProgress() {
        if (this.isRevealed) return;

        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const pixels = imageData.data;
        let transparent = 0;

        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] === 0) transparent++;
        }

        this.percentScratched = (transparent / (pixels.length / 4)) * 100;

        if (this.percentScratched >= this.options.revealThreshold) {
            this.reveal();
        }
    }

    reveal() {
        this.isRevealed = true;

        // Animate canvas fade out
        this.canvas.style.transition = 'opacity 0.5s ease';
        this.canvas.style.opacity = '0';

        setTimeout(() => {
            this.canvas.remove();
        }, 500);

        // Trigger celebration
        this.celebrate();

        // Call callback
        this.options.onReveal();
    }

    celebrate() {
        // Create confetti particles
        const colors = ['#10b981', '#f59e0b', '#A2812E', '#8b5cf6', '#ef4444'];
        const rect = this.wrapper.getBoundingClientRect();

        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: fixed;
                width: 8px;
                height: 8px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                left: ${rect.left + rect.width / 2}px;
                top: ${rect.top + rect.height / 2}px;
                border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                pointer-events: none;
                z-index: 9999;
            `;

            document.body.appendChild(particle);

            const angle = (Math.PI * 2 * i) / 30;
            const velocity = 100 + Math.random() * 100;
            const tx = Math.cos(angle) * velocity;
            const ty = Math.sin(angle) * velocity - 100;

            particle.animate([
                { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                { transform: `translate(${tx}px, ${ty}px) scale(0)`, opacity: 0 }
            ], {
                duration: 800 + Math.random() * 400,
                easing: 'cubic-bezier(0, 0.9, 0.3, 1)'
            }).onfinish = () => particle.remove();
        }
    }

    setContent(html) {
        this.contentLayer.innerHTML = html;
    }

    reset() {
        this.isRevealed = false;
        this.percentScratched = 0;
        this.canvas.style.opacity = '1';
        this.wrapper.appendChild(this.canvas);
        this.ctx.globalCompositeOperation = 'source-over';
        this.drawCover();
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScratchCard;
}
