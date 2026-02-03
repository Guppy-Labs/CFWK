export class Toast {
    private static container: HTMLElement | null = null;
    private static readonly MAX_VISIBLE_TOASTS = 4;

    private static init() {
        if (!this.container) {
            this.container = document.getElementById('toast-container');
            if(!this.container){
                this.container = document.createElement('div');
                this.container.id = 'toast-container';
                document.body.appendChild(this.container);
            }
        }
        
        // Position container at bottom-right
        this.updatePosition();
    }

    private static updatePosition() {
        if (!this.container) return;
        
        // Always position bottom-right
        this.container.style.top = '';
        this.container.style.bottom = '0';
        this.container.style.right = '20px';
        this.container.style.left = '';
        this.container.style.width = 'auto';
        this.container.style.alignItems = 'flex-end';
        this.container.classList.add('bottom-mode');
    }

    static show(message: string, type: 'error' | 'success' | 'info' = 'info', duration = 5000) {
        this.init();
        
        // Create wrapper for chains + toast
        const wrapper = document.createElement('div');
        wrapper.className = 'toast-wrapper bottom';
        
        // Left chain
        const leftChain = document.createElement('img');
        leftChain.src = '/assets/ui/toast-chain.png';
        leftChain.className = 'toast-chain toast-chain-left';
        leftChain.alt = '';
        
        // Right chain
        const rightChain = document.createElement('img');
        rightChain.src = '/assets/ui/toast-chain.png';
        rightChain.className = 'toast-chain toast-chain-right';
        rightChain.alt = '';
        
        // Toast element
        const toast = document.createElement('div');
        toast.className = `mm-toast ${type}`;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = message;
        toast.appendChild(textSpan);
        
        wrapper.appendChild(leftChain);
        wrapper.appendChild(rightChain);
        wrapper.appendChild(toast);

        this.container?.appendChild(wrapper);
        if (this.container) {
            // Limit visible toasts - hide oldest if exceeding max
            this.enforceMaxToasts();
            // Recalculate z-indices for all visible toasts
            this.updateZIndices();
        }

        setTimeout(() => {
            const currentHeight = wrapper.offsetHeight;
            const slideDistance = currentHeight + 40;
            wrapper.style.height = `${currentHeight}px`;
            wrapper.style.transition = 'height 0.5s ease, margin 0.5s ease, transform 0.5s ease';

            requestAnimationFrame(() => {
                wrapper.style.height = '0px';
                wrapper.style.marginBottom = '0px';
                wrapper.style.marginTop = '0px';
                // Always slide down (bottom mode)
                wrapper.style.transform = `translateY(${slideDistance}px)`;
            });

            const onDone = () => {
                wrapper.removeEventListener('transitionend', onDone);
                wrapper.remove();
            };
            wrapper.addEventListener('transitionend', onDone);
        }, duration);
    }
    
    static error(message: string, duration = 6000) { 
        this.show(message, 'error', duration); 
    }
    
    static success(message: string, duration = 5000) { 
        this.show(message, 'success', duration); 
    }
    
    static info(message: string, duration = 5000) { 
        this.show(message, 'info', duration); 
    }

    private static updateZIndices() {
        if (!this.container) return;
        
        const toasts = Array.from(this.container.children) as HTMLElement[];
        // Only consider visible (non-hiding) toasts for z-index
        const visibleToasts = toasts.filter(t => !t.style.transform);
        
        visibleToasts.forEach((wrapper, index) => {
            wrapper.style.zIndex = String(1000 - index);
        });
    }

    private static enforceMaxToasts() {
        if (!this.container) return;
        
        const toasts = Array.from(this.container.children) as HTMLElement[];
        // Find toasts that aren't already hiding (no transform applied yet)
        const visibleToasts = toasts.filter(t => !t.style.transform);
        
        while (visibleToasts.length > this.MAX_VISIBLE_TOASTS) {
            const oldest = visibleToasts.shift();
            if (oldest) {
                this.hideToast(oldest);
            }
        }
    }

    private static hideToast(wrapper: HTMLElement) {
        const currentHeight = wrapper.offsetHeight;
        const slideDistance = currentHeight + 40;
        
        wrapper.style.height = `${currentHeight}px`;
        wrapper.style.transition = 'height 0.5s ease, margin 0.5s ease, transform 0.5s ease';

        requestAnimationFrame(() => {
            wrapper.style.height = '0px';
            wrapper.style.marginBottom = '0px';
            wrapper.style.marginTop = '0px';
            // Always slide down (bottom mode)
            wrapper.style.transform = `translateY(${slideDistance}px)`;
        });

        const onDone = () => {
            wrapper.removeEventListener('transitionend', onDone);
            wrapper.remove();
        };
        wrapper.addEventListener('transitionend', onDone);
    }
}
