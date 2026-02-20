import { Vec2 } from './types';

type GridNode = { x: number; y: number };

const DIRECTIONS: Array<{ dx: number; dy: number; cost: number }> = [
    { dx: 1, dy: 0, cost: 1 },
    { dx: -1, dy: 0, cost: 1 },
    { dx: 0, dy: 1, cost: 1 },
    { dx: 0, dy: -1, cost: 1 },
    { dx: 1, dy: 1, cost: Math.SQRT2 },
    { dx: 1, dy: -1, cost: Math.SQRT2 },
    { dx: -1, dy: 1, cost: Math.SQRT2 },
    { dx: -1, dy: -1, cost: Math.SQRT2 }
];

function keyFor(x: number, y: number): string {
    return `${x},${y}`;
}

function heuristic(a: GridNode, b: GridNode): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function findPathAStar(
    start: GridNode,
    goal: GridNode,
    canWalk: (x: number, y: number) => boolean,
    maxExpandedNodes = 2500
): GridNode[] {
    if (!canWalk(start.x, start.y) || !canWalk(goal.x, goal.y)) {
        return [];
    }

    const openSet = new Set<string>();
    const openMap = new Map<string, GridNode>();
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();
    const closedSet = new Set<string>();
    const startKey = keyFor(start.x, start.y);
    openSet.add(startKey);
    openMap.set(startKey, start);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(start, goal));

    let expanded = 0;

    while (openSet.size > 0 && expanded < maxExpandedNodes) {
        expanded += 1;

        let currentKey: string | null = null;
        let currentNode: GridNode | null = null;

        for (const candidateKey of openSet) {
            const candidate = openMap.get(candidateKey);
            if (!candidate) continue;
            const candidateScore = fScore.get(candidateKey) ?? Number.POSITIVE_INFINITY;
            const currentScore = currentKey ? (fScore.get(currentKey) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
            if (!currentNode || candidateScore < currentScore) {
                currentNode = candidate;
                currentKey = candidateKey;
            }
        }

        if (!currentNode || !currentKey) break;

        if (currentNode.x === goal.x && currentNode.y === goal.y) {
            const path: GridNode[] = [{ x: currentNode.x, y: currentNode.y }];
            let walkKey = currentKey;

            while (walkKey && cameFrom.has(walkKey)) {
                const parentKey = cameFrom.get(walkKey);
                if (!parentKey) break;
                const parent = openMap.get(parentKey);
                if (!parent) break;
                path.push({ x: parent.x, y: parent.y });
                walkKey = parentKey;
            }

            return path.reverse();
        }

        openSet.delete(currentKey);
        closedSet.add(currentKey);

        for (const direction of DIRECTIONS) {
            const nx = currentNode.x + direction.dx;
            const ny = currentNode.y + direction.dy;
            const nKey = keyFor(nx, ny);

            if (!canWalk(nx, ny) || closedSet.has(nKey)) {
                continue;
            }

            if (direction.dx !== 0 && direction.dy !== 0) {
                if (!canWalk(currentNode.x + direction.dx, currentNode.y) || !canWalk(currentNode.x, currentNode.y + direction.dy)) {
                    continue;
                }
            }

            const currentG = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;
            const tentativeG = currentG + direction.cost;
            const neighborG = gScore.get(nKey) ?? Number.POSITIVE_INFINITY;

            if (tentativeG < neighborG) {
                cameFrom.set(nKey, currentKey);
                gScore.set(nKey, tentativeG);
                fScore.set(nKey, tentativeG + heuristic({ x: nx, y: ny }, goal));
                openMap.set(nKey, { x: nx, y: ny });
                openSet.add(nKey);
            }
        }
    }

    return [];
}

export function compressPath(path: Vec2[]): Vec2[] {
    if (path.length <= 2) return path;

    const compressed: Vec2[] = [path[0]];

    let prevDx = path[1].x - path[0].x;
    let prevDy = path[1].y - path[0].y;

    for (let index = 2; index < path.length; index += 1) {
        const dx = path[index].x - path[index - 1].x;
        const dy = path[index].y - path[index - 1].y;
        if (dx !== prevDx || dy !== prevDy) {
            compressed.push(path[index - 1]);
            prevDx = dx;
            prevDy = dy;
        }
    }

    compressed.push(path[path.length - 1]);
    return compressed;
}
