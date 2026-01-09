export class Toast {
    private static container: HTMLElement | null = null;

    private static init() {
        if (!this.container) {
            this.container = document.getElementById('toast-container');
            if(!this.container){
                this.container = document.createElement('div');
                this.container.id = 'toast-container';
                document.body.appendChild(this.container);
            }
        }
    }

    static show(message: string, type: 'error' | 'success' | 'info' = 'info', duration = 5000) {
        this.init();
        
        const toast = document.createElement('div');
        toast.className = `mm-toast ${type}`;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = message;
        toast.appendChild(textSpan);

        this.container?.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toast-outer 0.3s forwards';
            toast.addEventListener('animationend', () => {
                toast.remove();
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
