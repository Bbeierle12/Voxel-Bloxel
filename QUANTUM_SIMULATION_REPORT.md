# Quantum Simulation Report for Voxel-Bloxel

## Executive Summary

This report outlines quantum computing capabilities that can be simulated in Voxel-Bloxel, organized by qubit count. The game runs in a browser environment (React + Three.js), which constrains the practical maximum to **20-25 qubits** before memory and performance become prohibitive.

---

## Hardware Constraints

### Memory Requirements

| Qubits | State Vector Size | Memory Required | Feasibility |
|--------|-------------------|-----------------|-------------|
| 1 | 2 amplitudes | 32 bytes | Trivial |
| 5 | 32 amplitudes | 512 bytes | Trivial |
| 10 | 1,024 amplitudes | 16 KB | Easy |
| 15 | 32,768 amplitudes | 512 KB | Easy |
| 20 | 1,048,576 amplitudes | 16 MB | Moderate |
| 25 | 33,554,432 amplitudes | 512 MB | Challenging |
| 30 | 1,073,741,824 amplitudes | 16 GB | Impractical |

*Each amplitude = 2 floats (real + imaginary) = 16 bytes*

### Recommended Limits for Voxel-Bloxel

- **Comfortable operation:** 1-15 qubits
- **Maximum practical:** 20 qubits
- **Absolute ceiling:** 25 qubits (will cause frame drops)

---

## Qubit-by-Qubit Capabilities

---

## 1 QUBIT

### Quantum Properties
- 2 basis states: |0⟩, |1⟩
- Superposition: α|0⟩ + β|1⟩
- Single-qubit gates: X, Y, Z, H, S, T, Rx, Ry, Rz

### Limitations
- No entanglement
- Equivalent to weighted random number

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `quantumCoinFlip()` | 50/50 random outcome | Basic randomization |
| `biasedQuantumRandom(p)` | Weighted probability | Loot drop chances |
| `blochSphereDisplay()` | 3D visualization | Educational block |

### Honest Value: **Minimal** - Just a fancy Math.random()

---

## 2 QUBITS

### Quantum Properties
- 4 basis states: |00⟩, |01⟩, |10⟩, |11⟩
- **Entanglement** (Bell states)
- 2-qubit gates: CNOT, CZ, SWAP

### New Capability: Entanglement
```
Bell State: (|00⟩ + |11⟩) / √2
Measure qubit A → qubit B outcome is instantly determined
```

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `createEntangledPair()` | Generate Bell state | Paired items/blocks |
| `measureEntangled(qubit)` | Collapse with correlation | Linked outcomes |
| `quantumTeleportState()` | Transfer state A→B | Teleportation effect |
| `bellStateSelector(type)` | Choose Φ+, Φ-, Ψ+, Ψ- | Correlation type |

### Game Mechanics

#### Entangled Blocks
- Place two "quantum ore" blocks anywhere in world
- Mine one → collapses to diamond or coal
- Other block **instantly** becomes the same (correlated)
- Cannot be cheated by save/reload

#### Twin Entities
- Spawn entangled mob pair
- Damage one → other takes correlated damage
- Kill one → other's survival is determined

#### Quantum Keys
- Two entangled key items
- One player uses key A → lock opens/stays closed
- Other player's key B is now determined (same state)

### Honest Value: **Low-Medium** - Correlated randomness has gameplay potential

---

## 3 QUBITS

### Quantum Properties
- 8 basis states
- GHZ states: (|000⟩ + |111⟩) / √2
- W states: (|001⟩ + |010⟩ + |100⟩) / √3
- Toffoli gate (controlled-controlled-NOT)

### New Capability: Multi-party Entanglement
Three-way correlations impossible classically.

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `createGHZState()` | 3-way all-or-nothing | Team mechanics |
| `createWState()` | Distributed single excitation | Shared resources |
| `toffoliGate(c1, c2, target)` | AND logic on qubits | Quantum circuits |
| `quantumVoting()` | 3-outcome superposition | NPC decisions |

### Game Mechanics

#### Quantum Triumvirate
- Three players hold entangled tokens
- All measure simultaneously
- GHZ: All get same result (all win or all lose)
- W: Exactly one gets the prize

#### Three-State Blocks
- Block exists as grass/stone/diamond
- Probabilities shift based on surroundings
- Collapse on interaction

#### Quantum AND Gate (Puzzle)
- Two input levers, one output door
- Door opens only if both levers measured as |1⟩
- But levers are in superposition until checked

### Honest Value: **Medium** - Multiplayer mechanics become interesting

---

## 4 QUBITS

### Quantum Properties
- 16 basis states
- Cluster states for measurement-based computing
- Full set of 2-qubit interactions

### New Capability: Simple Quantum Circuits

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `createClusterState()` | Graph state entanglement | Circuit puzzles |
| `quantumAdder()` | Add two 2-bit numbers | Quantum calculator |
| `fourWayEntangle()` | 4-party correlations | Party mechanics |
| `quantumMemory(2bit)` | Store 2 classical bits | Quantum storage |

### Game Mechanics

#### Quantum Circuit Puzzle
- Build circuits with 4 qubits
- Apply gates to reach target state
- Educational minigame

#### 4-Player Quantum Raid
- Boss drops loot in 4-qubit superposition
- Players' measurements determine who gets what
- Entanglement ensures fairness/correlations

#### Quantum Compass
- 4 directions in superposition
- Measurement gives direction hint
- Subsequent measurements are correlated

### Honest Value: **Medium** - Circuit puzzles become viable

---

## 5-8 QUBITS

### Quantum Properties
- 32-256 basis states
- Error detection codes (5-qubit code)
- Meaningful superpositions over many states

### New Capabilities
- Simple quantum algorithms
- Quantum error detection
- Grover's algorithm (2-3 iterations useful)

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `groverSearch(n)` | Quadratic speedup search | Finding hidden items |
| `quantumErrorDetect()` | Detect bit flip errors | Corruption mechanics |
| `deutschJozsa(oracle)` | Constant vs balanced | Oracle puzzles |
| `quantumRNG(bits)` | Multi-bit random | High-quality randomness |
| `superpositionInventory(8)` | Item in 8 states | Quantum inventory slot |

### Game Mechanics

#### Grover's Oracle (5+ qubits)
- Hidden treasure in one of 2^n locations
- Classical: check each location
- Quantum: find in √(2^n) checks
- Actual speedup in minigame

#### Quantum Corruption
- World data encoded in 5-qubit error code
- Corruption (bit flips) can be detected
- Player must "repair" quantum state

#### Superposition Chest (8 qubits)
- Chest contains 256 possible items
- Apply gates to bias toward desired item
- Measurement collapses to one item

### Honest Value: **Medium-High** - Algorithms start being demonstrable

---

## 9-12 QUBITS

### Quantum Properties
- 512-4,096 basis states
- Quantum Fourier Transform practical
- Phase estimation possible

### New Capabilities
- QFT-based algorithms
- Simple quantum simulation
- Variational algorithms

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `quantumFourierTransform()` | Frequency analysis | Signal processing |
| `phaseEstimation(unitary)` | Extract eigenvalue | Hidden property detection |
| `VQE(hamiltonian)` | Variational eigensolver | Optimization minigame |
| `quantumWalk(graph)` | Quantum random walk | Pathfinding |
| `simulateMolecule(simple)` | H2-level simulation | Crafting chemistry |

### Game Mechanics

#### Quantum Chemistry Crafting (10+ qubits)
- Simple molecules (H2, HeH+) simulated
- Quantum state determines properties
- Combine atoms → run VQE → get material properties

#### Quantum Maze Walker
- Maze with 2^10 = 1024 paths
- Quantum walk explores in superposition
- Finds exit faster than classical

#### Frequency Analysis Tool
- Apply QFT to detect hidden patterns
- Find buried structures via "quantum sonar"

### Honest Value: **High** - Real quantum algorithms work

---

## 13-16 QUBITS

### Quantum Properties
- 8,192-65,536 basis states
- Meaningful quantum advantage demonstrations
- Complex entanglement structures

### New Capabilities
- Shor's algorithm (very small numbers)
- Better Grover's search
- Quantum machine learning basics

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `shorFactor(15)` | Factor N=15 | Cryptography demo |
| `groverSearch(4096)` | Search 4096 items | Large search |
| `QAOA(problem)` | Optimization | Route planning |
| `quantumClassifier()` | Simple QML | Mob classification |
| `quantumTerrain(seed)` | Quantum procedural gen | Unique terrain |

### Game Mechanics

#### Quantum Code Breaking (15 qubits)
- Factor small semiprime (15 = 3 × 5)
- Break simple in-game encryption
- Educational Shor's algorithm demo

#### Quantum Autopilot
- QAOA solves traveling salesman
- Optimizes trade routes
- Quantum advantage over greedy algorithms

#### Quantum Procedural Generation
- 16-qubit state seeds terrain
- Truly non-reproducible without quantum state
- Different from classical PRNGs

### Honest Value: **High** - Shor's algorithm demonstrable

---

## 17-20 QUBITS

### Quantum Properties
- 131,072-1,048,576 basis states
- ~16MB memory usage at 20 qubits
- Approaching classical simulation limits

### New Capabilities
- Factor larger numbers (21 = 3 × 7)
- Complex quantum simulations
- Meaningful quantum ML

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `quantumSimulation(system)` | Simulate quantum systems | Physics sandbox |
| `quantumNeuralNetwork()` | QNN classifier | AI enhancement |
| `quantumOptimizer(problem)` | Complex optimization | World optimization |
| `quantumCryptography()` | QKD simulation | Secure communication |
| `quantumSampling()` | Hard distributions | Unique randomness |

### Game Mechanics

#### Quantum Physics Lab (20 qubits)
- Simulate small quantum systems
- Ising models, spin chains
- Educational sandbox

#### Quantum-Enhanced AI
- NPCs use quantum classifier
- Different behavior than classical
- Unpredictable in specific ways

#### Quantum Key Distribution
- Players exchange quantum keys
- Eve (eavesdropper) detection
- Secure in-game communication

### Honest Value: **Very High** - Maximum practical capability

---

## 21-25 QUBITS (Maximum Ceiling)

### Quantum Properties
- 2-33 million basis states
- 32-512 MB memory
- **Performance warning zone**

### Constraints
- Frame rate drops likely
- Async computation required
- Web Worker offloading needed

### Game Functions

| Function | Description | Gameplay Use |
|----------|-------------|--------------|
| `factorInteger(n)` | Factor up to ~35 | Larger crypto puzzles |
| `quantumSupremacy()` | Sample hard distribution | Proof of quantumness |
| `fullQFT(25)` | Full 25-qubit QFT | Signal analysis |
| `quantumChemistry(LiH)` | Larger molecules | Advanced crafting |

### Game Mechanics

#### Quantum Supremacy Challenge
- Generate distribution classically impossible
- Prove you have "quantum computer"
- Meta achievement

#### Advanced Quantum Chemistry
- Simulate LiH, BeH2
- Derive material properties
- End-game crafting system

### Honest Value: **Maximum** - Pushing browser limits

---

## BEYOND 25 QUBITS

### Not Recommended for Browser Game

| Qubits | Memory | Status |
|--------|--------|--------|
| 26-29 | 1-8 GB | Desktop app only |
| 30+ | 16+ GB | Real quantum hardware required |

### Alternative: Quantum Cloud APIs
- IBM Quantum (free tier: 127 qubits)
- Amazon Braket
- Google Quantum AI

This would allow true quantum execution but adds latency and API costs.

---

## Summary Table

| Qubits | Memory | Key Unlocks | Best Game Use |
|--------|--------|-------------|---------------|
| 1 | 32 B | Superposition | Random events |
| 2 | 64 B | Entanglement | Paired items |
| 3 | 128 B | GHZ/W states | Multiplayer sync |
| 4 | 256 B | Simple circuits | Puzzle blocks |
| 5-8 | 0.5-4 KB | Grover, error codes | Search minigames |
| 9-12 | 8-64 KB | QFT, VQE | Chemistry crafting |
| 13-16 | 128 KB-1 MB | Shor (small) | Crypto puzzles |
| 17-20 | 2-16 MB | Full algorithms | Quantum lab |
| 21-25 | 32-512 MB | Maximum simulation | End-game content |

---

## Recommended Implementation Tiers

### Tier 1: Core (1-4 qubits)
- Quantum random events
- Entangled block pairs
- Basic visualization
- **Development time: 1-2 weeks**

### Tier 2: Gameplay (5-12 qubits)
- Grover's search minigame
- Quantum circuit puzzles
- Chemistry crafting basics
- **Development time: 3-4 weeks**

### Tier 3: Advanced (13-20 qubits)
- Shor's algorithm demo
- Quantum optimization
- Full quantum lab
- **Development time: 2-3 months**

### Tier 4: Maximum (21-25 qubits)
- Async computation
- Worker thread offloading
- Performance optimization
- **Development time: 1-2 months additional**

---

## Technical Implementation Notes

### State Vector Representation
```typescript
interface QuantumState {
  numQubits: number;
  amplitudes: Complex[]; // Length = 2^numQubits
}

interface Complex {
  real: number;
  imag: number;
}
```

### Gate Operations
All gates are unitary matrices applied to state vector:
- 1-qubit gate: 2×2 matrix
- 2-qubit gate: 4×4 matrix
- n-qubit gate: 2^n × 2^n matrix

### Performance Optimization
- Use Float64Array for amplitudes
- Web Workers for >15 qubits
- Sparse representation for special states
- GPU acceleration via WebGPU (if available)

---

## Conclusion

Voxel-Bloxel can practically simulate **up to 20-25 qubits** in-browser. The sweet spot for gameplay is **8-16 qubits**, providing meaningful quantum algorithms (Grover, simple Shor, VQE) without performance issues.

**Recommended starting point:** Implement 1-4 qubits for entangled items and basic mechanics, then expand based on player interest.
