import { CONTROL_ACTION_KEYS, ControlActionKey, DEFAULT_USER_SETTINGS, IControlsSettings, IUserSettings } from '@cfwk/shared';

type KeybindListener = (bindings: IControlsSettings) => void;

export type KeybindUpdateResult =
    | { ok: true }
    | { ok: false; reason: 'conflict'; conflictWith: ControlActionKey };

export class KeybindManager {
    private static instance: KeybindManager;

    static readonly OVERRIDES_STORAGE_KEY = 'cfwk_controls_overrides';

    private bindings: IControlsSettings = { ...DEFAULT_USER_SETTINGS.controls };
    private pendingOverrides: Partial<IControlsSettings> = {};
    private listeners = new Set<KeybindListener>();

    private readonly downCodes = new Set<string>();
    private readonly pressedCodes = new Set<string>();

    private constructor() {
        this.hydrateOverridesFromStorage();
        this.applyPendingOverrides();

        window.addEventListener('keydown', this.onKeyDown, { capture: true });
        window.addEventListener('keyup', this.onKeyUp, { capture: true });
        window.addEventListener('blur', this.clearRuntimeState);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    static getInstance(): KeybindManager {
        if (!KeybindManager.instance) {
            KeybindManager.instance = new KeybindManager();
        }
        return KeybindManager.instance;
    }

    hydrateFromSettings(settings: IUserSettings | null | undefined) {
        const source = this.normalizeControls(settings?.controls);
        this.bindings = source;
        this.pruneOverridesAgainst(source);
        this.applyPendingOverrides();
        this.emit();
    }

    getBindings(): IControlsSettings {
        return { ...this.bindings };
    }

    getBinding(action: ControlActionKey): string | null {
        return this.bindings[action];
    }

    setBinding(action: ControlActionKey, code: string | null): KeybindUpdateResult {
        const normalizedCode = this.normalizeCode(code);
        if (normalizedCode) {
            const conflictWith = this.findConflict(action, normalizedCode);
            if (conflictWith) {
                return { ok: false, reason: 'conflict', conflictWith };
            }
        }

        this.bindings[action] = normalizedCode;
        this.pendingOverrides[action] = normalizedCode;
        this.persistOverrides();
        this.emit();

        return { ok: true };
    }

    resetAllToDefault() {
        const defaults = this.normalizeControls(DEFAULT_USER_SETTINGS.controls);
        this.bindings = { ...defaults };
        for (const action of CONTROL_ACTION_KEYS) {
            this.pendingOverrides[action] = defaults[action];
        }
        this.persistOverrides();
        this.emit();
    }

    isActionDown(action: ControlActionKey): boolean {
        const code = this.bindings[action];
        return code ? this.downCodes.has(code) : false;
    }

    consumeActionPress(action: ControlActionKey): boolean {
        const code = this.bindings[action];
        if (!code) return false;
        if (!this.pressedCodes.has(code)) return false;
        this.pressedCodes.delete(code);
        return true;
    }

    matchesActionEvent(action: ControlActionKey, event: KeyboardEvent): boolean {
        const code = this.bindings[action];
        return Boolean(code && event.code === code);
    }

    getDisplayLabel(action: ControlActionKey): string {
        return this.formatCode(this.bindings[action]);
    }

    formatCode(code: string | null): string {
        if (!code) return 'Unbound';

        const directMap: Record<string, string> = {
            ArrowUp: '↑',
            ArrowDown: '↓',
            ArrowLeft: '←',
            ArrowRight: '→',
            Space: 'Space',
            ShiftLeft: 'LShift',
            ShiftRight: 'RShift',
            ControlLeft: 'LCtrl',
            ControlRight: 'RCtrl',
            AltLeft: 'LAlt',
            AltRight: 'RAlt',
            MetaLeft: 'LMeta',
            MetaRight: 'RMeta',
            Backspace: 'Backspace',
            Enter: 'Enter',
            Tab: 'Tab',
            Escape: 'Esc',
            Backquote: '`',
            Minus: '-',
            Equal: '=',
            BracketLeft: '[',
            BracketRight: ']',
            Backslash: '\\',
            Semicolon: ';',
            Quote: "'",
            Comma: ',',
            Period: '.',
            Slash: '/',
            CapsLock: 'CapsLock'
        };

        if (directMap[code]) {
            return directMap[code];
        }

        if (code.startsWith('Key') && code.length === 4) {
            return code.slice(3).toUpperCase();
        }

        if (code.startsWith('Digit') && code.length === 6) {
            return code.slice(5);
        }

        if (code.startsWith('Numpad')) {
            return `Num ${code.slice(6)}`;
        }

        return code;
    }

    subscribe(listener: KeybindListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private normalizeControls(controls: Partial<IControlsSettings> | undefined | null): IControlsSettings {
        const next: IControlsSettings = { ...DEFAULT_USER_SETTINGS.controls };
        for (const action of CONTROL_ACTION_KEYS) {
            next[action] = this.normalizeCode(controls?.[action] ?? next[action]);
        }
        return next;
    }

    private normalizeCode(code: string | null | undefined): string | null {
        if (code === null) return null;
        if (typeof code !== 'string') return null;

        const trimmed = code.trim();
        if (!trimmed) return null;
        if (trimmed.length > 32) return null;

        return trimmed;
    }

    private findConflict(action: ControlActionKey, code: string): ControlActionKey | null {
        for (const candidate of CONTROL_ACTION_KEYS) {
            if (candidate === action) continue;
            if (this.bindings[candidate] === code) {
                return candidate;
            }
        }
        return null;
    }

    private emit() {
        const snapshot = this.getBindings();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }

    private applyPendingOverrides() {
        for (const action of CONTROL_ACTION_KEYS) {
            if (!(action in this.pendingOverrides)) continue;
            const override = this.normalizeCode(this.pendingOverrides[action]);
            this.bindings[action] = override;
        }
    }

    private pruneOverridesAgainst(source: IControlsSettings) {
        let changed = false;

        for (const action of CONTROL_ACTION_KEYS) {
            if (!(action in this.pendingOverrides)) continue;
            const override = this.normalizeCode(this.pendingOverrides[action]);
            if (override === source[action]) {
                delete this.pendingOverrides[action];
                changed = true;
            }
        }

        if (changed) {
            this.persistOverrides();
        }
    }

    private hydrateOverridesFromStorage() {
        try {
            const raw = window.localStorage.getItem(KeybindManager.OVERRIDES_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as Partial<IControlsSettings>;
            if (!parsed || typeof parsed !== 'object') return;

            for (const action of CONTROL_ACTION_KEYS) {
                if (!(action in parsed)) continue;
                this.pendingOverrides[action] = this.normalizeCode(parsed[action]);
            }
        } catch {
            this.pendingOverrides = {};
        }
    }

    private persistOverrides() {
        try {
            const payload: Partial<IControlsSettings> = {};
            for (const action of CONTROL_ACTION_KEYS) {
                if (!(action in this.pendingOverrides)) continue;
                payload[action] = this.normalizeCode(this.pendingOverrides[action]);
            }
            window.localStorage.setItem(KeybindManager.OVERRIDES_STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // Ignore storage failures.
        }
    }

    private onKeyDown = (event: KeyboardEvent) => {
        const code = this.normalizeCode(event.code);
        if (!code) return;

        if (!this.downCodes.has(code) && !event.repeat) {
            this.pressedCodes.add(code);
        }

        this.downCodes.add(code);
    };

    private onKeyUp = (event: KeyboardEvent) => {
        const code = this.normalizeCode(event.code);
        if (!code) return;
        this.downCodes.delete(code);
    };

    private clearRuntimeState = () => {
        this.downCodes.clear();
        this.pressedCodes.clear();
    };

    private onVisibilityChange = () => {
        if (document.hidden) {
            this.clearRuntimeState();
        }
    };
}
