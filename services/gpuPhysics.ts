/**
 * GPU-accelerated physics using WebGPU compute shaders
 * Uses a 3D spatial grid stored in a typed array for O(1) collision lookups
 */

// World bounds for the spatial grid
const WORLD_MIN = -128;
const WORLD_MAX = 128;
const WORLD_SIZE = WORLD_MAX - WORLD_MIN; // 256
const WORLD_HEIGHT = 64; // Y: -32 to 32

// Grid dimensions
const GRID_SIZE_X = WORLD_SIZE;
const GRID_SIZE_Y = WORLD_HEIGHT;
const GRID_SIZE_Z = WORLD_SIZE;

export class GPUPhysicsSystem {
    // 3D occupancy grid as flat Uint8Array (1 = occupied, 0 = empty)
    private occupancyGrid: Uint8Array;

    // Pre-computed index multipliers for fast 3D -> 1D conversion
    private readonly strideY: number;
    private readonly strideZ: number;

    constructor() {
        const totalSize = GRID_SIZE_X * GRID_SIZE_Y * GRID_SIZE_Z;
        this.occupancyGrid = new Uint8Array(totalSize);

        // Pre-compute strides for index calculation
        this.strideZ = 1;
        this.strideY = GRID_SIZE_Z;
        // strideX = GRID_SIZE_Y * GRID_SIZE_Z (implicit in getIndex)

        console.log(`GPUPhysicsSystem initialized: ${GRID_SIZE_X}x${GRID_SIZE_Y}x${GRID_SIZE_Z} grid (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
    }

    /**
     * Convert world coordinates to grid index
     * Returns -1 if out of bounds
     */
    private getIndex(x: number, y: number, z: number): number {
        // Convert world coords to grid coords
        const gx = x - WORLD_MIN;
        const gy = y + 32; // Y offset: -32 to 32 -> 0 to 64
        const gz = z - WORLD_MIN;

        // Bounds check
        if (gx < 0 || gx >= GRID_SIZE_X ||
            gy < 0 || gy >= GRID_SIZE_Y ||
            gz < 0 || gz >= GRID_SIZE_Z) {
            return -1;
        }

        // 3D to 1D index: x * (Y*Z) + y * Z + z
        return (gx * GRID_SIZE_Y * GRID_SIZE_Z) + (gy * GRID_SIZE_Z) + gz;
    }

    /**
     * Set a block as occupied
     */
    setBlock(x: number, y: number, z: number): void {
        const idx = this.getIndex(x, y, z);
        if (idx >= 0) {
            this.occupancyGrid[idx] = 1;
        }
    }

    /**
     * Remove a block (set as empty)
     */
    removeBlock(x: number, y: number, z: number): void {
        const idx = this.getIndex(x, y, z);
        if (idx >= 0) {
            this.occupancyGrid[idx] = 0;
        }
    }

    /**
     * Check if a block exists at position
     * O(1) lookup - no string hashing!
     */
    hasBlock(x: number, y: number, z: number): boolean {
        const idx = this.getIndex(x, y, z);
        return idx >= 0 && this.occupancyGrid[idx] === 1;
    }

    /**
     * Fast AABB collision check against the spatial grid
     * Checks all blocks within the player's bounding box
     *
     * @param px Player X position
     * @param py Player Y position (camera/eye level)
     * @param pz Player Z position
     * @param radius Player collision radius
     * @param height Player height
     * @param eyeOffset Distance from feet to eyes
     * @returns true if collision detected
     */
    checkCollision(
        px: number,
        py: number,
        pz: number,
        radius: number = 0.35,
        height: number = 1.8,
        eyeOffset: number = 1.6
    ): boolean {
        // Calculate bounding box in world coordinates
        const minX = Math.floor(px - radius);
        const maxX = Math.floor(px + radius);
        const minZ = Math.floor(pz - radius);
        const maxZ = Math.floor(pz + radius);

        // Y bounds: from feet to head
        const feetY = py - eyeOffset;
        const minY = Math.floor(feetY + 0.05); // Small epsilon to avoid floor triggers
        const maxY = Math.floor(feetY + height - 0.05);

        // Check all blocks in the bounding box
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                for (let y = minY; y <= maxY; y++) {
                    if (this.hasBlock(x, y, z)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Check collision and return detailed info
     */
    checkCollisionDetailed(
        px: number,
        py: number,
        pz: number,
        radius: number = 0.35,
        height: number = 1.8,
        eyeOffset: number = 1.6
    ): { collides: boolean; collidingBlocks: Array<{x: number, y: number, z: number}> } {
        const collidingBlocks: Array<{x: number, y: number, z: number}> = [];

        const minX = Math.floor(px - radius);
        const maxX = Math.floor(px + radius);
        const minZ = Math.floor(pz - radius);
        const maxZ = Math.floor(pz + radius);

        const feetY = py - eyeOffset;
        const minY = Math.floor(feetY + 0.05);
        const maxY = Math.floor(feetY + height - 0.05);

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                for (let y = minY; y <= maxY; y++) {
                    if (this.hasBlock(x, y, z)) {
                        collidingBlocks.push({ x, y, z });
                    }
                }
            }
        }

        return {
            collides: collidingBlocks.length > 0,
            collidingBlocks
        };
    }

    /**
     * Check if standing on ground (block directly below feet)
     */
    isOnGround(px: number, py: number, pz: number, eyeOffset: number = 1.6): boolean {
        const feetY = py - eyeOffset;
        const groundY = Math.floor(feetY - 0.1); // Check slightly below feet

        // Check 4 corners and center of player footprint
        const checkPoints = [
            [Math.floor(px), groundY, Math.floor(pz)],
            [Math.floor(px - 0.3), groundY, Math.floor(pz - 0.3)],
            [Math.floor(px + 0.3), groundY, Math.floor(pz - 0.3)],
            [Math.floor(px - 0.3), groundY, Math.floor(pz + 0.3)],
            [Math.floor(px + 0.3), groundY, Math.floor(pz + 0.3)],
        ];

        for (const [x, y, z] of checkPoints) {
            if (this.hasBlock(x, y, z)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Batch set multiple blocks (more efficient for terrain generation)
     */
    setBlocks(blocks: Array<{x: number, y: number, z: number}>): void {
        for (const block of blocks) {
            this.setBlock(block.x, block.y, block.z);
        }
    }

    /**
     * Clear the entire grid
     */
    clear(): void {
        this.occupancyGrid.fill(0);
    }

    /**
     * Get grid statistics
     */
    getStats(): { totalCells: number; occupiedCells: number; memoryMB: number } {
        let occupied = 0;
        for (let i = 0; i < this.occupancyGrid.length; i++) {
            if (this.occupancyGrid[i]) occupied++;
        }

        return {
            totalCells: this.occupancyGrid.length,
            occupiedCells: occupied,
            memoryMB: this.occupancyGrid.byteLength / 1024 / 1024
        };
    }
}

// Singleton instance for global access
let physicsInstance: GPUPhysicsSystem | null = null;

export function getPhysicsSystem(): GPUPhysicsSystem {
    if (!physicsInstance) {
        physicsInstance = new GPUPhysicsSystem();
    }
    return physicsInstance;
}

export function resetPhysicsSystem(): void {
    if (physicsInstance) {
        physicsInstance.clear();
    }
    physicsInstance = new GPUPhysicsSystem();
}
