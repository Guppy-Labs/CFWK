/**
 * ColorShift - Utility module for applying hue and brightness shifts to images
 * 
 * Used by CharacterCompositor to customize character appearance before compositing.
 * Works at the pixel level using canvas ImageData manipulation.
 * 
 * Note: Database stores integers:
 * - hueShift: -180 to 180 (degrees)
 * - brightnessShift: -100 to 100 (scaled to -1 to 1 internally)
 */

/**
 * Apply hue and brightness shifts to an image
 * @param sourceImage The source HTMLImageElement to process
 * @param hueShift Hue rotation in degrees (-180 to 180)
 * @param brightnessShift Brightness adjustment (-100 to 100, will be scaled to -1 to 1)
 * @returns A new canvas with the shifted colors
 */
export function applyColorShift(
    sourceImage: HTMLImageElement,
    hueShift: number,
    brightnessShift: number
): HTMLCanvasElement {
    // Create a canvas matching the source dimensions
    const canvas = document.createElement('canvas');
    canvas.width = sourceImage.width;
    canvas.height = sourceImage.height;
    const ctx = canvas.getContext('2d')!;

    // Draw the source image to the canvas
    ctx.drawImage(sourceImage, 0, 0);

    // If no shifts needed, return as-is
    if (hueShift === 0 && brightnessShift === 0) {
        return canvas;
    }

    // Scale brightness from integer range (-100 to 100) to float range (-1 to 1)
    const scaledBrightness = brightnessShift / 100;

    // Get the pixel data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        // Skip fully transparent pixels
        if (a === 0) continue;

        // Convert RGB to HSL
        const [h, s, l] = rgbToHsl(r, g, b);

        // Apply hue shift (normalized to 0-1)
        let newH = h + (hueShift / 360);
        // Wrap hue around 0-1
        while (newH < 0) newH += 1;
        while (newH > 1) newH -= 1;

        // Apply brightness shift (adjust lightness)
        // scaledBrightness of 1 = fully white, -1 = fully black
        let newL = l + scaledBrightness * 0.5; // Scale effect to be more subtle
        newL = Math.max(0, Math.min(1, newL)); // Clamp to 0-1

        // Convert back to RGB
        const [newR, newG, newB] = hslToRgb(newH, s, newL);

        data[i] = newR;
        data[i + 1] = newG;
        data[i + 2] = newB;
        // Alpha stays the same
    }

    // Put the modified data back
    ctx.putImageData(imageData, 0, 0);

    return canvas;
}

/**
 * Convert RGB values to HSL
 * @param r Red (0-255)
 * @param g Green (0-255)
 * @param b Blue (0-255)
 * @returns [h, s, l] where h is 0-1, s is 0-1, l is 0-1
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                break;
            case g:
                h = ((b - r) / d + 2) / 6;
                break;
            case b:
                h = ((r - g) / d + 4) / 6;
                break;
        }
    }

    return [h, s, l];
}

/**
 * Convert HSL values to RGB
 * @param h Hue (0-1)
 * @param s Saturation (0-1)
 * @param l Lightness (0-1)
 * @returns [r, g, b] where each is 0-255
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r: number, g: number, b: number;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number): number => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [
        Math.round(r * 255),
        Math.round(g * 255),
        Math.round(b * 255)
    ];
}

/**
 * Apply color shift to an image and return it as an HTMLImageElement
 * Useful when you need to maintain the HTMLImageElement interface
 */
export function applyColorShiftToImage(
    sourceImage: HTMLImageElement,
    hueShift: number,
    brightnessShift: number
): HTMLCanvasElement {
    return applyColorShift(sourceImage, hueShift, brightnessShift);
}
