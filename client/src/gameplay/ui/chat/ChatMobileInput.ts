type MobileInputCallbacks = {
    onInput: (value: string) => void;
    onSubmit: () => void;
    onBlur: () => void;
};

export class ChatMobileInput {
    private mobileInput: HTMLInputElement | null = null;

    constructor(private readonly maxInputLength: number) {}

    show(currentValue: string, callbacks: MobileInputCallbacks) {
        this.remove();

        const gameContainer = document.getElementById('app') || document.body;

        const form = document.createElement('form');
        form.action = 'javascript:void(0);';
        form.style.cssText = `
            position: fixed;
            top: 0px;
            left: 0px;
            width: 1px;
            height: 1px;
            opacity: 0;
            z-index: -1;
            overflow: hidden;
        `;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue;
        input.autocomplete = 'off';
        input.autocapitalize = 'off';
        input.spellcheck = false;
        input.style.cssText = `
            font-size: 16px;
            width: 100%;
            height: 100%;
            border: 0;
            outline: 0;
            margin: 0;
            padding: 0;
            pointer-events: auto;
        `;

        form.appendChild(input);
        gameContainer.appendChild(form);
        this.mobileInput = input;

        let isHandlingSubmit = false;

        const handleInput = () => {
            if (isHandlingSubmit) return;
            if (input.value.length > this.maxInputLength) {
                input.value = input.value.substring(0, this.maxInputLength);
            }
            callbacks.onInput(input.value);
        };

        const handleSubmit = (e?: Event) => {
            e?.preventDefault();
            if (isHandlingSubmit) return;
            isHandlingSubmit = true;
            callbacks.onSubmit();
        };

        const handleKeydown = (e: KeyboardEvent) => {
            e.stopPropagation();
        };

        const handleBlur = () => {
            setTimeout(() => {
                if (isHandlingSubmit) return;
                callbacks.onBlur();
            }, 50);
        };

        input.addEventListener('input', handleInput);
        input.addEventListener('blur', handleBlur);
        input.addEventListener('keydown', handleKeydown);
        form.addEventListener('submit', handleSubmit);
        form.onsubmit = (e) => {
            e.preventDefault();
            handleSubmit(e);
            return false;
        };

        try {
            input.focus();
            input.click();
        } catch (e) {
            console.error('Failed to focus mobile input:', e);
        }
    }

    setValue(value: string) {
        if (this.mobileInput) {
            this.mobileInput.value = value;
        }
    }

    isActive() {
        return Boolean(this.mobileInput);
    }

    remove() {
        if (!this.mobileInput) return;
        const input = this.mobileInput;
        const form = input.parentElement;
        this.mobileInput = null;

        try {
            input.blur();
        } catch (_e) {}

        if (form && form.parentNode) {
            form.parentNode.removeChild(form);
        } else if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
    }
}
