export class Toast {
    private static container: HTMLElement | null = null;
    private static isBottomMode = false;

    private static init() {
        if (!this.container) {
            this.container = document.getElementById('toast-container');
            if(!this.container){
                this.container = document.createElement('div');
                this.container.id = 'toast-container';
                document.body.appendChild(this.container);
            }
        }
        
        // Position container based on navbar presence
        this.updatePosition();
    }

    private static updatePosition() {
        if (!this.container) return;
        
        // Find navbar - try common selectors
        const navbar = document.querySelector('.game-navbar, .navbar, nav, header') as HTMLElement | null;
        if (navbar) {
            // Has navbar: position below it, top-center
            const navbarRect = navbar.getBoundingClientRect();
            this.container.style.top = `${navbarRect.bottom}px`;
            this.container.style.bottom = '';
            this.container.style.right = '';
            this.container.style.left = '0';
            this.container.style.alignItems = 'center';
            this.container.classList.remove('bottom-mode');
            this.isBottomMode = false;
        } else {
            // No navbar: position bottom-right
            this.container.style.top = '';
            this.container.style.bottom = '0';
            this.container.style.right = '20px';
            this.container.style.left = '';
            this.container.style.width = 'auto';
            this.container.style.alignItems = 'flex-end';
            this.container.classList.add('bottom-mode');
            this.isBottomMode = true;
        }
    }

    static show(message: string, type: 'error' | 'success' | 'info' = 'info', duration = 5000) {
        this.init();
        
        // Create wrapper for chains + toast
        const wrapper = document.createElement('div');
        wrapper.className = this.isBottomMode ? 'toast-wrapper bottom' : 'toast-wrapper';
        
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

        const isBottom = this.isBottomMode;
        setTimeout(() => {
            wrapper.style.animation = isBottom 
                ? 'toast-outer-bottom 0.5s forwards' 
                : 'toast-outer 0.5s forwards';
            wrapper.addEventListener('animationend', () => {
                wrapper.remove();
            });
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
}
