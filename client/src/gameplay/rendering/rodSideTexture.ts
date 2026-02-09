import Phaser from 'phaser';

type RodSideTextureResult = {
    width: number;
    height: number;
};

export function buildRodSideTexture(
    textures: Phaser.Textures.TextureManager,
    sourceKey: string,
    targetKey: string
): RodSideTextureResult | null {
    const source = textures.get(sourceKey).getSourceImage() as HTMLImageElement | undefined;
    if (!source) return null;

    const srcW = source.width;
    const srcH = source.height;
    const outW = 1;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return null;
    srcCtx.drawImage(source, 0, 0);

    const srcData = srcCtx.getImageData(0, 0, srcW, srcH);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = srcH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;
    const outData = outCtx.createImageData(outW, srcH);

    for (let y = 0; y < srcH; y++) {
        let first = -1;
        let second = -1;
        for (let x = 0; x < srcW; x++) {
            const idx = (y * srcW + x) * 4;
            if (srcData.data[idx + 3] > 0) {
                if (first === -1) {
                    first = x;
                } else {
                    second = x;
                    break;
                }
            }
        }

        if (first === -1) continue;
        if (second === -1) second = first;

        const idx1 = (y * srcW + first) * 4;
        const idx2 = (y * srcW + second) * 4;
        const r = Math.round((srcData.data[idx1] + srcData.data[idx2]) / 2);
        const g = Math.round((srcData.data[idx1 + 1] + srcData.data[idx2 + 1]) / 2);
        const b = Math.round((srcData.data[idx1 + 2] + srcData.data[idx2 + 2]) / 2);
        const a = Math.round((srcData.data[idx1 + 3] + srcData.data[idx2 + 3]) / 2);

        for (let x = 0; x < outW; x++) {
            const outIdx = (y * outW + x) * 4;
            outData.data[outIdx] = r;
            outData.data[outIdx + 1] = g;
            outData.data[outIdx + 2] = b;
            outData.data[outIdx + 3] = a;
        }
    }

    outCtx.putImageData(outData, 0, 0);

    if (textures.exists(targetKey)) {
        textures.remove(targetKey);
    }
    textures.addCanvas(targetKey, outCanvas);
    textures.get(targetKey).setFilter(Phaser.Textures.FilterMode.NEAREST);

    return { width: outW, height: srcH };
}
