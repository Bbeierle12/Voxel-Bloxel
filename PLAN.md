# Living Environment System - Implementation Plan

## Overview
Create an embedded AI "World Mind" that perceives the voxel world, thinks about its state, and evolves it naturally. The AI becomes part of the world itself - not an external observer, but the living intelligence of the environment.

## Architecture

```
WorldMind (The Living World AI)
├── Perception Layer
│   ├── ChunkScanner (samples blocks around player)
│   ├── BiomeClassifier (understands terrain types)
│   └── ChangeDetector (notices player activity)
│
├── Cognition Layer (AI Decision Making)
│   ├── WorldState (what the world "knows")
│   ├── Intentions (what the world "wants")
│   └── Memory (what has happened)
│
├── Simulation Layer (Environmental Rules)
│   ├── GrassSpread ⭐ Priority 1
│   ├── LeafDecay ⭐ Priority 1
│   ├── TreeGrowth ⭐ Priority 2
│   ├── DayNightEffects ⭐ Priority 2
│   ├── WaterFlow (Priority 3)
│   └── FireSpread (Priority 3)
│
└── Action Layer
    ├── BlockPlacer (add blocks)
    ├── BlockRemover (remove blocks)
    └── EventEmitter (notify UI/sounds)
```

## Priority Implementation Order

### Phase 1: Foundation + Core Rules
1. `worldMind.ts` - Main AI service with tick loop
2. Grass spreading (dirt → grass near existing grass)
3. Leaf decay (leaves far from wood disappear)
4. Integration with App.tsx

### Phase 2: Growth + Time
5. Sapling system (new block type)
6. Tree growth (saplings → trees over time)
7. Day/night behavior modifiers

### Phase 3: Advanced
8. Water flow mechanics
9. Fire spread
10. Weather effects
11. AI-driven events (Claude integration for surprises)

## Implementation Details

### Phase 1 Files

| File | Purpose |
|------|---------|
| `services/ai/worldMind.ts` | Core AI - perception, cognition, action loop |
| `services/ai/environmentRules.ts` | Grass spread, leaf decay logic |
| `types.ts` | Add WorldMindState, EnvironmentConfig |
| `App.tsx` | Initialize WorldMind, connect to game loop |

### WorldMind Core Loop (500-1000ms tick)

```typescript
class WorldMind {
  // Perception: What does the world see?
  perceive(playerPos, engineRef) → WorldPerception

  // Cognition: What does the world think/want?
  think(perception) → WorldIntentions

  // Action: What changes should happen?
  act(intentions, engineRef) → BlockChanges[]
}
```

### Grass Spread Rule
- Scan dirt blocks near player (radius 32)
- For each dirt block with grass neighbor AND no block above:
  - 5-10% chance to convert to grass per tick
- Creates natural grass expansion over time

### Leaf Decay Rule
- Scan leaf blocks near player
- BFS search: is leaf connected to wood within 4 blocks?
- If not connected: 20% chance to decay per tick
- Decayed leaves occasionally drop saplings (future)