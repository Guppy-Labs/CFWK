import { CharacterService } from './gameplay/player/CharacterService';
import { DEFAULT_CHARACTER_APPEARANCE, ICharacterAppearance } from '@cfwk/shared';
import { Toast } from './ui/Toast';
import { AnimatedCharacterPreview } from './skin/CharacterPreview';

const previewCanvas = document.getElementById('skin-preview-canvas') as HTMLCanvasElement;
let animatedPreview: AnimatedCharacterPreview | null = null;
const bodyPresetsContainer = document.getElementById('body-presets') as HTMLElement;
const eyePresetsContainer = document.getElementById('eye-presets') as HTMLElement;
const accessorySlotsContainer = document.getElementById('accessory-slots') as HTMLElement;
const saveButton = document.getElementById('save-skin-btn') as HTMLButtonElement;

const characterService = CharacterService.getInstance();

const BODY_PRESETS = [
    { id: 'dark', label: 'Shadow', brightnessShift: -60 },
    { id: 'dim', label: 'Dusk', brightnessShift: -30 },
    { id: 'base', label: 'Classic', brightnessShift: 0 },
    { id: 'light', label: 'Sunny', brightnessShift: 30 },
    { id: 'bright', label: 'Cloud', brightnessShift: 60 }
];

// Eye hue offset: adjust this to tune what slider position 0 looks like
// The base eye color is yellow, so offset 0 = yellow at slider center
const EYE_HUE_OFFSET = 120;

// Scarf base color is yellow (hue 0)
const SCARF_COLOR_PRESETS = [
    { id: 'golden', label: 'Golden', hueShift: 0 },
    { id: 'lime', label: 'Lime', hueShift: 60 },
    { id: 'cyan', label: 'Cyan', hueShift: 120 },
    { id: 'blue', label: 'Blue', hueShift: 180 },
    { id: 'pink', label: 'Pink', hueShift: -60 }
];

// Cape base color is brown (hue 0)
const CAPE_COLOR_PRESETS = [
    { id: 'oak', label: 'Oak', hueShift: 0 },
    { id: 'forest', label: 'Forest', hueShift: 60 },
    { id: 'ocean', label: 'Ocean', hueShift: 120 },
    { id: 'plum', label: 'Plum', hueShift: 180 },
    { id: 'crimson', label: 'Crimson', hueShift: -30 }
];

const ACCESSORY_CATALOG = {
    neck: {
        slotLabel: 'Neck',
        items: [
            { id: 'scarf', name: 'Cozy Scarf', unlocked: true }
        ]
    },
    cape: {
        slotLabel: 'Cape',
        items: [
            { id: 'cape', name: 'Traveler Cape', unlocked: true }
        ]
    }
};

type AccessorySlotKey = keyof typeof ACCESSORY_CATALOG;

let currentAppearance: ICharacterAppearance = DEFAULT_CHARACTER_APPEARANCE;

async function ensureAuthenticated() {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
        window.location.href = '/login';
        return null;
    }
    const data = await res.json();
    if (!data.user) {
        window.location.href = '/login';
        return null;
    }
    return data.user;
}

function getPreviewScale(): number {
    return window.innerWidth > 900 ? 8 : 4;
}

async function updatePreview() {
    if (!previewCanvas) return;
    const scale = getPreviewScale();
    if (!animatedPreview) {
        animatedPreview = new AnimatedCharacterPreview(previewCanvas, scale);
    }
    await animatedPreview.setAppearance(currentAppearance, 'S');
    animatedPreview.start();
}

function renderBodyPresets() {
    if (!bodyPresetsContainer) return;
    bodyPresetsContainer.innerHTML = '';

    BODY_PRESETS.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.textContent = preset.label;
        btn.dataset.presetId = preset.id;
        if (currentAppearance.body.brightnessShift === preset.brightnessShift) {
            btn.classList.add('active');
        }
        btn.addEventListener('click', () => {
            currentAppearance = {
                ...currentAppearance,
                body: {
                    ...currentAppearance.body,
                    hueShift: 0,
                    brightnessShift: preset.brightnessShift
                },
                head: {
                    ...currentAppearance.head,
                    brightnessShift: preset.brightnessShift
                }
            };
            renderBodyPresets();
            updatePreview();
        });
        bodyPresetsContainer.appendChild(btn);
    });
}

function renderEyeSlider() {
    if (!eyePresetsContainer) return;
    eyePresetsContainer.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'slider-wrapper';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-180';
    slider.max = '180';
    slider.value = String(currentAppearance.head.hueShift - EYE_HUE_OFFSET);
    slider.className = 'hue-slider';

    let lastUpdate = 0;
    const THROTTLE_MS = 500;

    slider.addEventListener('input', () => {
        const now = Date.now();
        if (now - lastUpdate < THROTTLE_MS) return;
        lastUpdate = now;

        const sliderValue = parseInt(slider.value, 10);
        currentAppearance = {
            ...currentAppearance,
            head: {
                ...currentAppearance.head,
                hueShift: sliderValue + EYE_HUE_OFFSET
            }
        };
        updatePreview();
    });

    // Final update on release to ensure we capture the last value
    slider.addEventListener('change', () => {
        const sliderValue = parseInt(slider.value, 10);
        currentAppearance = {
            ...currentAppearance,
            head: {
                ...currentAppearance.head,
                hueShift: sliderValue + EYE_HUE_OFFSET
            }
        };
        updatePreview();
    });

    wrapper.appendChild(slider);
    eyePresetsContainer.appendChild(wrapper);
}

function renderAccessorySlots() {
    if (!accessorySlotsContainer) return;
    accessorySlotsContainer.innerHTML = '';

    (Object.keys(ACCESSORY_CATALOG) as AccessorySlotKey[]).forEach(slotKey => {
        const slot = ACCESSORY_CATALOG[slotKey];
        const item = slot.items.find(entry => entry.unlocked);
        if (!item) return;

        const equipped = slotKey === 'neck'
            ? currentAppearance.accessories.neck.equipped
            : currentAppearance.accessories.cape.equipped;

        const currentHue = slotKey === 'neck'
            ? currentAppearance.accessories.neck.hueShift
            : currentAppearance.accessories.cape.hueShift;

        const colorPresets = slotKey === 'neck' ? SCARF_COLOR_PRESETS : CAPE_COLOR_PRESETS;

        const wrapper = document.createElement('div');
        wrapper.className = 'accessory-slot';

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.justifyContent = 'space-between';
        topRow.style.width = '100%';

        const info = document.createElement('div');
        info.className = 'accessory-info';
        info.innerHTML = `<strong>${slot.slotLabel}</strong><span style="color: var(--mm-text-muted);">${item.name}</span>`;

        const btn = document.createElement('button');
        btn.className = 'mm-btn mm-btn-secondary';
        btn.textContent = equipped ? 'Unequip' : 'Equip';
        btn.addEventListener('click', () => {
            if (slotKey === 'neck') {
                currentAppearance = {
                    ...currentAppearance,
                    accessories: {
                        ...currentAppearance.accessories,
                        neck: {
                            ...currentAppearance.accessories.neck,
                            itemId: item.id,
                            equipped: !equipped
                        }
                    }
                };
            } else {
                currentAppearance = {
                    ...currentAppearance,
                    accessories: {
                        ...currentAppearance.accessories,
                        cape: {
                            ...currentAppearance.accessories.cape,
                            itemId: item.id,
                            equipped: !equipped
                        }
                    }
                };
            }
            renderAccessorySlots();
            updatePreview();
        });

        topRow.appendChild(info);
        topRow.appendChild(btn);
        wrapper.appendChild(topRow);

        // Add color presets if equipped
        if (equipped) {
            const colorRow = document.createElement('div');
            colorRow.className = 'preset-grid';
            colorRow.style.marginTop = '0.75rem';
            colorRow.style.width = '100%';

            colorPresets.forEach(preset => {
                const colorBtn = document.createElement('button');
                colorBtn.className = 'preset-btn';
                colorBtn.textContent = preset.label;
                if (currentHue === preset.hueShift) {
                    colorBtn.classList.add('active');
                }
                colorBtn.addEventListener('click', () => {
                    if (slotKey === 'neck') {
                        currentAppearance = {
                            ...currentAppearance,
                            accessories: {
                                ...currentAppearance.accessories,
                                neck: {
                                    ...currentAppearance.accessories.neck,
                                    hueShift: preset.hueShift
                                }
                            }
                        };
                    } else {
                        currentAppearance = {
                            ...currentAppearance,
                            accessories: {
                                ...currentAppearance.accessories,
                                cape: {
                                    ...currentAppearance.accessories.cape,
                                    hueShift: preset.hueShift
                                }
                            }
                        };
                    }
                    renderAccessorySlots();
                    updatePreview();
                });
                colorRow.appendChild(colorBtn);
            });

            wrapper.appendChild(colorRow);
        }

        accessorySlotsContainer.appendChild(wrapper);
    });
}

async function saveAppearance() {
    saveButton.disabled = true;
    const ok = await characterService.updateAppearance(currentAppearance);
    if (ok) {
        Toast.success('Skin updated');
    } else {
        Toast.error('Failed to update skin');
    }
    saveButton.disabled = false;
}

async function init() {
    const user = await ensureAuthenticated();
    if (!user) return;

    try {
        currentAppearance = await characterService.fetchAppearance();
    } catch {
        currentAppearance = DEFAULT_CHARACTER_APPEARANCE;
    }

    renderBodyPresets();
    renderEyeSlider();
    renderAccessorySlots();
    await updatePreview();

    if (saveButton) {
        saveButton.addEventListener('click', saveAppearance);
    }
}

init();
