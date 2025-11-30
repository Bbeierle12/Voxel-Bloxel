import React, { useState, useCallback } from "react";
import {
  AgentWorkflow,
  AgentPhase,
  AgentStep,
  AgentStepStatus,
  Skill,
  QuantumOrbState,
  QuantumPhase,
  OrbCopy,
} from "../types";

// ============================================================================
// AGENT PANEL COMPONENT
// Planning/execution UI with skill library and step-by-step task execution
// ============================================================================

interface AgentPanelProps {
  workflow: AgentWorkflow;
  onStartPlan: (goal: string) => Promise<void>;
  onExecuteStep: (step: AgentStep) => Promise<void>;
  onPauseExecution: () => void;
  onResumeExecution: () => void;
  onCancelExecution: () => void;
  onSaveSkill: (skill: Omit<Skill, "id" | "createdAt">) => void;
  onLoadSkill: (skill: Skill) => void;
  onDeleteSkill: (skillId: string) => void;
  isProcessing: boolean;
  // Quantum props
  quantumState?: QuantumOrbState;
  onCancelQuantum?: () => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  workflow,
  onStartPlan,
  onExecuteStep,
  onPauseExecution,
  onResumeExecution,
  onCancelExecution,
  onSaveSkill,
  onLoadSkill,
  onDeleteSkill,
  isProcessing,
  quantumState,
  onCancelQuantum,
}) => {
  const [goalInput, setGoalInput] = useState("");
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillCategory, setSkillCategory] = useState("general");
  const [activeTab, setActiveTab] = useState<"workflow" | "skills">("workflow");

  // Check if quantum build is active
  const isQuantumActive = quantumState?.isQuantumSplit ?? false;

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleSubmitGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalInput.trim() || isProcessing) return;
    await onStartPlan(goalInput.trim());
    setGoalInput("");
  };

  const handleSaveAsSkill = () => {
    if (!skillName.trim()) return;
    onSaveSkill({
      name: skillName,
      description: skillDescription,
      prompt: workflow.goal,
      icon: getSkillIcon(skillCategory),
      category: skillCategory,
    });
    setShowSkillModal(false);
    setSkillName("");
    setSkillDescription("");
  };

  const getSkillIcon = (category: string): string => {
    const icons: Record<string, string> = {
      building: "🏗️",
      coding: "💻",
      terrain: "🌍",
      automation: "⚙️",
      general: "✨",
    };
    return icons[category] || "✨";
  };

  const getStepStatusIcon = (status: AgentStepStatus): string => {
    switch (status) {
      case AgentStepStatus.COMPLETED:
        return "✅";
      case AgentStepStatus.IN_PROGRESS:
        return "🔄";
      case AgentStepStatus.FAILED:
        return "❌";
      case AgentStepStatus.SKIPPED:
        return "⏭️";
      default:
        return "⏳";
    }
  };

  const getPhaseLabel = (phase: AgentPhase): string => {
    switch (phase) {
      case AgentPhase.IDLE:
        return "Ready";
      case AgentPhase.PLANNING:
        return "Planning...";
      case AgentPhase.EXECUTING:
        return "Executing";
      case AgentPhase.PAUSED:
        return "Paused";
      case AgentPhase.COMPLETED:
        return "Completed";
      case AgentPhase.ERROR:
        return "Error";
      default:
        return "Unknown";
    }
  };

  const getPhaseColor = (phase: AgentPhase): string => {
    switch (phase) {
      case AgentPhase.IDLE:
        return "text-gray-400";
      case AgentPhase.PLANNING:
        return "text-yellow-400";
      case AgentPhase.EXECUTING:
        return "text-blue-400";
      case AgentPhase.PAUSED:
        return "text-orange-400";
      case AgentPhase.COMPLETED:
        return "text-green-400";
      case AgentPhase.ERROR:
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  // Quantum status helpers
  const getQuantumPhaseLabel = (phase: QuantumPhase): string => {
    switch (phase) {
      case QuantumPhase.COHERENT:
        return "Coherent";
      case QuantumPhase.SPLITTING:
        return "Splitting...";
      case QuantumPhase.SUPERPOSITION:
        return "Superposition";
      case QuantumPhase.COLLAPSING:
        return "Collapsing...";
      case QuantumPhase.DECOHERENT:
        return "Decoherent!";
      default:
        return "Unknown";
    }
  };

  const getOrbCopyStatusColor = (status: OrbCopy["status"]): string => {
    switch (status) {
      case "idle":
        return "bg-gray-600";
      case "working":
        return "bg-blue-500";
      case "complete":
        return "bg-green-500";
      case "blocked":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-600";
    }
  };

  const getCoherenceColor = (coherence: number): string => {
    if (coherence > 0.7) return "bg-green-500";
    if (coherence > 0.4) return "bg-yellow-500";
    if (coherence > 0.2) return "bg-orange-500";
    return "bg-red-500";
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab("workflow")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "workflow"
              ? "text-purple-400 border-b-2 border-purple-400 bg-gray-800"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          🤖 Workflow
        </button>
        <button
          onClick={() => setActiveTab("skills")}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "skills"
              ? "text-purple-400 border-b-2 border-purple-400 bg-gray-800"
              : "text-gray-400 hover:text-gray-300"
          }`}
        >
          📚 Skills ({workflow.skills.length})
        </button>
      </div>

      {activeTab === "workflow" ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Goal Input */}
          <form onSubmit={handleSubmitGoal} className="p-3 border-b border-gray-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Enter a goal (e.g., 'Build a castle')"
                disabled={isProcessing || workflow.phase === AgentPhase.EXECUTING}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!goalInput.trim() || isProcessing}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {workflow.phase === AgentPhase.PLANNING ? "Planning..." : "Plan"}
              </button>
            </div>
          </form>

          {/* Status Bar */}
          <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs">Status:</span>
              <span className={`text-sm font-medium ${getPhaseColor(workflow.phase)}`}>
                {getPhaseLabel(workflow.phase)}
              </span>
            </div>

            {/* Control Buttons */}
            <div className="flex gap-2">
              {workflow.phase === AgentPhase.EXECUTING && !isQuantumActive && (
                <button
                  onClick={onPauseExecution}
                  className="px-2 py-1 text-xs bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors"
                >
                  ⏸️ Pause
                </button>
              )}
              {workflow.phase === AgentPhase.PAUSED && (
                <button
                  onClick={onResumeExecution}
                  className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
                >
                  ▶️ Resume
                </button>
              )}
              {(workflow.phase === AgentPhase.EXECUTING ||
                workflow.phase === AgentPhase.PAUSED) && !isQuantumActive && (
                <button
                  onClick={onCancelExecution}
                  className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                >
                  ⏹️ Cancel
                </button>
              )}
              {isQuantumActive && onCancelQuantum && (
                <button
                  onClick={onCancelQuantum}
                  className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                >
                  ⏹️ Cancel Quantum
                </button>
              )}
              {workflow.phase === AgentPhase.COMPLETED && workflow.goal && (
                <button
                  onClick={() => setShowSkillModal(true)}
                  className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                >
                  💾 Save as Skill
                </button>
              )}
            </div>
          </div>

          {/* Quantum Progress Panel */}
          {isQuantumActive && quantumState && (
            <div className="p-3 bg-purple-900/30 border-b border-purple-700">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚛️</span>
                  <span className="text-purple-300 font-medium text-sm">
                    Quantum Build Active
                  </span>
                  <span className="text-xs px-2 py-0.5 bg-purple-700 rounded text-purple-200">
                    {getQuantumPhaseLabel(quantumState.phase)}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {quantumState.copies.length} copies
                </span>
              </div>

              {/* Coherence Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">Quantum Coherence</span>
                  <span className="text-purple-300">
                    {Math.round(quantumState.coherenceLevel * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${getCoherenceColor(
                      quantumState.coherenceLevel
                    )}`}
                    style={{ width: `${quantumState.coherenceLevel * 100}%` }}
                  />
                </div>
                {quantumState.coherenceLevel < 0.3 && (
                  <p className="text-xs text-orange-400 mt-1">
                    ⚠️ Low coherence - build may collapse soon!
                  </p>
                )}
              </div>

              {/* Orb Copies Grid */}
              <div className="grid grid-cols-2 gap-2">
                {quantumState.copies.map((copy, idx) => (
                  <div
                    key={copy.id}
                    className="p-2 bg-gray-800 rounded border border-gray-700"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: copy.color }}
                        />
                        <span className="text-xs text-gray-300">
                          Copy {idx + 1}
                        </span>
                      </div>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${getOrbCopyStatusColor(
                          copy.status
                        )} text-white`}
                      >
                        {copy.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mb-1">
                      {copy.assignedChunk.name}
                    </p>
                    {/* Progress Bar */}
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all duration-200"
                        style={{ width: `${copy.progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-gray-500">
                        {copy.blocksPlaced}/{copy.assignedChunk.blocks.length}
                      </span>
                      <span className="text-gray-400">
                        {Math.round(copy.progress)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Total Progress */}
              {quantumState.masterPlan && (
                <div className="mt-3 pt-2 border-t border-gray-700">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Total Progress</span>
                    <span className="text-green-400">
                      {quantumState.totalBlocksPlaced} /{" "}
                      {quantumState.masterPlan.totalBlocks} blocks
                    </span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-green-500 transition-all duration-200"
                      style={{
                        width: `${
                          (quantumState.totalBlocksPlaced /
                            Math.max(quantumState.masterPlan.totalBlocks, 1)) *
                          100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Current Goal */}
          {workflow.goal && (
            <div className="px-3 py-2 bg-gray-800/50 border-b border-gray-700">
              <span className="text-gray-400 text-xs">Current Goal:</span>
              <p className="text-white text-sm mt-1">{workflow.goal}</p>
            </div>
          )}

          {/* Steps List */}
          <div className="flex-1 overflow-y-auto p-3">
            {workflow.steps.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <span className="text-4xl mb-2">🤖</span>
                <p className="text-sm">Enter a goal to generate an execution plan</p>
              </div>
            ) : (
              <div className="space-y-2">
                {workflow.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className={`p-3 rounded-lg border ${
                      index === workflow.currentStepIndex
                        ? "bg-purple-900/30 border-purple-500"
                        : step.status === AgentStepStatus.COMPLETED
                        ? "bg-green-900/20 border-green-700"
                        : step.status === AgentStepStatus.FAILED
                        ? "bg-red-900/20 border-red-700"
                        : "bg-gray-800 border-gray-700"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-lg">{getStepStatusIcon(step.status)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Step {index + 1}</span>
                          <code className="text-xs bg-gray-700 px-1.5 py-0.5 rounded text-purple-300">
                            {step.action}
                          </code>
                        </div>
                        <p className="text-sm text-white mt-1">{step.description}</p>

                        {/* Parameters */}
                        {Object.keys(step.parameters).length > 0 && (
                          <div className="mt-2 text-xs">
                            <span className="text-gray-500">Parameters: </span>
                            <code className="text-gray-400">
                              {JSON.stringify(step.parameters)}
                            </code>
                          </div>
                        )}

                        {/* Result/Error */}
                        {step.result && (
                          <div className="mt-2 text-xs text-green-400">
                            ✓ {JSON.stringify(step.result)}
                          </div>
                        )}
                        {step.error && (
                          <div className="mt-2 text-xs text-red-400">
                            ✗ {step.error}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Skills Tab */
        <div className="flex-1 overflow-y-auto p-3">
          {workflow.skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <span className="text-4xl mb-2">📚</span>
              <p className="text-sm text-center">
                No saved skills yet.
                <br />
                Complete a workflow and save it as a skill!
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              {workflow.skills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-purple-500 transition-colors cursor-pointer group"
                  onClick={() => onLoadSkill(skill)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{skill.icon}</span>
                      <div>
                        <h3 className="text-white font-medium text-sm">{skill.name}</h3>
                        <p className="text-gray-400 text-xs">{skill.description}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSkill(skill.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                    >
                      🗑️
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 bg-gray-700 rounded text-gray-400">
                      {skill.category}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Save Skill Modal */}
      {showSkillModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-80 border border-gray-700">
            <h3 className="text-white font-medium mb-4">💾 Save as Skill</h3>

            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Name</label>
                <input
                  type="text"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  placeholder="My Skill"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-gray-400 text-xs block mb-1">Description</label>
                <textarea
                  value={skillDescription}
                  onChange={(e) => setSkillDescription(e.target.value)}
                  placeholder="What does this skill do?"
                  rows={2}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm resize-none focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-gray-400 text-xs block mb-1">Category</label>
                <select
                  value={skillCategory}
                  onChange={(e) => setSkillCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-purple-500 focus:outline-none"
                >
                  <option value="general">✨ General</option>
                  <option value="building">🏗️ Building</option>
                  <option value="coding">💻 Coding</option>
                  <option value="terrain">🌍 Terrain</option>
                  <option value="automation">⚙️ Automation</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowSkillModal(false)}
                className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAsSkill}
                disabled={!skillName.trim()}
                className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white text-sm rounded transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentPanel;
