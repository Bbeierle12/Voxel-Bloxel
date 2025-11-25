import { GoogleGenAI, Type } from "@google/genai";
import { AiResponse, Inventory, ItemType } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SYSTEM_INSTRUCTION = `
You are an expert Voxel Architect for a Minecraft-like game.
Your goal is to help the user build structures or answer questions about the world.

Context provided in the prompt:
- Player Position: The player's current (x, y, z) coordinates.
- Inventory: The items available to the player.

When asked to build something:
1. Return a list of blocks to place relative to the player's position (0,0,0).
2. Keep structures reasonable in size (max ~100 blocks) to avoid performance issues.
3. Use the following Block IDs for construction:
   1: Grass
   2: Dirt
   3: Stone
   4: Wood
   5: Leaf
   6: Plank
4. Ensure the coordinates are integers.
5. Ground level is typically y=0 relative to the start, but for structures, build upwards from y=0 or y=1.

If the user asks a question (e.g., "What can I build?"), use their inventory context to provide a helpful suggestion in the "message" field.

Example Prompt: "Build a small tree"
Example Response Structure (JSON):
{
  "message": "Here is a small tree for you.",
  "blocks": [
    {"x": 0, "y": 0, "z": 0, "type": 4},
    {"x": 0, "y": 1, "z": 0, "type": 4},
    {"x": 0, "y": 2, "z": 0, "type": 4},
    {"x": 0, "y": 3, "z": 0, "type": 5},
    {"x": 1, "y": 2, "z": 0, "type": 5},
    {"x": -1, "y": 2, "z": 0, "type": 5},
    {"x": 0, "y": 2, "z": 1, "type": 5},
    {"x": 0, "y": 2, "z": -1, "type": 5}
  ]
}

If the user asks a question (e.g., "How do I play?"), provide a helpful message in the "message" field and an empty "blocks" array.
`;

export const generateStructure = async (
  prompt: string,
  playerPos: { x: number; y: number; z: number },
  inventory: Inventory
): Promise<AiResponse> => {
  try {
    // Format inventory for the AI
    const inventoryList = Object.entries(inventory)
      .filter(([_, count]) => count > 0)
      .map(([id, count]) => {
        const typeId = parseInt(id);
        const name = ItemType[typeId] || `Item_${id}`;
        return `${name} (${count})`;
      })
      .join(', ');

    const fullPrompt = `
Current Game Context:
- Player Position: x=${playerPos.x}, y=${playerPos.y}, z=${playerPos.z}
- Inventory: ${inventoryList || "Empty"}

User Request: "${prompt}"
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            message: { type: Type.STRING },
            blocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.INTEGER },
                  y: { type: Type.INTEGER },
                  z: { type: Type.INTEGER },
                  type: { type: Type.INTEGER },
                },
                required: ["x", "y", "z", "type"],
              },
            },
          },
          required: ["message"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as AiResponse;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      message: "Sorry, I encountered an error while thinking about that structure.",
      blocks: [],
    };
  }
};
