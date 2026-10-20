class BytePixel {
    constructor(canvas, context, x, y, color, speed, delay) {
        this.width = canvas.width;
        this.height = canvas.height;
        this.ctx = context;
        this.x = x;
        this.y = y;
        this.color = color;
        this.speed = this.random(0.1, 0.9) * speed;
        this.size = 0;
        this.sizeStep = Math.random() * 0.4;
        this.minSize = 0.5;
        this.maxSizeInteger = 2;
        this.maxSize = this.random(this.minSize, this.maxSizeInteger);
        this.delay = delay;
        this.counter = 0;
        this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01;
        this.isIdle = false;
        this.isReverse = false;
        this.isShimmer = false;
    }

    random(min, max) {
        return Math.random() * (max - min) + min;
    }

    draw() {
        const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5;
        this.ctx.fillStyle = this.color;
        this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size);
    }

    appear() {
        this.isIdle = false;
        if (this.counter <= this.delay) {
            this.counter += this.counterStep;
            return;
        }
        if (this.size >= this.maxSize) {
            this.isShimmer = true;
        }
        if (this.isShimmer) {
            this.shimmer();
        } else {
            this.size += this.sizeStep;
        }
        this.draw();
    }

    disappear() {
        this.isShimmer = false;
        this.counter = 0;
        if (this.size <= 0) {
            this.isIdle = true;
            return;
        }
        this.size -= 0.1;
        this.draw();
    }

    shimmer() {
        if (this.size >= this.maxSize) {
            this.isReverse = true;
        } else if (this.size <= this.minSize) {
            this.isReverse = false;
        }
        this.size += this.isReverse ? -this.speed : this.speed;
    }
}

class PixelCanvas extends HTMLElement {
    static register(tag = "pixel-canvas") {
        if ("customElements" in window && !customElements.get(tag)) {
            customElements.define(tag, this);
        }
    }

    get colors() {
        return this.dataset.colors?.split(",").map((color) => color.trim()) || ["#38bdf8", "#a78bfa", "#34d399"];
    }

    get gap() {
        const value = Number(this.dataset.gap || 6);
        return Math.min(Math.max(value, 4), 50);
    }

    get speed() {
        const value = Number(this.dataset.speed || 35);
        if (this.reducedMotion || value <= 0) return 0;
        return Math.min(value, 100) * 0.001;
    }

    connectedCallback() {
        this.canvas = document.createElement("canvas");
        this.canvas.setAttribute("aria-hidden", "true");
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `<style>:host{display:grid;width:100%;height:100%;overflow:hidden}canvas{width:100%;height:100%;}</style>`;
        this.shadowRoot.append(this.canvas);
        this.ctx = this.canvas.getContext("2d");
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.pixels = [];
        this.isActive = false;
        this.animation = null;

        this.resizeObserver = new ResizeObserver(() => this.initPixels());
        this.resizeObserver.observe(this);
        this.initEvents();
    }

    disconnectedCallback() {
        this.resizeObserver?.disconnect();
        cancelAnimationFrame(this.animation);
    }

    initEvents() {
        const card = this.closest(".mode-card") || this.parentElement;
        card.addEventListener("mouseenter", () => this.start());
        card.addEventListener("mouseleave", () => this.stop());
        card.addEventListener("focusin", () => this.start());
        card.addEventListener("focusout", () => this.stop());
    }

    initPixels() {
        const rect = this.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.pixels = [];

        const width = rect.width;
        const height = rect.height;
        for (let x = 0; x < width; x += this.gap) {
            for (let y = 0; y < height; y += this.gap) {
                const color = this.colors[Math.floor(Math.random() * this.colors.length)];
                const delay = this.getDistanceToCenter(x, y, width, height);
                this.pixels.push(new BytePixel(this.canvas, this.ctx, x, y, color, this.speed, delay));
            }
        }
    }

    getDistanceToCenter(x, y, width, height) {
        const dx = x - width / 2;
        const dy = y - height / 2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    start() {
        this.isActive = true;
        this.animate();
    }

    stop() {
        this.isActive = false;
    }

    animate() {
        cancelAnimationFrame(this.animation);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        let idleCount = 0;

        this.pixels.forEach((pixel) => {
            if (this.isActive) {
                pixel.appear();
            } else {
                pixel.disappear();
                if (pixel.isIdle) idleCount += 1;
            }
        });

        if (this.isActive || idleCount < this.pixels.length) {
            this.animation = requestAnimationFrame(() => this.animate());
        }
    }
}

PixelCanvas.register();
