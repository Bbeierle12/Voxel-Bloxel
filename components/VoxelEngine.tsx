import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { GameStats, BlockData, GameEngineRef, ItemType, OrbState, OrbMode, Entity, RaycastResult, Vector3, AutonomousOrbState } from '../types';
import { getPhysicsSystem } from '../services/gpuPhysics';

// Texture Generation Utility
function createTexture(color: string, noiseIntensity = 20) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Texture();

    // Base color
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 64, 64);

    // Add noise
    for (let i = 0; i < 400; i++) {
        const x = Math.random() * 64;
        const y = Math.random() * 64;
        const w = Math.random() * 4;
        const h = Math.random() * 4;
        const shade = Math.random() * noiseIntensity - (noiseIntensity / 2);

        ctx.fillStyle = shade > 0 ? `rgba(255,255,255,0.1)` : `rgba(0,0,0,0.1)`;
        ctx.fillRect(x, y, w, h);
    }

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

const textures = {
    grass: createTexture('#5bac38'),
    dirt: createTexture('#8b5a2b'),
    stone: createTexture('#696969'),
    wood: createTexture('#654321'),
    leaf: createTexture('#2d5a27'),
    plank: createTexture('#C19A6B'),
    bedrock: createTexture('#1a1a1a'),
    water: createTexture('#3498db', 5),
    sand: createTexture('#f4d03f', 15),
    snow: createTexture('#ecf0f1', 5),
    sapling: createTexture('#3d8c40', 15)
};

// Use MeshStandardMaterial for better WebGPU support and PBR lighting
const materials = {
    grass: new THREE.MeshStandardMaterial({ map: textures.grass }),
    dirt: new THREE.MeshStandardMaterial({ map: textures.dirt }),
    stone: new THREE.MeshStandardMaterial({ map: textures.stone }),
    wood: new THREE.MeshStandardMaterial({ map: textures.wood }),
    leaf: new THREE.MeshStandardMaterial({ map: textures.leaf, transparent: true, opacity: 0.9 }),
    plank: new THREE.MeshStandardMaterial({ map: textures.plank }),
    bedrock: new THREE.MeshStandardMaterial({ map: textures.bedrock }),
    water: new THREE.MeshStandardMaterial({ map: textures.water, transparent: true, opacity: 0.7 }),
    sand: new THREE.MeshStandardMaterial({ map: textures.sand }),
    snow: new THREE.MeshStandardMaterial({ map: textures.snow }),
    sapling: new THREE.MeshStandardMaterial({ map: textures.sapling, transparent: true, opacity: 0.95 })
};

// Map Index to ItemType. Array Index 0 = ItemType 1.
const BLOCK_TYPES = [
    { id: ItemType.GRASS, name: 'Grass', mat: materials.grass },       // Index 0, ItemType 1
    { id: ItemType.DIRT, name: 'Dirt', mat: materials.dirt },           // Index 1, ItemType 2
    { id: ItemType.STONE, name: 'Stone', mat: materials.stone },        // Index 2, ItemType 3
    { id: ItemType.WOOD, name: 'Wood', mat: materials.wood },           // Index 3, ItemType 4
    { id: ItemType.LEAF, name: 'Leaf', mat: materials.leaf },           // Index 4, ItemType 5
    { id: ItemType.PLANK, name: 'Plank', mat: materials.plank },        // Index 5, ItemType 6
    { id: ItemType.BEDROCK, name: 'Bedrock', mat: materials.bedrock },  // Index 6, ItemType 7
    { id: ItemType.WATER, name: 'Water', mat: materials.water },        // Index 7, ItemType 8
    { id: ItemType.SAND, name: 'Sand', mat: materials.sand },           // Index 8, ItemType 9
    { id: ItemType.SNOW, name: 'Snow', mat: materials.snow },           // Index 9, ItemType 10
    { id: ItemType.SAPLING, name: 'Sapling', mat: materials.sapling },  // Index 10, ItemType 11
];

interface VoxelEngineProps {
    onStatsUpdate: (stats: GameStats) => void;
    onLockChange: (isLocked: boolean) => void;
    onBlockBreak: (type: ItemType) => void;
    checkCanPlace: (type: ItemType) => boolean;
    onBlockPlace: (type: ItemType) => void;
    selectedBlockIndex: number; // Maps to BLOCK_TYPES index
    orbState?: OrbState | AutonomousOrbState;
    entities?: Entity[];
    onOrbPositionUpdate?: (position: Vector3) => void; // Callback for autonomous movement
}

const VoxelEngine = forwardRef<GameEngineRef, VoxelEngineProps>(({ onStatsUpdate, onLockChange, onBlockBreak, checkCanPlace, onBlockPlace, selectedBlockIndex, orbState, entities = [], onOrbPositionUpdate }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<any | null>(null); // Use any for WebGPURenderer dynamic type
    const playerRef = useRef({
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        onGround: false,
        speed: 8,
        jumpForce: 13
    });
    
    // AI Orb refs
    const orbGroupRef = useRef<THREE.Group | null>(null);
    const orbMeshRef = useRef<THREE.Mesh | null>(null);
    const orbGlowRef = useRef<THREE.PointLight | null>(null);
    const orbScanConeRef = useRef<THREE.Mesh | null>(null);
    const orbStateRef = useRef<OrbState | AutonomousOrbState | undefined>(orbState);
    const onOrbPositionUpdateRef = useRef(onOrbPositionUpdate);
    
    // Entity meshes tracking
    const entityMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());

    // Game State stored in refs to avoid re-renders
    // Block data: maps position key -> {typeIndex, instanceIndex}
    const blockDataRef = useRef<Map<string, {typeIndex: number, instanceIndex: number}>>(new Map());
    // Legacy chunksRef for collision detection - stores block existence and type
    const chunksRef = useRef<Record<string, {typeId: number, x: number, y: number, z: number}>>({});
    // InstancedMesh for each block type
    const instancedMeshesRef = useRef<THREE.InstancedMesh[]>([]);
    // Track instance counts per block type
    const instanceCountsRef = useRef<number[]>([]);
    // Max instances per block type
    const MAX_INSTANCES = 100000;
    // Temp matrix for instance updates
    const tempMatrix = useRef(new THREE.Matrix4());
    const tempPosition = useRef(new THREE.Vector3());

    const objectsRef = useRef<THREE.Object3D[]>([]);
    const keysRef = useRef<{ [key: string]: boolean }>({});
    const isLockedRef = useRef(false);
    // GPU Physics system for fast collision detection
    const physicsSystemRef = useRef(getPhysicsSystem());
    // frameIdRef is no longer needed with setAnimationLoop
    const boxGeometryRef = useRef(new THREE.BoxGeometry(1, 1, 1));
    const groundMeshRef = useRef<THREE.Mesh | null>(null);
    const selectedBlockRef = useRef(selectedBlockIndex); 
    const checkCanPlaceRef = useRef(checkCanPlace);
    const onBlockPlaceRef = useRef(onBlockPlace);
    const onBlockBreakRef = useRef(onBlockBreak);

    // Sync prop changes
    useEffect(() => {
        selectedBlockRef.current = selectedBlockIndex;
        checkCanPlaceRef.current = checkCanPlace;
        onBlockPlaceRef.current = onBlockPlace;
        onBlockBreakRef.current = onBlockBreak;
        orbStateRef.current = orbState;
        onOrbPositionUpdateRef.current = onOrbPositionUpdate;
    }, [selectedBlockIndex, checkCanPlace, onBlockPlace, onBlockBreak, orbState, onOrbPositionUpdate]);

    const getKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

    const addBlock = (x: number, y: number, z: number, typeIndex: number, isWorldGen = false) => {
        if (!sceneRef.current || instancedMeshesRef.current.length === 0) return;
        const key = getKey(x, y, z);
        if (blockDataRef.current.has(key)) return; // Exists

        // Safety check for array bounds
        const blockType = BLOCK_TYPES[typeIndex];
        if (!blockType) return;

        // Check if we have room for more instances
        if (instanceCountsRef.current[typeIndex] >= MAX_INSTANCES) {
            console.warn(`Max instances reached for block type ${typeIndex}`);
            return;
        }

        // Inventory Check for player placement
        if (!isWorldGen) {
            if (!checkCanPlaceRef.current(blockType.id)) return;
            onBlockPlaceRef.current(blockType.id);
        }

        // Get the next instance index for this block type
        const instanceIndex = instanceCountsRef.current[typeIndex];
        instanceCountsRef.current[typeIndex]++;

        // Set the instance matrix
        tempMatrix.current.setPosition(x, y, z);
        instancedMeshesRef.current[typeIndex].setMatrixAt(instanceIndex, tempMatrix.current);
        instancedMeshesRef.current[typeIndex].instanceMatrix.needsUpdate = true;
        instancedMeshesRef.current[typeIndex].count = instanceCountsRef.current[typeIndex];

        // Store block data for collision and removal
        blockDataRef.current.set(key, { typeIndex, instanceIndex });
        chunksRef.current[key] = { typeId: blockType.id, x, y, z };

        // Update physics system for collision detection
        physicsSystemRef.current.setBlock(x, y, z);
    };

    const removeBlockAt = (x: number, y: number, z: number) => {
        const key = getKey(x, y, z);
        const blockData = blockDataRef.current.get(key);
        if (!blockData) return;

        const { typeIndex, instanceIndex } = blockData;
        const instancedMesh = instancedMeshesRef.current[typeIndex];
        const lastIndex = instanceCountsRef.current[typeIndex] - 1;

        // Notify inventory
        const chunkData = chunksRef.current[key];
        if (chunkData?.typeId) {
            onBlockBreakRef.current(chunkData.typeId);
        }

        // If not the last instance, swap with last instance
        if (instanceIndex !== lastIndex) {
            // Get the last instance's matrix
            const lastMatrix = new THREE.Matrix4();
            instancedMesh.getMatrixAt(lastIndex, lastMatrix);

            // Move it to the removed position
            instancedMesh.setMatrixAt(instanceIndex, lastMatrix);

            // Find and update the block data for the swapped instance
            const lastPosition = new THREE.Vector3();
            lastPosition.setFromMatrixPosition(lastMatrix);
            const lastKey = getKey(
                Math.round(lastPosition.x),
                Math.round(lastPosition.y),
                Math.round(lastPosition.z)
            );
            const lastBlockData = blockDataRef.current.get(lastKey);
            if (lastBlockData) {
                lastBlockData.instanceIndex = instanceIndex;
            }
        }

        // Hide the last instance by setting scale to 0
        tempMatrix.current.makeScale(0, 0, 0);
        instancedMesh.setMatrixAt(lastIndex, tempMatrix.current);

        // Decrement count
        instanceCountsRef.current[typeIndex]--;
        instancedMesh.count = instanceCountsRef.current[typeIndex];
        instancedMesh.instanceMatrix.needsUpdate = true;

        // Remove from data structures
        blockDataRef.current.delete(key);
        delete chunksRef.current[key];

        // Update physics system
        physicsSystemRef.current.removeBlock(x, y, z);
    };

    const requestLock = () => {
        rendererRef.current?.domElement.requestPointerLock();
    };

    // Expose methods to parent via Ref
    useImperativeHandle(ref, () => ({
        placeBlocks: (blocks: BlockData[]) => {
            if (!cameraRef.current) return;
            const px = Math.floor(cameraRef.current.position.x);
            const py = Math.floor(cameraRef.current.position.y);
            const pz = Math.floor(cameraRef.current.position.z);

            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraRef.current.quaternion);
            const offsetDist = 5;
            const ox = px + Math.round(forward.x * offsetDist);
            const oz = pz + Math.round(forward.z * offsetDist);

            blocks.forEach(b => {
                // Find index in BLOCK_TYPES that matches b.type
                const typeIndex = BLOCK_TYPES.findIndex(bt => bt.id === b.type);
                if (typeIndex !== -1) {
                    addBlock(ox + b.x, py + b.y, oz + b.z, typeIndex, true); // Treat AI builds as world gen (free)
                }
            });
        },
        getPlayerPosition: () => {
            if (!cameraRef.current) return { x: 0, y: 0, z: 0 };
            return {
                x: Math.floor(cameraRef.current.position.x),
                y: Math.floor(cameraRef.current.position.y),
                z: Math.floor(cameraRef.current.position.z)
            };
        },
        getOrbPosition: () => {
            if (!orbGroupRef.current) return { x: 0, y: 5, z: -3 };
            return {
                x: orbGroupRef.current.position.x,
                y: orbGroupRef.current.position.y,
                z: orbGroupRef.current.position.z
            };
        },
        moveOrb: (x: number, y: number, z: number) => {
            if (orbGroupRef.current) {
                orbGroupRef.current.position.set(x, y, z);
            }
        },
        requestLock: () => {
            requestLock();
        },

        // NEW: Spatial context methods
        getLookDirection: (): Vector3 => {
            if (!cameraRef.current) return { x: 0, y: 0, z: -1 };
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraRef.current.quaternion);
            return { x: dir.x, y: dir.y, z: dir.z };
        },

        raycast: (maxDistance = 50): RaycastResult | null => {
            if (!cameraRef.current) return null;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), cameraRef.current);

            const targets: THREE.Object3D[] = [...instancedMeshesRef.current];
            if (groundMeshRef.current) targets.push(groundMeshRef.current);

            const intersects = raycaster.intersectObjects(targets);
            if (intersects.length === 0 || intersects[0].distance > maxDistance) return null;

            const hit = intersects[0];
            const isGround = hit.object === groundMeshRef.current;
            const GROUND_Y = 0;

            let blockPosition: Vector3;
            if (isGround) {
                blockPosition = {
                    x: Math.floor(hit.point.x),
                    y: GROUND_Y + 1,
                    z: Math.floor(hit.point.z)
                };
            } else {
                // Extract from instanced mesh matrix
                const mesh = hit.object as THREE.InstancedMesh;
                const matrix = new THREE.Matrix4();
                mesh.getMatrixAt(hit.instanceId!, matrix);
                const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
                blockPosition = {
                    x: Math.round(pos.x),
                    y: Math.round(pos.y),
                    z: Math.round(pos.z)
                };
            }

            return {
                hit: true,
                point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
                blockPosition,
                normal: hit.face ? { x: hit.face.normal.x, y: hit.face.normal.y, z: hit.face.normal.z } : { x: 0, y: 1, z: 0 },
                distance: hit.distance,
                isGround
            };
        },

        // NEW: Block operations
        placeBlocksAbsolute: (blocks: BlockData[]) => {
            blocks.forEach(block => {
                const typeIndex = BLOCK_TYPES.findIndex(bt => bt.id === block.type);
                if (typeIndex !== -1) {
                    addBlock(block.x, block.y, block.z, typeIndex, true); // isWorldGen=true bypasses inventory
                }
            });
        },

        removeBlockAt: (x: number, y: number, z: number): boolean => {
            const key = getKey(x, y, z);
            if (!blockDataRef.current.has(key)) return false;
            removeBlockAt(x, y, z);
            return true;
        },

        getBlockAt: (x: number, y: number, z: number): number | null => {
            const key = getKey(x, y, z);
            const data = blockDataRef.current.get(key);
            if (!data) return null;
            const blockType = BLOCK_TYPES[data.typeIndex];
            return blockType ? blockType.id : null;
        },

        getBlocksInArea: (center: Vector3, radius: number): Array<{ position: Vector3; type: number }> => {
            const results: Array<{ position: Vector3; type: number }> = [];
            const r = Math.floor(radius);
            for (let x = Math.floor(center.x) - r; x <= Math.floor(center.x) + r; x++) {
                for (let y = Math.floor(center.y) - r; y <= Math.floor(center.y) + r; y++) {
                    for (let z = Math.floor(center.z) - r; z <= Math.floor(center.z) + r; z++) {
                        const key = getKey(x, y, z);
                        const data = blockDataRef.current.get(key);
                        if (data) {
                            const blockType = BLOCK_TYPES[data.typeIndex];
                            if (blockType) {
                                results.push({ position: { x, y, z }, type: blockType.id });
                            }
                        }
                    }
                }
            }
            return results;
        },

        clearArea: (start: Vector3, end: Vector3): number => {
            let count = 0;
            const minX = Math.min(Math.floor(start.x), Math.floor(end.x));
            const maxX = Math.max(Math.floor(start.x), Math.floor(end.x));
            const minY = Math.min(Math.floor(start.y), Math.floor(end.y));
            const maxY = Math.max(Math.floor(start.y), Math.floor(end.y));
            const minZ = Math.min(Math.floor(start.z), Math.floor(end.z));
            const maxZ = Math.max(Math.floor(start.z), Math.floor(end.z));

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        const key = getKey(x, y, z);
                        if (blockDataRef.current.has(key)) {
                            removeBlockAt(x, y, z);
                            count++;
                        }
                    }
                }
            }
            return count;
        }
    }));

    useEffect(() => {
        console.log('VoxelEngine useEffect starting...');
        if (!containerRef.current) {
            console.log('Container ref is null!');
            return;
        }

        // Prevent double initialization
        if (rendererRef.current) {
            console.log('Renderer already exists, skipping initialization');
            return;
        }

        let isMounted = true;
        let cleanupFn: (() => void) | undefined;

        const initEngine = async () => {
        try {
            console.log('Initializing Three.js scene...');
            // --- Init Three.js ---
            const scene = new THREE.Scene();
            // Initial Sky Color (Day)
            scene.background = new THREE.Color(0x87CEEB);
            scene.fog = new THREE.Fog(0x87CEEB, 50, 150);
            sceneRef.current = scene;

            const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.set(0, 10, 0);
            cameraRef.current = camera;

            // Create renderer - try WebGPU first, fallback to WebGL
            let renderer: WebGPURenderer | THREE.WebGLRenderer;

            const initRenderer = async () => {
                if (navigator.gpu) {
                    try {
                        console.log('WebGPU available, initializing...');
                        const webgpuRenderer = new WebGPURenderer({ antialias: true });
                        await webgpuRenderer.init();
                        webgpuRenderer.setSize(window.innerWidth, window.innerHeight);
                        webgpuRenderer.setPixelRatio(window.devicePixelRatio);
                        console.log('WebGPU renderer created successfully');
                        return webgpuRenderer;
                    } catch (e) {
                        console.warn('WebGPU init failed, falling back to WebGL:', e);
                    }
                }

                console.log('Using WebGL renderer fallback...');
                const webglRenderer = new THREE.WebGLRenderer({ antialias: true });
                webglRenderer.setSize(window.innerWidth, window.innerHeight);
                webglRenderer.setPixelRatio(window.devicePixelRatio);
                webglRenderer.shadowMap.enabled = true;
                webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
                console.log('WebGL renderer created successfully');
                return webglRenderer;
            };

            renderer = await initRenderer();
            if (!isMounted) {
                renderer.dispose();
                return;
            }
            containerRef.current.appendChild(renderer.domElement);
            rendererRef.current = renderer;

            // Lights
            const ambientLight = new THREE.AmbientLight(0xaaaaaa, 0.6);
            scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
        sunLight.position.set(50, 100, 50);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 500;
        const d = 50;
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;
        scene.add(sunLight);

        // --- Create InstancedMeshes for each block type ---
        const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
        instancedMeshesRef.current = BLOCK_TYPES.map((blockType, index) => {
            const instancedMesh = new THREE.InstancedMesh(boxGeometry, blockType.mat, MAX_INSTANCES);
            instancedMesh.count = 0; // Start with 0 visible instances
            instancedMesh.castShadow = true;
            instancedMesh.receiveShadow = true;
            instancedMesh.frustumCulled = false; // Disable frustum culling for now (can optimize later)
            scene.add(instancedMesh);
            return instancedMesh;
        });
        // Initialize instance counts
        instanceCountsRef.current = BLOCK_TYPES.map(() => 0);
        console.log(`Created ${BLOCK_TYPES.length} InstancedMeshes with max ${MAX_INSTANCES} instances each`);

        // --- AI Orb Creation ---
        const orbGroup = new THREE.Group();
        orbGroup.position.set(0, 5, -3); // Start in front of player spawn
        orbGroupRef.current = orbGroup;
        scene.add(orbGroup);

        // Main orb sphere with purple emissive material
        const orbGeometry = new THREE.IcosahedronGeometry(0.4, 3);
        const orbMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b5cf6,
            emissive: 0x8b5cf6,
            emissiveIntensity: 0.5,
            metalness: 0.8,
            roughness: 0.2,
            transparent: true,
            opacity: 0.9
        });
        const orbMesh = new THREE.Mesh(orbGeometry, orbMaterial);
        orbMesh.castShadow = true;
        orbGroup.add(orbMesh);
        orbMeshRef.current = orbMesh;

        // Outer glow ring
        const ringGeometry = new THREE.TorusGeometry(0.6, 0.05, 16, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0xa855f7,
            transparent: true,
            opacity: 0.6
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        orbGroup.add(ring);

        // Point light for glow effect
        const orbGlow = new THREE.PointLight(0x8b5cf6, 2, 10);
        orbGlow.position.set(0, 0, 0);
        orbGroup.add(orbGlow);
        orbGlowRef.current = orbGlow;

        // Scanning cone (visible when in 'scanning' mode)
        const coneGeometry = new THREE.ConeGeometry(2, 8, 16, 1, true);
        const coneMaterial = new THREE.MeshBasicMaterial({
            color: 0x8b5cf6,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
            wireframe: false
        });
        const scanCone = new THREE.Mesh(coneGeometry, coneMaterial);
        scanCone.rotation.x = Math.PI; // Point downward
        scanCone.position.y = -4;
        scanCone.visible = false;
        orbGroup.add(scanCone);
        orbScanConeRef.current = scanCone;

        // --- Sky System (Stars & Clouds) ---
        const skyGroup = new THREE.Group();
        scene.add(skyGroup);

        // Stars
        const starGeo = new THREE.BufferGeometry();
        const starCount = 3000;
        const starPos = new Float32Array(starCount * 3);
        for(let i=0; i<starCount*3; i++) {
            starPos[i] = (Math.random() - 0.5) * 800;
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, transparent: true, opacity: 0 });
        const stars = new THREE.Points(starGeo, starMat);
        skyGroup.add(stars);

        // Clouds
        const cloudGroup = new THREE.Group();
        scene.add(cloudGroup);
        const cloudMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            roughness: 0.9, 
            transparent: true, 
            opacity: 0.8,
            flatShading: true
        });
        
        const clouds: THREE.Mesh[] = [];
        for(let i=0; i<25; i++) {
            const w = 15 + Math.random() * 25;
            const h = 4 + Math.random() * 4;
            const depth = 10 + Math.random() * 15;
            const cloud = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), cloudMat);
            
            // Random high position
            cloud.position.set(
                (Math.random() - 0.5) * 600,
                70 + Math.random() * 30,
                (Math.random() - 0.5) * 600
            );
            cloudGroup.add(cloud);
            clouds.push(cloud);
        }

        // --- Large Flat Ground Plane ---
        const WORLD_SIZE = 1000; // Much larger world
        const GROUND_Y = 0; // Ground level

        // Create grass-textured ground plane
        const groundGeometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
        groundGeometry.rotateX(-Math.PI / 2); // Lay flat

        // Create a tiling grass texture
        const groundTexture = textures.grass.clone();
        groundTexture.wrapS = THREE.RepeatWrapping;
        groundTexture.wrapT = THREE.RepeatWrapping;
        groundTexture.repeat.set(WORLD_SIZE / 4, WORLD_SIZE / 4); // Tile every 4 units

        const groundMaterial = new THREE.MeshStandardMaterial({
            map: groundTexture,
            roughness: 0.9,
            metalness: 0.0
        });

        const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        groundMesh.position.y = GROUND_Y;
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);
        groundMeshRef.current = groundMesh;  // Store in component ref for raycast access

        // Enable ground plane collision in physics system
        physicsSystemRef.current.setGroundPlane(GROUND_Y);

        console.log(`Created ground plane: ${WORLD_SIZE}x${WORLD_SIZE} at y=${GROUND_Y}`);

        // --- Tree Generation ---
        const createTree = (tx: number, tz: number) => {
            const ty = GROUND_Y + 1; // Trees start 1 unit above ground
            // Trunk
            for (let i = 0; i < 4; i++) {
                addBlock(tx, ty + i, tz, 3, true); // Wood (Index 3)
            }
            // Leaves
            for (let lx = -2; lx <= 2; lx++) {
                for (let lz = -2; lz <= 2; lz++) {
                    for (let ly = 2; ly <= 4; ly++) {
                        if (Math.abs(lx) + Math.abs(lz) + Math.abs(ly - 3) < 4) {
                            if (!(lx === 0 && lz === 0 && ly < 4)) {
                                addBlock(tx + lx, ty + ly, tz + lz, 4, true); // Leaf (Index 4)
                            }
                        }
                    }
                }
            }
        };

        // Scatter trees across the world (avoiding center spawn area)
        const TREE_COUNT = 200;
        const SPAWN_CLEAR_ZONE = 30; // No trees within 30 units of spawn

        console.log('Generating trees...');
        for (let i = 0; i < TREE_COUNT; i++) {
            const tx = Math.floor((Math.random() - 0.5) * (WORLD_SIZE - 20));
            const tz = Math.floor((Math.random() - 0.5) * (WORLD_SIZE - 20));

            // Skip if too close to spawn
            if (Math.abs(tx) < SPAWN_CLEAR_ZONE && Math.abs(tz) < SPAWN_CLEAR_ZONE) {
                continue;
            }

            createTree(tx, tz);
        }
        console.log('Tree generation complete. Block count:', blockDataRef.current.size);

        // --- Event Listeners ---
        const handleResize = () => {
            if (!cameraRef.current || !rendererRef.current) return;
            cameraRef.current.aspect = window.innerWidth / window.innerHeight;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(window.innerWidth, window.innerHeight);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            keysRef.current[e.code] = true;
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keysRef.current[e.code] = false;
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isLockedRef.current || !cameraRef.current) return;
            const euler = new THREE.Euler(0, 0, 0, 'YXZ');
            euler.setFromQuaternion(cameraRef.current.quaternion);
            euler.y -= e.movementX * 0.002;
            euler.x -= e.movementY * 0.002;
            euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
            cameraRef.current.quaternion.setFromEuler(euler);
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (!isLockedRef.current || !cameraRef.current) return;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(new THREE.Vector2(0, 0), cameraRef.current);

            // Raycast against instanced meshes AND ground plane
            const allTargets: THREE.Object3D[] = [...instancedMeshesRef.current];
            if (groundMeshRef.current) allTargets.push(groundMeshRef.current);
            const intersects = raycaster.intersectObjects(allTargets);

            if (intersects.length > 0) {
                const intersect = intersects[0];
                if (intersect.distance > 8) return;

                const isGroundHit = intersect.object === groundMeshRef.current;

                if (isGroundHit) {
                    // Hit the ground plane - only allow placing blocks (right click)
                    if (e.button === 2) {
                        const p = intersect.point;
                        const nx = Math.floor(p.x);
                        const ny = GROUND_Y + 1; // Place block on top of ground
                        const nz = Math.floor(p.z);

                        // AABB check against player
                        const pc = cameraRef.current.position;
                        const minX = pc.x - 0.4;
                        const maxX = pc.x + 0.4;
                        const minZ = pc.z - 0.4;
                        const maxZ = pc.z + 0.4;
                        const minY = pc.y - 1.6;
                        const maxY = pc.y + 0.2;

                        const overlap = (
                            minX < nx + 0.5 && maxX > nx - 0.5 &&
                            minY < ny + 0.5 && maxY > ny - 0.5 &&
                            minZ < nz + 0.5 && maxZ > nz - 0.5
                        );

                        if (overlap) return;

                        addBlock(nx, ny, nz, selectedBlockRef.current, false);
                    }
                } else {
                    // Hit an instanced mesh (block)
                    const instancedMesh = intersect.object as THREE.InstancedMesh;
                    const instanceId = intersect.instanceId;
                    if (instanceId === undefined) return;

                    const hitMatrix = new THREE.Matrix4();
                    instancedMesh.getMatrixAt(instanceId, hitMatrix);
                    const hitPosition = new THREE.Vector3();
                    hitPosition.setFromMatrixPosition(hitMatrix);

                    const blockX = Math.round(hitPosition.x);
                    const blockY = Math.round(hitPosition.y);
                    const blockZ = Math.round(hitPosition.z);

                    if (e.button === 0) {
                        // Left click - remove block
                        removeBlockAt(blockX, blockY, blockZ);
                    } else if (e.button === 2) {
                        // Right click - place block adjacent to hit face
                        // Transform face normal to world space for correct direction
                        const normalMatrix = new THREE.Matrix3().getNormalMatrix(instancedMesh.matrixWorld);
                        const worldNormal = intersect.face!.normal.clone().applyMatrix3(normalMatrix).normalize();

                        // Round to get clean integer direction (-1, 0, or 1)
                        const dx = Math.round(worldNormal.x);
                        const dy = Math.round(worldNormal.y);
                        const dz = Math.round(worldNormal.z);

                        // New block position = hit block + face direction
                        const nx = blockX + dx;
                        const ny = blockY + dy;
                        const nz = blockZ + dz;

                        // AABB check against player to prevent self-block
                        const pc = cameraRef.current.position;
                        const minX = pc.x - 0.4;
                        const maxX = pc.x + 0.4;
                        const minZ = pc.z - 0.4;
                        const maxZ = pc.z + 0.4;
                        const minY = pc.y - 1.6;
                        const maxY = pc.y + 0.2;

                        const overlap = (
                            minX < nx + 0.5 && maxX > nx - 0.5 &&
                            minY < ny + 0.5 && maxY > ny - 0.5 &&
                            minZ < nz + 0.5 && maxZ > nz - 0.5
                        );

                        if (overlap) return;

                        addBlock(nx, ny, nz, selectedBlockRef.current, false);
                    }
                }
            }
        };

        const handlePointerLockChange = () => {
            const locked = document.pointerLockElement === rendererRef.current?.domElement;
            isLockedRef.current = locked;
            onLockChange(locked);
        };

        window.addEventListener('resize', handleResize);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('pointerlockchange', handlePointerLockChange);

        // --- Physics Helper Constants ---
        const PLAYER_RADIUS = 0.35;
        const PLAYER_HEIGHT = 1.8;
        const CAM_OFFSET = 1.6; // Eyes are 1.6m above feet

        // Robust AABB check for capsule-like collision
        // Fast O(1) collision check using typed array spatial grid
        const checkIntersection = (pos: THREE.Vector3) => {
            return physicsSystemRef.current.checkCollision(
                pos.x,
                pos.y,
                pos.z,
                PLAYER_RADIUS,
                PLAYER_HEIGHT,
                CAM_OFFSET
            );
        };

        // --- Game Loop using setAnimationLoop ---
        const clock = new THREE.Clock();
        let frameCount = 0;
        let lastTime = 0;

        // Sky Colors
        const colorDay = new THREE.Color(0x87CEEB);
        const colorSunset = new THREE.Color(0xFF7F50);
        const colorNight = new THREE.Color(0x050510);
        const dayDuration = 120; // Seconds for a full day cycle

        const animate = (time: number) => {
            if (!isMounted || !sceneRef.current || !cameraRef.current || !rendererRef.current) return;

            const delta = Math.min(clock.getDelta(), 0.1);

            // --- Sky Update ---
            const totalTime = clock.getElapsedTime();
            const dayProgress = (totalTime % dayDuration) / dayDuration; // 0 to 1
            
            const sunAngle = (dayProgress * Math.PI * 2) - (Math.PI / 2); 
            const sunR = 150;
            sunLight.position.x = Math.cos(sunAngle) * sunR;
            sunLight.position.y = Math.sin(sunAngle) * sunR;
            sunLight.position.z = Math.cos(sunAngle * 0.5) * 50; 

            // Color Interpolation
            let targetBg = colorNight;
            let sunIntensity = 0;
            let starOpacity = 1;

            if (dayProgress < 0.1) { // Sunrise
                const t = dayProgress / 0.1;
                targetBg = colorNight.clone().lerp(colorSunset, t);
                sunIntensity = t * 0.8;
                starOpacity = 1 - t;
            } else if (dayProgress < 0.2) { // Morning Transition
                const t = (dayProgress - 0.1) / 0.1;
                targetBg = colorSunset.clone().lerp(colorDay, t);
                sunIntensity = 0.8 + (t * 0.2);
                starOpacity = 0;
            } else if (dayProgress < 0.4) { // Full Day
                targetBg = colorDay;
                sunIntensity = 1.0;
                starOpacity = 0;
            } else if (dayProgress < 0.5) { // Pre-Sunset
                const t = (dayProgress - 0.4) / 0.1;
                targetBg = colorDay.clone().lerp(colorSunset, t);
                sunIntensity = 1.0 - (t * 0.2);
                starOpacity = 0;
            } else if (dayProgress < 0.6) { // Sunset
                const t = (dayProgress - 0.5) / 0.1;
                targetBg = colorSunset.clone().lerp(colorNight, t);
                sunIntensity = 0.8 * (1 - t);
                starOpacity = t;
            } else { // Night
                targetBg = colorNight;
                sunIntensity = 0;
                starOpacity = 1;
            }

            // Apply Sky Settings
            sceneRef.current.background = targetBg;
            if (sceneRef.current.fog instanceof THREE.Fog) {
                sceneRef.current.fog.color.copy(targetBg);
            }
            sunLight.intensity = sunIntensity;
            ambientLight.intensity = 0.1 + (sunIntensity * 0.5); 
            starMat.opacity = starOpacity;
            
            // Move Clouds
            clouds.forEach(c => {
                c.position.x += delta * 2;
                if(c.position.x > 300) c.position.x = -300;
            });
            skyGroup.rotation.y += delta * 0.01;

            // --- AI Orb Animation ---
            if (orbGroupRef.current && orbMeshRef.current && orbGlowRef.current) {
                const orb = orbGroupRef.current;
                const orbMesh = orbMeshRef.current;
                const orbGlow = orbGlowRef.current;
                const orbMat = orbMesh.material as THREE.MeshStandardMaterial;
                const currentOrbState = orbStateRef.current;

                // Floating animation (always active, except when following or moving)
                const floatOffset = Math.sin(totalTime * 2) * 0.15;

                // Get mode - handle both enum and string values
                const mode = currentOrbState?.mode || 'idle';

                // Check if this is an autonomous state with path-following
                const isAutonomous = currentOrbState && 'isMoving' in currentOrbState;
                const autonomousState = isAutonomous ? currentOrbState as AutonomousOrbState : null;

                // Gentle rotation (base)
                orbMesh.rotation.y += delta * 0.5;
                orbMesh.rotation.x = Math.sin(totalTime) * 0.1;

                // Handle autonomous path-following movement
                if (autonomousState?.isMoving && autonomousState.path.length > 0) {
                    const pathIndex = autonomousState.pathIndex;
                    if (pathIndex < autonomousState.path.length) {
                        const target = autonomousState.path[pathIndex];
                        const speed = autonomousState.movementSpeed || 5;

                        // Calculate distance to target
                        const dx = target.x - orb.position.x;
                        const dy = target.y - orb.position.y;
                        const dz = target.z - orb.position.z;
                        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                        // Move toward target
                        const moveAmount = speed * delta;
                        if (dist > moveAmount) {
                            orb.position.x += (dx / dist) * moveAmount;
                            orb.position.y += (dy / dist) * moveAmount + floatOffset * 0.3;
                            orb.position.z += (dz / dist) * moveAmount;

                            // Spin faster while moving
                            orbMesh.rotation.y += delta * 2;
                        }

                        // Notify App of position update
                        if (onOrbPositionUpdateRef.current) {
                            onOrbPositionUpdateRef.current({
                                x: orb.position.x,
                                y: orb.position.y,
                                z: orb.position.z
                            });
                        }
                    }
                }
                // Only sync position from state when NOT following and NOT moving autonomously
                // (following mode handles its own position)
                else if (mode !== 'following' && mode !== OrbMode.FOLLOWING) {
                    orb.position.y = (currentOrbState?.position?.y || 5) + floatOffset;
                    if (currentOrbState?.position) {
                        orb.position.x = currentOrbState.position.x;
                        orb.position.z = currentOrbState.position.z;
                    }
                }
                
                // State-based appearance
                
                if (mode === 'idle') {
                    // Calm purple glow
                    orbMat.emissiveIntensity = 0.3 + Math.sin(totalTime * 2) * 0.1;
                    orbGlow.intensity = 1.5 + Math.sin(totalTime * 2) * 0.5;
                    orbGlow.color.setHex(0x8b5cf6);
                    orbMat.emissive.setHex(0x8b5cf6);
                    if (orbScanConeRef.current) orbScanConeRef.current.visible = false;
                } else if (mode === 'thinking') {
                    // Pulsing blue
                    const pulse = Math.sin(totalTime * 6) * 0.5 + 0.5;
                    orbMat.emissiveIntensity = 0.4 + pulse * 0.4;
                    orbGlow.intensity = 2 + pulse * 2;
                    orbGlow.color.setHex(0x3b82f6);
                    orbMat.emissive.setHex(0x3b82f6);
                    // Spin faster when thinking
                    orbMesh.rotation.y += delta * 2;
                    if (orbScanConeRef.current) orbScanConeRef.current.visible = false;
                } else if (mode === 'acting') {
                    // Bright green, active
                    orbMat.emissiveIntensity = 0.8;
                    orbGlow.intensity = 4;
                    orbGlow.color.setHex(0x22c55e);
                    orbMat.emissive.setHex(0x22c55e);
                    // Fast spin
                    orbMesh.rotation.y += delta * 5;
                    if (orbScanConeRef.current) orbScanConeRef.current.visible = false;
                } else if (mode === 'scanning') {
                    // Purple with visible scan cone
                    orbMat.emissiveIntensity = 0.6;
                    orbGlow.intensity = 3;
                    orbGlow.color.setHex(0xa855f7);
                    orbMat.emissive.setHex(0xa855f7);
                    if (orbScanConeRef.current) {
                        orbScanConeRef.current.visible = true;
                        orbScanConeRef.current.rotation.y += delta * 2;
                        // Pulsing opacity
                        (orbScanConeRef.current.material as THREE.MeshBasicMaterial).opacity = 
                            0.1 + Math.sin(totalTime * 4) * 0.05;
                    }
                } else if (mode === 'following') {
                    // Cyan/teal color when following player
                    const pulse = Math.sin(totalTime * 3) * 0.5 + 0.5;
                    orbMat.emissiveIntensity = 0.5 + pulse * 0.2;
                    orbGlow.intensity = 2.5 + pulse * 1;
                    orbGlow.color.setHex(0x06b6d4);
                    orbMat.emissive.setHex(0x06b6d4);
                    if (orbScanConeRef.current) orbScanConeRef.current.visible = false;
                    
                    // Follow the player with smooth lerp
                    if (cameraRef.current) {
                        const cam = cameraRef.current;
                        // Target position: behind and above the camera
                        const followDistance = 3;
                        const followHeight = 2;
                        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                        forward.y = 0;
                        forward.normalize();
                        
                        const targetX = cam.position.x - forward.x * followDistance;
                        const targetY = cam.position.y + followHeight;
                        const targetZ = cam.position.z - forward.z * followDistance;
                        
                        // Smooth follow with lerp
                        const lerpSpeed = 3 * delta;
                        orb.position.x += (targetX - orb.position.x) * lerpSpeed;
                        orb.position.z += (targetZ - orb.position.z) * lerpSpeed;
                        // Override the floating animation for Y to include follow
                        const targetYWithFloat = targetY + floatOffset;
                        orb.position.y += (targetYWithFloat - orb.position.y) * lerpSpeed;
                    }
                    // Gentle spin while following
                    orbMesh.rotation.y += delta * 1.5;
                }
            }

            // --- Physics & Player ---
            if (isLockedRef.current) {
                const player = playerRef.current;
                const cam = cameraRef.current;
                
                // Gravity
                player.velocity.y -= 32 * delta; 

                // Input
                const inputZ = Number(!!keysRef.current['KeyW']) - Number(!!keysRef.current['KeyS']);
                const inputX = Number(!!keysRef.current['KeyD']) - Number(!!keysRef.current['KeyA']);
                
                // Jump
                if (keysRef.current['Space'] && player.onGround) {
                    player.velocity.y = player.jumpForce;
                    player.onGround = false;
                }

                // Vectors
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                forward.y = 0; forward.normalize();
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
                right.y = 0; right.normalize();

                const moveVec = new THREE.Vector3();
                moveVec.addScaledVector(forward, inputZ * player.speed * delta);
                moveVec.addScaledVector(right, inputX * player.speed * delta);

                // --- X Movement (Wall Slide + Slope) ---
                let tentativePos = cam.position.clone();
                tentativePos.x += moveVec.x;
                if (checkIntersection(tentativePos)) {
                    // Try stepping up (Slope)
                    tentativePos.y += 1.1; 
                    if (!checkIntersection(tentativePos)) {
                        cam.position.x += moveVec.x;
                        cam.position.y += 1.1;
                    } 
                    // else: Wall hit, do nothing (slide)
                } else {
                    cam.position.x += moveVec.x;
                }

                // --- Z Movement (Wall Slide + Slope) ---
                tentativePos = cam.position.clone();
                tentativePos.z += moveVec.z;
                if (checkIntersection(tentativePos)) {
                    // Try stepping up
                    tentativePos.y += 1.1;
                    if (!checkIntersection(tentativePos)) {
                        cam.position.z += moveVec.z;
                        cam.position.y += 1.1;
                    }
                } else {
                    cam.position.z += moveVec.z;
                }

                // --- Y Movement (Gravity / Ground) ---
                const dy = player.velocity.y * delta;
                tentativePos = cam.position.clone();
                tentativePos.y += dy;

                if (checkIntersection(tentativePos)) {
                    if (player.velocity.y < 0) {
                        // Landed
                        player.velocity.y = 0;
                        player.onGround = true;
                        // Snap to block top
                        // We hit a block at floor(feetPos). Top is floor+1.
                        // Feet should be at floor(y) + 1. 
                        // Cam should be feet + offset.
                        const hitBlockY = Math.floor(cam.position.y - CAM_OFFSET - 0.1); 
                        cam.position.y = hitBlockY + 1 + CAM_OFFSET;
                    } else {
                        // Head hit ceiling
                        player.velocity.y = 0;
                    }
                } else {
                    cam.position.y += dy;
                    player.onGround = false;
                }

                // Kill Floor
                if (cam.position.y < -30) {
                    cam.position.set(0, 20, 0);
                    player.velocity.y = 0;
                }
            }

            rendererRef.current.render(sceneRef.current, cameraRef.current);

            frameCount++;
            if (time - lastTime >= 1000) {
                onStatsUpdate({
                    fps: frameCount,
                    blockCount: blockDataRef.current.size,
                    entityCount: 0,
                    x: Math.floor(cameraRef.current.position.x),
                    y: Math.floor(cameraRef.current.position.y),
                    z: Math.floor(cameraRef.current.position.z)
                });
                frameCount = 0;
                lastTime = time;
            }
            
            frameId = requestAnimationFrame(animate);
        };

        // Start animation loop with requestAnimationFrame
        console.log('Starting animation loop...');
        let frameId = requestAnimationFrame(animate);

        cleanupFn = () => {
            isMounted = false;
            cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('pointerlockchange', handlePointerLockChange);

            if (rendererRef.current) {
                rendererRef.current.dispose();
            }

            if (rendererRef.current && containerRef.current) {
                try {
                    containerRef.current.removeChild(rendererRef.current.domElement);
                } catch (e) {}
            }
        };
        } catch (error) {
            console.error('VoxelEngine initialization error:', error);
        }
        };

        initEngine();

        return () => {
            isMounted = false;
            if (cleanupFn) cleanupFn();
        };
    }, []); 

    return (
        <div 
            ref={containerRef} 
            className="w-full h-screen block"
            onClick={!isLockedRef.current ? requestLock : undefined}
        />
    );
});

export default VoxelEngine;