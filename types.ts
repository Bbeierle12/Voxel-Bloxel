export interface BlockData {
  x: number;
  y: number;
  z: number;
  type: number; // 1-6
}

export interface GameStats {
  fps: number;
  blockCount: number;
  x: number;
  y: number;
  z: number;
}

export enum ItemType {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  WOOD = 4,
  LEAF = 5,
  PLANK = 6,
  STICK = 100,
  WOODEN_PICKAXE = 101,
  WOODEN_SWORD = 102,
}

export interface AiResponse {
  message: string;
  blocks?: BlockData[]; // Optional blocks to build
}

// Ref interface for the Game Engine to expose methods to the UI
export interface GameEngineRef {
  placeBlocks: (blocks: BlockData[]) => void;
  getPlayerPosition: () => { x: number, y: number, z: number };
  requestLock: () => void;
}

export type Inventory = Record<number, number>;

export interface Recipe {
  id: string;
  name: string;
  result: ItemType;
  resultCount: number;
  ingredients: { type: ItemType; count: number }[];
}

export const RECIPES: Recipe[] = [
  {
    id: 'planks',
    name: 'Wood Planks',
    result: ItemType.PLANK,
    resultCount: 4,
    ingredients: [{ type: ItemType.WOOD, count: 1 }]
  },
  {
    id: 'sticks',
    name: 'Sticks',
    result: ItemType.STICK,
    resultCount: 4,
    ingredients: [{ type: ItemType.PLANK, count: 2 }]
  },
  {
    id: 'wooden_pickaxe',
    name: 'Wooden Pickaxe',
    result: ItemType.WOODEN_PICKAXE,
    resultCount: 1,
    ingredients: [
      { type: ItemType.PLANK, count: 3 },
      { type: ItemType.STICK, count: 2 }
    ]
  },
  {
    id: 'wooden_sword',
    name: 'Wooden Sword',
    result: ItemType.WOODEN_SWORD,
    resultCount: 1,
    ingredients: [
      { type: ItemType.PLANK, count: 2 },
      { type: ItemType.STICK, count: 1 }
    ]
  },
  {
    id: 'stone_bricks',
    name: 'Stone Bricks',
    result: ItemType.STONE,
    resultCount: 1,
    ingredients: [{ type: ItemType.DIRT, count: 2 }] 
  }
];