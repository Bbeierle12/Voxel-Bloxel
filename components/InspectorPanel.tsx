import React, { useState } from "react";
import { Entity, Vector3 } from "../types";

// ============================================================================
// INSPECTOR PANEL COMPONENT
// Entity property editor for position, rotation, physics, textures
// ============================================================================

interface InspectorPanelProps {
  entity: Entity | null;
  onUpdateEntity: (id: string, updates: Partial<Entity>) => void;
  onDeleteEntity: (id: string) => void;
  onGenerateTexture?: (entityId: string, description: string) => Promise<void>;
  isGeneratingTexture?: boolean;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  entity,
  onUpdateEntity,
  onDeleteEntity,
  onGenerateTexture,
  isGeneratingTexture = false,
}) => {
  const [texturePrompt, setTexturePrompt] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["transform", "physics", "appearance"])
  );

  if (!entity) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
        <span className="text-4xl mb-2">🔍</span>
        <p className="text-sm text-center">
          No entity selected.
          <br />
          Click on an entity in the world to inspect it.
        </p>
      </div>
    );
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleVectorChange = (
    property: "position" | "rotation" | "scale" | "velocity",
    axis: "x" | "y" | "z",
    value: string
  ) => {
    const numValue = parseFloat(value) || 0;
    onUpdateEntity(entity.id, {
      [property]: {
        ...entity[property],
        [axis]: numValue,
      },
    });
  };

  const handlePhysicsChange = (
    property: keyof Entity["physics"],
    value: string | boolean
  ) => {
    const newValue =
      typeof value === "boolean" ? value : parseFloat(value as string) || 0;
    onUpdateEntity(entity.id, {
      physics: {
        ...entity.physics,
        [property]: newValue,
      },
    });
  };

  const VectorInput: React.FC<{
    label: string;
    value: Vector3;
    onChange: (axis: "x" | "y" | "z", value: string) => void;
    step?: number;
  }> = ({ label, value, onChange, step = 0.1 }) => (
    <div className="mb-3">
      <label className="text-gray-400 text-xs block mb-1">{label}</label>
      <div className="flex gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis} className="flex-1">
            <div className="flex items-center gap-1">
              <span
                className={`text-xs font-medium ${
                  axis === "x"
                    ? "text-red-400"
                    : axis === "y"
                    ? "text-green-400"
                    : "text-blue-400"
                }`}
              >
                {axis.toUpperCase()}
              </span>
              <input
                type="number"
                value={value[axis].toFixed(2)}
                onChange={(e) => onChange(axis, e.target.value)}
                step={step}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const SectionHeader: React.FC<{
    title: string;
    icon: string;
    section: string;
  }> = ({ title, icon, section }) => (
    <button
      onClick={() => toggleSection(section)}
      className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 transition-colors"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-white">
        {icon} {title}
      </span>
      <span className="text-gray-400">
        {expandedSections.has(section) ? "▼" : "▶"}
      </span>
    </button>
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="h-full overflow-y-auto bg-gray-900">
      {/* Entity Header */}
      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <input
              type="text"
              value={entity.name}
              onChange={(e) => onUpdateEntity(entity.id, { name: e.target.value })}
              className="bg-transparent text-white font-medium text-sm focus:outline-none border-b border-transparent focus:border-purple-500"
            />
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500">{entity.type}</span>
              <code className="text-xs bg-gray-700 px-1.5 py-0.5 rounded text-gray-400">
                {entity.id.slice(0, 12)}...
              </code>
            </div>
          </div>
          <button
            onClick={() => onDeleteEntity(entity.id)}
            className="p-1.5 text-red-400 hover:bg-red-900/30 rounded transition-colors"
            title="Delete Entity"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Transform Section */}
      <div className="border-b border-gray-700">
        <SectionHeader title="Transform" icon="📐" section="transform" />
        {expandedSections.has("transform") && (
          <div className="p-3">
            <VectorInput
              label="Position"
              value={entity.position}
              onChange={(axis, value) => handleVectorChange("position", axis, value)}
              step={0.5}
            />
            <VectorInput
              label="Rotation (radians)"
              value={entity.rotation}
              onChange={(axis, value) => handleVectorChange("rotation", axis, value)}
              step={0.1}
            />
            <VectorInput
              label="Scale"
              value={entity.scale}
              onChange={(axis, value) => handleVectorChange("scale", axis, value)}
              step={0.1}
            />
            <VectorInput
              label="Velocity"
              value={entity.velocity}
              onChange={(axis, value) => handleVectorChange("velocity", axis, value)}
              step={0.5}
            />
          </div>
        )}
      </div>

      {/* Physics Section */}
      <div className="border-b border-gray-700">
        <SectionHeader title="Physics" icon="⚡" section="physics" />
        {expandedSections.has("physics") && (
          <div className="p-3 space-y-3">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Mass</label>
              <input
                type="number"
                value={entity.physics.mass}
                onChange={(e) => handlePhysicsChange("mass", e.target.value)}
                step={0.1}
                min={0}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Friction</label>
              <input
                type="range"
                value={entity.physics.friction}
                onChange={(e) => handlePhysicsChange("friction", e.target.value)}
                step={0.01}
                min={0}
                max={1}
                className="w-full"
              />
              <span className="text-gray-400 text-xs">
                {entity.physics.friction.toFixed(2)}
              </span>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">
                Restitution (Bounciness)
              </label>
              <input
                type="range"
                value={entity.physics.restitution}
                onChange={(e) => handlePhysicsChange("restitution", e.target.value)}
                step={0.01}
                min={0}
                max={1}
                className="w-full"
              />
              <span className="text-gray-400 text-xs">
                {entity.physics.restitution.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isStatic"
                checked={entity.physics.isStatic}
                onChange={(e) => handlePhysicsChange("isStatic", e.target.checked)}
                className="w-4 h-4 rounded bg-gray-700 border-gray-600"
              />
              <label htmlFor="isStatic" className="text-gray-300 text-sm">
                Static (doesn't move)
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Appearance Section */}
      <div className="border-b border-gray-700">
        <SectionHeader title="Appearance" icon="🎨" section="appearance" />
        {expandedSections.has("appearance") && (
          <div className="p-3 space-y-3">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={entity.color}
                  onChange={(e) => onUpdateEntity(entity.id, { color: e.target.value })}
                  className="w-10 h-8 rounded border border-gray-600 cursor-pointer"
                />
                <input
                  type="text"
                  value={entity.color}
                  onChange={(e) => onUpdateEntity(entity.id, { color: e.target.value })}
                  className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={entity.visible}
                  onChange={(e) =>
                    onUpdateEntity(entity.id, { visible: e.target.checked })
                  }
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                />
                Visible
              </label>
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={entity.wireframe}
                  onChange={(e) =>
                    onUpdateEntity(entity.id, { wireframe: e.target.checked })
                  }
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                />
                Wireframe
              </label>
            </div>

            {/* AI Texture Generation */}
            {onGenerateTexture && (
              <div className="pt-2 border-t border-gray-700">
                <label className="text-gray-400 text-xs block mb-1">
                  🤖 AI Texture Generation
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={texturePrompt}
                    onChange={(e) => setTexturePrompt(e.target.value)}
                    placeholder="e.g., rusty metal plate"
                    disabled={isGeneratingTexture}
                    className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={() => {
                      if (texturePrompt.trim()) {
                        onGenerateTexture(entity.id, texturePrompt);
                        setTexturePrompt("");
                      }
                    }}
                    disabled={!texturePrompt.trim() || isGeneratingTexture}
                    className="px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white text-xs rounded transition-colors"
                  >
                    {isGeneratingTexture ? "..." : "Generate"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tags Section */}
      <div className="border-b border-gray-700">
        <SectionHeader title="Tags" icon="🏷️" section="tags" />
        {expandedSections.has("tags") && (
          <div className="p-3">
            <div className="flex flex-wrap gap-1 mb-2">
              {entity.tags.map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded"
                >
                  {tag}
                  <button
                    onClick={() => {
                      const newTags = entity.tags.filter((_, i) => i !== index);
                      onUpdateEntity(entity.id, { tags: newTags });
                    }}
                    className="text-gray-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Add tag (press Enter)"
              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) {
                  const newTag = e.currentTarget.value.trim();
                  if (!entity.tags.includes(newTag)) {
                    onUpdateEntity(entity.id, {
                      tags: [...entity.tags, newTag],
                    });
                  }
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Metadata Section */}
      <div className="border-b border-gray-700">
        <SectionHeader title="Metadata" icon="📋" section="metadata" />
        {expandedSections.has("metadata") && (
          <div className="p-3">
            <pre className="text-xs text-gray-400 bg-gray-800 p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(entity.metadata, null, 2) || "{}"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default InspectorPanel;
