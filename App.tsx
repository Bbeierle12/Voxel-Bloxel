import React, { useState, useRef, useCallback } from 'react';
import VoxelEngine from './components/VoxelEngine';
import UIOverlay from './components/UIOverlay';
import { GameStats, GameEngineRef, BlockData, Inventory, ItemType, Recipe } from './types';

function App() {
  const [gameStats, setGameStats] = useState<GameStats>({ fps: 0, blockCount: 0, x: 0, y: 0, z: 0 });
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  
  // Initial Inventory: Some starting materials
  const [inventory, setInventory] = useState<Inventory>({
    [ItemType.WOOD]: 10,
    [ItemType.STONE]: 5,
    [ItemType.DIRT]: 10,
    [ItemType.GRASS]: 5,
  });
  
  const engineRef = useRef<GameEngineRef>(null);

  const handleStatsUpdate = useCallback((stats: GameStats) => {
    setGameStats(stats);
  }, []);

  const handleAiBlocks = (blocks: BlockData[]) => {
    if (engineRef.current) {
      engineRef.current.placeBlocks(blocks);
    }
  };

  // Block Interaction Logic
  const handleBlockBreak = useCallback((type: ItemType) => {
    setInventory(prev => ({
      ...prev,
      [type]: (prev[type] || 0) + 1
    }));
  }, []);

  const checkCanPlace = useCallback((type: ItemType) => {
    // Creative mode for "Leaf" or unlimited blocks if needed? 
    // For now, strict survival: need item in inventory.
    return (inventory[type] || 0) > 0;
  }, [inventory]);

  const handleBlockPlace = useCallback((type: ItemType) => {
    setInventory(prev => ({
      ...prev,
      [type]: Math.max(0, (prev[type] || 0) - 1)
    }));
  }, []);

  const handleCraft = (recipe: Recipe) => {
    // Double check requirements
    const canCraft = recipe.ingredients.every(ing => (inventory[ing.type] || 0) >= ing.count);
    
    if (canCraft) {
      setInventory(prev => {
        const next = { ...prev };
        // Consume ingredients
        recipe.ingredients.forEach(ing => {
          next[ing.type] = (next[ing.type] || 0) - ing.count;
        });
        // Add result
        next[recipe.result] = (next[recipe.result] || 0) + recipe.resultCount;
        return next;
      });
    }
  };

  const handleRequestLock = useCallback(() => {
    engineRef.current?.requestLock();
  }, []);

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <VoxelEngine 
        ref={engineRef}
        onStatsUpdate={handleStatsUpdate}
        onLockChange={setIsLocked}
        selectedBlockIndex={selectedSlot}
        onBlockBreak={handleBlockBreak}
        checkCanPlace={checkCanPlace}
        onBlockPlace={handleBlockPlace}
      />
      
      <UIOverlay 
        stats={gameStats}
        selectedSlot={selectedSlot}
        isLocked={isLocked}
        inventory={inventory}
        onSlotSelect={setSelectedSlot}
        onAiResponse={handleAiBlocks}
        onCraft={handleCraft}
        onRequestLock={handleRequestLock}
      />
    </div>
  );
}

export default App;