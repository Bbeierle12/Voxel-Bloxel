import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { WebGPURenderer } from 'three/webgpu';
import { GameStats, BlockData, GameEngineRef, ItemType } from '../types';

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
    bedrock: createTexture('#1a1a1a')
};

// Use MeshStandardMaterial for better WebGPU support and PBR lighting
const materials = {
    grass: new THREE.MeshStandardMaterial({ map: textures.grass }),
    dirt: new THREE.MeshStandardMaterial({ map: textures.dirt }),
    stone: new THREE.MeshStandardMaterial({ map: textures.stone }),
    wood: new THREE.MeshStandardMaterial({ map: textures.wood }),
    leaf: new THREE.MeshStandardMaterial({ map: textures.leaf, transparent: true, opacity: 0.9 }),
    plank: new THREE.MeshStandardMaterial({ map: textures.plank }),
    bedrock: new THREE.MeshStandardMaterial({ map: textures.bedrock })
};

// Map Index to ItemType. Array Index 0 = ItemType 1.
const BLOCK_TYPES = [
    { id: ItemType.GRASS, name: 'Grass', mat: materials.grass },
    { id: ItemType.DIRT, name: 'Dirt', mat: materials.dirt },
    { id: ItemType.STONE, name: 'Stone', mat: materials.stone },
    { id: ItemType.WOOD, name: 'Wood', mat: materials.wood },
    { id: ItemType.LEAF, name: 'Leaf', mat: materials.leaf },
    { id: ItemType.PLANK, name: 'Plank', mat: materials.plank },
];

interface VoxelEngineProps {
    onStatsUpdate: (stats: GameStats) => void;
    onLockChange: (isLocked: boolean) => void;
    onBlockBreak: (type: ItemType) => void;
    checkCanPlace: (type: ItemType) => boolean;
    onBlockPlace: (type: ItemType) => void;
    selectedBlockIndex: number; // Maps to BLOCK_TYPES index
}

const VoxelEngine = forwardRef<GameEngineRef, VoxelEngineProps>(({ onStatsUpdate, onLockChange, onBlockBreak, checkCanPlace, onBlockPlace, selectedBlockIndex }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<any | null>(null); // Use any for WebGPURenderer dynamic type
    const playerRef = useRef({
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        onGround: false,
        speed: 8,
        jumpForce: 12
    });
    
    // Game State stored in refs to avoid re-renders
    const chunksRef = useRef<Record<string, THREE.Mesh>>({});
    const objectsRef = useRef<THREE.Object3D[]>([]);
    const keysRef = useRef<{ [key: string]: boolean }>({});
    const isLockedRef = useRef(false);
    // frameIdRef is no longer needed with setAnimationLoop
    const boxGeometryRef = useRef(new THREE.BoxGeometry(1, 1, 1));
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
    }, [selectedBlockIndex, checkCanPlace, onBlockPlace, onBlockBreak]);

    const getKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

    const addBlock = (x: number, y: number, z: number, typeIndex: number, isWorldGen = false) => {
        if (!sceneRef.current) return;
        const key = getKey(x, y, z);
        if (chunksRef.current[key]) return; // Exists

        // Safety check for array bounds
        const blockType = BLOCK_TYPES[typeIndex];
        if(!blockType) return;

        // Inventory Check for player placement
        if (!isWorldGen) {
             if (!checkCanPlaceRef.current(blockType.id)) return;
             onBlockPlaceRef.current(blockType.id);
        }

        const mesh = new THREE.Mesh(boxGeometryRef.current, blockType.mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // IMPORTANT: Store the ItemType ID, not the array index
        mesh.userData = { isBlock: true, key: key, x, y, z, typeId: blockType.id };

        sceneRef.current.add(mesh);
        chunksRef.current[key] = mesh;
        objectsRef.current.push(mesh);
    };

    const removeBlock = (mesh: THREE.Mesh) => {
        if (!sceneRef.current) return;
        sceneRef.current.remove(mesh);
        const key = mesh.userData.key;
        delete chunksRef.current[key];
        const idx = objectsRef.current.indexOf(mesh);
        if (idx > -1) objectsRef.current.splice(idx, 1);
        
        // Notify inventory
        if (mesh.userData.typeId) {
            onBlockBreakRef.current(mesh.userData.typeId);
        }
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
        requestLock: () => {
            requestLock();
        }
    }));

    useEffect(() => {
        if (!containerRef.current) return;

        // --- Init Three.js with WebGPURenderer ---
        const scene = new THREE.Scene();
        // Initial Sky Color (Day)
        scene.background = new THREE.Color(0x87CEEB);
        scene.fog = new THREE.Fog(0x87CEEB, 20, 200);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 10, 0);
        cameraRef.current = camera;

        // Use WebGPURenderer
        const renderer = new WebGPURenderer({ antialias: false, forceWebGL: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

        // --- Terrain Gen ---
        const WORLD_SIZE = 300; // Increased World Size
        const offset = WORLD_SIZE / 2;

        const createTree = (tx: number, ty: number, tz: number) => {
            // Trunk
            for(let i=0; i<4; i++) {
                addBlock(tx, ty+i, tz, 3, true); // Wood (Index 3)
            }
            // Leaves
            for(let lx=-2; lx<=2; lx++){
                for(let lz=-2; lz<=2; lz++){
                    for(let ly=2; ly<=4; ly++){
                         if(Math.abs(lx)+Math.abs(lz)+Math.abs(ly-3) < 4){
                             if(!(lx===0 && lz===0 && ly<4)){
                                 addBlock(tx+lx, ty+ly, tz+lz, 4, true); // Leaf (Index 4)
                             }
                         }
                    }
                }
            }
        };

        for (let x = -offset; x < offset; x++) {
            for (let z = -offset; z < offset; z++) {
                let height = 0;
                let isFlat = false;

                // Central Flat Zone: -50 to 50
                if (x > -50 && x < 50 && z > -50 && z < 50) {
                     height = 0;
                     isFlat = true;
                } else {
                     const h1 = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 3;
                     const h2 = Math.sin(x * 0.3) * Math.sin(z * 0.3) * 1;
                     height = Math.floor(h1 + h2);
                }

                // Bedrock/Base
                addBlock(x, -5, z, 2, true); 

                for (let y = -4; y <= height; y++) {
                    let typeIdx = 2; // Stone
                    if (y === height) typeIdx = 0; // Grass
                    else if (y > height - 3) typeIdx = 1; // Dirt
                    addBlock(x, y, z, typeIdx, true);
                }

                // Trees only outside flat zone
                if (!isFlat) {
                     if (x > -offset + 2 && x < offset - 2 && z > -offset + 2 && z < offset - 2) {
                        // 1% chance for a tree
                        if (Math.random() < 0.01 && height > 0) {
                            createTree(x, height + 1, z);
                        }
                     }
                }
            }
        }

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
            const intersects = raycaster.intersectObjects(objectsRef.current);

            if (intersects.length > 0) {
                const intersect = intersects[0];
                if (intersect.distance > 8) return;

                if (e.button === 0) {
                    removeBlock(intersect.object as THREE.Mesh);
                } else if (e.button === 2) {
                    const p = intersect.point;
                    const n = intersect.face!.normal;
                    const nx = Math.floor(p.x + n.x * 0.5);
                    const ny = Math.floor(p.y + n.y * 0.5);
                    const nz = Math.floor(p.z + n.z * 0.5);

                    const pc = cameraRef.current.position;
                    if (Math.abs(nx - pc.x) < 0.8 && Math.abs(ny - (pc.y - 1)) < 1.8 && Math.abs(nz - pc.z) < 0.8) {
                        return;
                    }
                    // Attempt to add block (checks inventory inside addBlock)
                    addBlock(nx, ny, nz, selectedBlockRef.current, false);
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
            if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;

            const delta = Math.min(clock.getDelta(), 0.1);

            // --- Sky Update ---
            const totalTime = clock.getElapsedTime();
            const dayProgress = (totalTime % dayDuration) / dayDuration; // 0 to 1
            
            // Calculate Sun Position (Simple circular motion overhead)
            // 0.0 = Sunrise (Left Horizon)
            // 0.25 = Noon (Top)
            // 0.5 = Sunset (Right Horizon)
            // 0.75 = Midnight (Bottom)
            
            const sunAngle = (dayProgress * Math.PI * 2) - (Math.PI / 2); // Start at -PI/2 (Left)
            const sunR = 150;
            sunLight.position.x = Math.cos(sunAngle) * sunR;
            sunLight.position.y = Math.sin(sunAngle) * sunR;
            sunLight.position.z = Math.cos(sunAngle * 0.5) * 50; // Add slight Z wobble

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
            ambientLight.intensity = 0.1 + (sunIntensity * 0.5); // Ambient varies with sun
            starMat.opacity = starOpacity;
            
            // Move Clouds
            clouds.forEach(c => {
                c.position.x += delta * 2;
                if(c.position.x > 300) c.position.x = -300;
            });
            
            // Rotate Stars
            skyGroup.rotation.y += delta * 0.01;

            // --- Physics & Player ---
            if (isLockedRef.current) {
                const player = playerRef.current;
                const cam = cameraRef.current;
                
                player.velocity.y -= 30 * delta; 

                const inputZ = Number(!!keysRef.current['KeyW']) - Number(!!keysRef.current['KeyS']);
                const inputX = Number(!!keysRef.current['KeyD']) - Number(!!keysRef.current['KeyA']);
                
                if (keysRef.current['Space'] && player.onGround) {
                    player.velocity.y = player.jumpForce;
                }

                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                forward.y = 0; forward.normalize();
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
                right.y = 0; right.normalize();

                const moveVec = new THREE.Vector3();
                moveVec.addScaledVector(forward, inputZ * player.speed * delta);
                moveVec.addScaledVector(right, inputX * player.speed * delta);

                const checkCollision = (x: number, y: number, z: number) => {
                    return !!chunksRef.current[getKey(Math.floor(x), Math.floor(y), Math.floor(z))];
                };

                if (!checkCollision(cam.position.x + moveVec.x, cam.position.y - 1, cam.position.z) &&
                    !checkCollision(cam.position.x + moveVec.x, cam.position.y, cam.position.z)) {
                    cam.position.x += moveVec.x;
                }
                if (!checkCollision(cam.position.x, cam.position.y - 1, cam.position.z + moveVec.z) &&
                    !checkCollision(cam.position.x, cam.position.y, cam.position.z + moveVec.z)) {
                    cam.position.z += moveVec.z;
                }

                player.onGround = false;
                const dy = player.velocity.y * delta;
                
                if (checkCollision(cam.position.x, cam.position.y - 1.5 + dy, cam.position.z)) {
                    player.velocity.y = 0;
                    player.onGround = true;
                    cam.position.y = Math.floor(cam.position.y - 1.5 + dy) + 2.5; 
                } else {
                    cam.position.y += dy;
                }
                
                if(player.velocity.y > 0 && checkCollision(cam.position.x, cam.position.y + 0.5, cam.position.z)) {
                   player.velocity.y = 0;
                }

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
                    blockCount: objectsRef.current.length,
                    x: Math.floor(cameraRef.current.position.x),
                    y: Math.floor(cameraRef.current.position.y),
                    z: Math.floor(cameraRef.current.position.z)
                });
                frameCount = 0;
                lastTime = time;
            }
        };

        // WebGPURenderer uses setAnimationLoop instead of requestAnimationFrame
        renderer.setAnimationLoop(animate);

        return () => {
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('pointerlockchange', handlePointerLockChange);
            
            if (rendererRef.current) {
                rendererRef.current.setAnimationLoop(null);
                rendererRef.current.dispose();
            }
            
            if (rendererRef.current && containerRef.current) {
                containerRef.current.removeChild(rendererRef.current.domElement);
            }
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