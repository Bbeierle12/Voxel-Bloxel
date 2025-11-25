import React, { useState, useEffect, useRef } from 'react';
import { GameStats, ItemType, Inventory, Recipe, RECIPES } from '../types';
import { generateStructure } from '../services/geminiService';
import { Send, Loader2, Sparkles, Box, Hammer, X, Backpack } from 'lucide-react';

interface UIOverlayProps {
    stats: GameStats;
    selectedSlot: number;
    isLocked: boolean;
    inventory: Inventory;
    onSlotSelect: (slot: number) => void;
    onAiResponse: (blocks: any[]) => void;
    onCraft: (recipe: Recipe) => void;
    onRequestLock: () => void;
}

// Map Slot Index to ItemType
const SLOT_TO_ITEM = [
    ItemType.GRASS, // Slot 0
    ItemType.DIRT,  // Slot 1
    ItemType.STONE, // Slot 2
    ItemType.WOOD,  // Slot 3
    ItemType.LEAF,  // Slot 4
    ItemType.PLANK, // Slot 5
];

const UIOverlay: React.FC<UIOverlayProps> = ({ stats, selectedSlot, isLocked, inventory, onSlotSelect, onAiResponse, onCraft, onRequestLock }) => {
    const [showChat, setShowChat] = useState(false);
    const [showInventory, setShowInventory] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [aiMessage, setAiMessage] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Key handlers
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Chat 'T'
            if (e.code === 'KeyT' && isLocked && !showChat && !showInventory) {
                document.exitPointerLock();
                setShowChat(true);
                e.preventDefault();
                setTimeout(() => inputRef.current?.focus(), 100);
            }
            // Inventory 'E'
            if (e.code === 'KeyE') {
                if (showChat) return; // Don't open if chatting
                if (isLocked) {
                    document.exitPointerLock();
                    setShowInventory(true);
                } else if (showInventory) {
                    setShowInventory(false);
                    // Optional: re-request lock if we click back on screen
                }
            }
            // Close with Escape
            if (e.code === 'Escape') {
                if (showChat) setShowChat(false);
                if (showInventory) setShowInventory(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLocked, showChat, showInventory]);

    const handleAiSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim()) return;

        setIsLoading(true);
        setAiMessage(null);
        
        const response = await generateStructure(
            prompt, 
            { x: stats.x, y: stats.y, z: stats.z }, 
            inventory
        );
        
        setIsLoading(false);
        setAiMessage(response.message);
        
        if (response.blocks && response.blocks.length > 0) {
            onAiResponse(response.blocks);
            setTimeout(() => {
                setShowChat(false);
                setPrompt('');
                setAiMessage(null);
            }, 2000);
        }
    };

    // Helper to get item name/color
    const getItemMeta = (type: ItemType) => {
        switch (type) {
            case ItemType.GRASS: return { name: 'Grass', color: 'bg-[#5bac38]' };
            case ItemType.DIRT: return { name: 'Dirt', color: 'bg-[#8b5a2b]' };
            case ItemType.STONE: return { name: 'Stone', color: 'bg-[#696969]' };
            case ItemType.WOOD: return { name: 'Wood', color: 'bg-[#654321]' };
            case ItemType.LEAF: return { name: 'Leaf', color: 'bg-[#2d5a27]' };
            case ItemType.PLANK: return { name: 'Plank', color: 'bg-[#C19A6B]' };
            case ItemType.STICK: return { name: 'Stick', color: 'bg-amber-200' };
            case ItemType.WOODEN_PICKAXE: return { name: 'Wooden Pickaxe', color: 'bg-amber-700' };
            case ItemType.WOODEN_SWORD: return { name: 'Wooden Sword', color: 'bg-amber-600' };
            default: return { name: 'Unknown', color: 'bg-gray-500' };
        }
    };

    // Hotbar definition
    const hotbarSlots = SLOT_TO_ITEM.map((type, index) => {
        const meta = getItemMeta(type);
        const count = inventory[type] || 0;
        return { id: index, type, ...meta, count };
    });

    const canCraft = (recipe: Recipe) => {
        return recipe.ingredients.every(ing => (inventory[ing.type] || 0) >= ing.count);
    };

    return (
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
            {/* Crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 border-2 border-white/80 rounded-full flex items-center justify-center z-10">
                <div className="w-1 h-1 bg-white rounded-full"></div>
            </div>

            {/* Top Stats */}
            <div className="p-4 flex flex-col gap-1 text-white text-sm font-mono bg-black/20 backdrop-blur-sm w-fit m-4 rounded-lg border border-white/10 shadow-lg">
                <div className="flex items-center gap-2 font-bold text-sky-400">
                    <Box size={16} /> Voxel Verse AI
                </div>
                <div>FPS: {stats.fps}</div>
                <div>Blocks: {stats.blockCount}</div>
                <div>Pos: {stats.x}, {stats.y}, {stats.z}</div>
                <div className="text-xs text-gray-300 mt-2">
                    [T] AI Architect | [E] Inventory
                </div>
            </div>

            {/* Inventory & Crafting Modal */}
            {showInventory && (
                <div className="absolute inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center pointer-events-auto z-50">
                    <div className="bg-gray-900 border border-white/20 rounded-2xl w-[800px] h-[500px] flex shadow-2xl overflow-hidden">
                        
                        {/* Left: Inventory Grid */}
                        <div className="w-1/2 p-6 border-r border-white/10 flex flex-col">
                            <h2 className="text-white text-xl font-bold mb-4 flex items-center gap-2">
                                <Backpack size={20} /> Backpack
                            </h2>
                            <div className="flex flex-wrap content-start gap-3 overflow-y-auto pr-2 custom-scrollbar">
                                {/* Only show items we have or that exist */}
                                {Object.keys(ItemType).filter(k => isNaN(Number(k)) && k !== 'AIR').map((key) => {
                                    const typeStr = key as keyof typeof ItemType;
                                    const typeId = ItemType[typeStr];
                                    const meta = getItemMeta(typeId);
                                    const count = inventory[typeId] || 0;
                                    
                                    return (
                                        <div 
                                            key={typeId} 
                                            title={meta.name}
                                            className={`
                                                relative w-16 h-16 rounded-xl border-2 flex items-center justify-center group transition-all duration-200 select-none
                                                ${count > 0 
                                                    ? 'bg-gray-800 border-gray-600 hover:border-blue-400 hover:bg-gray-700 hover:scale-105 shadow-lg' 
                                                    : 'bg-gray-900/40 border-gray-800 opacity-40 grayscale cursor-default'}
                                            `}
                                        >
                                            <div className={`w-8 h-8 rounded-sm ${meta.color} shadow-sm ${count === 0 ? 'opacity-70' : ''}`}></div>
                                            
                                            {/* Count Pill */}
                                            {count > 0 && (
                                                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/10 shadow-sm">
                                                    {count}
                                                </div>
                                            )}

                                            {/* Custom Tooltip */}
                                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-white/20 shadow-xl z-50">
                                                {meta.name}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right: Crafting */}
                        <div className="w-1/2 p-6 flex flex-col bg-gray-800/50">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-white text-xl font-bold flex items-center gap-2">
                                    <Hammer size={20} /> Crafting
                                </h2>
                                <button onClick={() => setShowInventory(false)} className="text-gray-400 hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                {RECIPES.map((recipe) => {
                                    const resultMeta = getItemMeta(recipe.result);
                                    const craftable = canCraft(recipe);

                                    return (
                                        <div key={recipe.id} className="bg-gray-900/50 p-3 rounded-lg border border-white/5 flex items-center justify-between hover:border-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-md ${resultMeta.color} flex items-center justify-center text-xs font-bold text-white/90 shadow-inner`}>
                                                    {recipe.resultCount > 1 && recipe.resultCount}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-white font-medium text-sm">{recipe.name}</span>
                                                    <div className="flex gap-2 text-xs text-gray-400">
                                                        {recipe.ingredients.map((ing, i) => (
                                                            <span key={i} className={inventory[ing.type] >= ing.count ? 'text-green-400' : 'text-red-400'}>
                                                                {ing.count} {getItemMeta(ing.type).name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => onCraft(recipe)}
                                                disabled={!craftable}
                                                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                                                    craftable 
                                                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20' 
                                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                                }`}
                                            >
                                                Craft
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Chat Interface */}
            {showChat && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md pointer-events-auto z-50">
                    <div className="bg-gray-900/95 border border-white/20 rounded-xl shadow-2xl overflow-hidden backdrop-blur-md">
                        <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 flex items-center gap-2 text-white">
                            <Sparkles className="w-5 h-5 text-yellow-300" />
                            <h3 className="font-bold">Gemini Architect</h3>
                        </div>
                        <div className="p-6">
                            {aiMessage && (
                                <div className="mb-4 p-3 bg-white/10 rounded-lg text-sm text-gray-200 border-l-4 border-indigo-500">
                                    {aiMessage}
                                </div>
                            )}
                            <form onSubmit={handleAiSubmit} className="flex gap-2">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="e.g. Build a small treehouse..."
                                    className="flex-1 bg-black/50 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-all placeholder-gray-500"
                                    disabled={isLoading}
                                />
                                <button type="submit" disabled={isLoading || !prompt.trim()} className="bg-indigo-600 hover:bg-indigo-500 text-white p-3 rounded-lg disabled:opacity-50 transition-colors">
                                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Start Overlay */}
            {!isLocked && !showChat && !showInventory && (
                <div 
                    onClick={onRequestLock}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-auto cursor-pointer"
                >
                    <div className="bg-gray-900/90 p-8 rounded-2xl border border-white/20 text-center max-w-lg shadow-2xl">
                        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 mb-6">
                            Voxel Verse AI
                        </h1>
                        <div className="grid grid-cols-2 gap-4 text-left text-gray-300 text-sm mb-8">
                            <div className="flex items-center gap-3"><kbd className="bg-gray-800 px-2 py-1 rounded border border-gray-600">WASD</kbd> Move</div>
                            <div className="flex items-center gap-3"><kbd className="bg-gray-800 px-2 py-1 rounded border border-gray-600">SPACE</kbd> Jump</div>
                            <div className="flex items-center gap-3"><kbd className="bg-gray-800 px-2 py-1 rounded border border-gray-600">L-Click</kbd> Break Block</div>
                            <div className="flex items-center gap-3"><kbd className="bg-gray-800 px-2 py-1 rounded border border-gray-600">R-Click</kbd> Place Block</div>
                            <div className="flex items-center gap-3 text-yellow-400 font-bold"><kbd className="bg-gray-800 px-2 py-1 rounded border border-gray-600 text-white font-normal">T</kbd> Ask Gemini AI</div>
                            <div className="flex items-center gap-3 text-green-400 font-bold"><kbd className="bg-gray-800 px-2 py-1 rounded border border-gray-600 text-white font-normal">E</kbd> Inventory</div>
                        </div>
                        <div className="text-white animate-pulse font-bold text-lg pointer-events-none">
                            Click anywhere to Start
                        </div>
                    </div>
                </div>
            )}

            {/* Hotbar */}
            <div className="mb-6 self-center pointer-events-auto z-10">
                <div className="flex gap-2 bg-black/60 p-2 rounded-xl backdrop-blur-md border border-white/10">
                    {hotbarSlots.map((slot) => (
                        <div
                            key={slot.id}
                            className={`
                                relative w-14 h-14 rounded-lg border-2 flex items-center justify-center transition-all duration-200 cursor-pointer
                                ${selectedSlot === slot.id 
                                    ? 'border-yellow-400 scale-110 shadow-[0_0_15px_rgba(250,204,21,0.5)] z-10' 
                                    : 'border-white/20 opacity-80 hover:opacity-100'}
                                ${slot.count === 0 && selectedSlot === slot.id ? 'opacity-100' : ''}
                                ${slot.count === 0 && selectedSlot !== slot.id ? 'opacity-40 grayscale' : ''}
                                ${slot.color}
                            `}
                            onClick={() => onSlotSelect(slot.id)}
                        >
                            {/* Slot ID for selection (1-6) */}
                            <span className="text-white font-bold text-shadow text-lg drop-shadow-md">{slot.id + 1}</span>
                            
                            {/* Count Badge */}
                            <div className="absolute -top-2 -right-2 bg-gray-900 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center border border-white/30">
                                {slot.count}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default UIOverlay;