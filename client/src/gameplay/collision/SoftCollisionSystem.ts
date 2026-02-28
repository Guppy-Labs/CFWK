import { MCPlayerController } from '../player/MCPlayerController';
import { RemotePlayerManager } from '../player/RemotePlayerManager';
import { AINpcManager } from '../ai/AINpcManager';
import { NPCManager } from '../npc/NPCManager';
import { SOFT_COLLISION_FORCE } from '@cfwk/shared';

type SoftBodyKind = 'local-player' | 'remote-player' | 'npc' | 'ai-npc';

type SoftBody = {
    key: string;
    kind: SoftBodyKind;
    x: number;
    y: number;
    halfWidth: number;
    halfHeight: number;
    pushX: number;
    pushY: number;
    applyNudge: (dx: number, dy: number) => void;
};

export class SoftCollisionSystem {
    private mcPlayerController: MCPlayerController;
    private remotePlayerManager?: RemotePlayerManager;
    private npcManager?: NPCManager;
    private aiNpcManager?: AINpcManager;

    constructor(
        mcPlayerController: MCPlayerController,
        remotePlayerManager?: RemotePlayerManager,
        npcManager?: NPCManager,
        aiNpcManager?: AINpcManager
    ) {
        this.mcPlayerController = mcPlayerController;
        this.remotePlayerManager = remotePlayerManager;
        this.npcManager = npcManager;
        this.aiNpcManager = aiNpcManager;
    }

    updateBindings(remotePlayerManager?: RemotePlayerManager, npcManager?: NPCManager, aiNpcManager?: AINpcManager) {
        this.remotePlayerManager = remotePlayerManager;
        this.npcManager = npcManager;
        this.aiNpcManager = aiNpcManager;
    }

    update() {
        const bodies = this.collectBodies();
        if (bodies.length < 2) return;

        for (let i = 0; i < bodies.length; i += 1) {
            const a = bodies[i];
            for (let j = i + 1; j < bodies.length; j += 1) {
                const b = bodies[j];

                if (!this.shouldResolveClientPair(a.kind, b.kind)) continue;

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const absDx = Math.abs(dx);
                const absDy = Math.abs(dy);
                const overlapX = (a.halfWidth + b.halfWidth) - absDx;
                const overlapY = (a.halfHeight + b.halfHeight) - absDy;
                if (overlapX <= 0 || overlapY <= 0) continue;

                let dirX = dx;
                let dirY = dy;
                const dist = Math.hypot(dirX, dirY);
                if (dist > SOFT_COLLISION_FORCE.epsilon) {
                    dirX /= dist;
                    dirY /= dist;
                } else {
                    dirX = a.key < b.key ? 1 : -1;
                    dirY = 0;
                }

                const minOverlap = Math.min(overlapX, overlapY);
                const overlapRatio = Math.min(
                    overlapX / Math.max(1, a.halfWidth + b.halfWidth),
                    overlapY / Math.max(1, a.halfHeight + b.halfHeight)
                );
                const pushMagnitude = Math.min(
                    SOFT_COLLISION_FORCE.maxPushPerStep,
                    minOverlap * SOFT_COLLISION_FORCE.pushScalar * (0.45 + overlapRatio * 0.55)
                );

                const pushX = dirX * pushMagnitude;
                const pushY = dirY * pushMagnitude;

                a.pushX -= pushX * 0.5;
                a.pushY -= pushY * 0.5;
                b.pushX += pushX * 0.5;
                b.pushY += pushY * 0.5;
            }
        }

        bodies.forEach((body) => {
            if (Math.hypot(body.pushX, body.pushY) <= SOFT_COLLISION_FORCE.epsilon) return;
            body.applyNudge(body.pushX, body.pushY);
        });
    }

    private shouldResolveClientPair(a: SoftBodyKind, b: SoftBodyKind): boolean {
        return a === 'local-player'
            || b === 'local-player'
            || a === 'npc'
            || b === 'npc';
    }

    private collectBodies(): SoftBody[] {
        const bodies: SoftBody[] = [];

        if (this.mcPlayerController.isAfkGhosted()) {
            return bodies;
        }

        const local = this.mcPlayerController.getSoftCollisionFootprint();
        if (local) {
            bodies.push({
                key: 'local-player',
                kind: 'local-player',
                x: local.x,
                y: local.y,
                halfWidth: Math.max(1, local.width) / 2,
                halfHeight: Math.max(1, local.height) / 2,
                pushX: 0,
                pushY: 0,
                applyNudge: (dx, dy) => this.mcPlayerController.applySoftCollisionNudge(dx, dy)
            });
        }

        this.remotePlayerManager?.getPlayers().forEach((remote, sessionId) => {
            if (remote.isAfkGhosted()) return;
            const footprint = remote.getSoftCollisionFootprint();
            if (!footprint) return;
            bodies.push({
                key: `remote:${sessionId}`,
                kind: 'remote-player',
                x: footprint.x,
                y: footprint.y,
                halfWidth: Math.max(1, footprint.width) / 2,
                halfHeight: Math.max(1, footprint.height) / 2,
                pushX: 0,
                pushY: 0,
                applyNudge: (dx, dy) => remote.applySoftCollisionNudge(dx, dy)
            });
        });

        this.aiNpcManager?.getEntities().forEach((entity, id) => {
            const footprint = entity.getSoftCollisionFootprint();
            if (!footprint) return;
            bodies.push({
                key: `ai:${id}`,
                kind: 'ai-npc',
                x: footprint.x,
                y: footprint.y,
                halfWidth: Math.max(1, footprint.width) / 2,
                halfHeight: Math.max(1, footprint.height) / 2,
                pushX: 0,
                pushY: 0,
                applyNudge: (dx, dy) => entity.applySoftCollisionNudge(dx, dy)
            });
        });

        this.npcManager?.getSoftCollisionBodies().forEach((npc) => {
            bodies.push({
                key: `npc:${npc.id}`,
                kind: 'npc',
                x: npc.x,
                y: npc.y,
                halfWidth: Math.max(1, npc.width) / 2,
                halfHeight: Math.max(1, npc.height) / 2,
                pushX: 0,
                pushY: 0,
                applyNudge: (dx, dy) => this.npcManager?.applySoftCollisionNudge(npc.id, dx, dy)
            });
        });

        return bodies;
    }
}
