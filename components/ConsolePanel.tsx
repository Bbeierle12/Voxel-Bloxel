import React, { useState, useRef, useEffect } from "react";
import { SystemLog } from "../types";

// ============================================================================
// CONSOLE PANEL COMPONENT
// System log with filtering by type (Info, Error, System, AI)
// ============================================================================

interface ConsolePanelProps {
  logs: SystemLog[];
  onClear: () => void;
  maxHeight?: string;
}

export const ConsolePanel: React.FC<ConsolePanelProps> = ({
  logs,
  onClear,
  maxHeight = "200px",
}) => {
  const [filter, setFilter] = useState<SystemLog["level"] | "all">("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // ============================================================================
  // HELPERS
  // ============================================================================

  const getLogIcon = (level: SystemLog["level"]): string => {
    switch (level) {
      case "info":
        return "ℹ️";
      case "warn":
        return "⚠️";
      case "error":
        return "❌";
      case "system":
        return "⚙️";
      case "ai":
        return "🤖";
      default:
        return "📝";
    }
  };

  const getLogColor = (level: SystemLog["level"]): string => {
    switch (level) {
      case "info":
        return "text-blue-400";
      case "warn":
        return "text-yellow-400";
      case "error":
        return "text-red-400";
      case "system":
        return "text-gray-400";
      case "ai":
        return "text-purple-400";
      default:
        return "text-gray-300";
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  };

  const filteredLogs = logs.filter((log) => {
    if (filter !== "all" && log.level !== filter) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  const logCounts = {
    all: logs.length,
    info: logs.filter((l) => l.level === "info").length,
    warn: logs.filter((l) => l.level === "warn").length,
    error: logs.filter((l) => l.level === "error").length,
    system: logs.filter((l) => l.level === "system").length,
    ai: logs.filter((l) => l.level === "ai").length,
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="flex flex-col bg-gray-900 border-t border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-gray-300 text-xs font-medium">Console</span>
          <span className="text-gray-500 text-xs">({filteredLogs.length})</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-32 px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs placeholder-gray-500 focus:border-purple-500 focus:outline-none"
          />

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1 rounded text-xs ${
              autoScroll
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-400"
            }`}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          >
            ⬇️
          </button>

          {/* Clear button */}
          <button
            onClick={onClear}
            className="p-1 rounded text-xs bg-gray-700 text-gray-400 hover:text-red-400 transition-colors"
            title="Clear console"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 border-b border-gray-700 overflow-x-auto">
        {(["all", "info", "warn", "error", "system", "ai"] as const).map(
          (level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-2 py-0.5 rounded text-xs whitespace-nowrap transition-colors ${
                filter === level
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-300"
              }`}
            >
              {level === "all" ? "All" : getLogIcon(level)}{" "}
              {level.charAt(0).toUpperCase() + level.slice(1)}
              {logCounts[level] > 0 && (
                <span className="ml-1 text-gray-500">({logCounts[level]})</span>
              )}
            </button>
          )
        )}
      </div>

      {/* Log List */}
      <div
        ref={scrollRef}
        className="overflow-y-auto font-mono text-xs"
        style={{ maxHeight }}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-gray-500">
            {logs.length === 0
              ? "No logs yet"
              : "No logs match the current filter"}
          </div>
        ) : (
          <table className="w-full">
            <tbody>
              {filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  className={`hover:bg-gray-800/50 border-b border-gray-800 ${
                    log.level === "error" ? "bg-red-900/10" : ""
                  }`}
                >
                  {/* Timestamp */}
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap w-24">
                    {formatTimestamp(log.timestamp)}
                  </td>

                  {/* Level Icon */}
                  <td className="px-1 py-1 w-6">{getLogIcon(log.level)}</td>

                  {/* Source */}
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap w-20">
                    [{log.source}]
                  </td>

                  {/* Message */}
                  <td className={`px-2 py-1 ${getLogColor(log.level)}`}>
                    <span className="break-all">{log.message}</span>

                    {/* Data preview */}
                    {log.data && Object.keys(log.data).length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-500 hover:text-gray-400">
                          + data
                        </summary>
                        <pre className="mt-1 p-1 bg-gray-800 rounded text-gray-400 overflow-x-auto">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// LOG HELPER FUNCTIONS
// ============================================================================

let logIdCounter = 0;

export const createLog = (
  level: SystemLog["level"],
  message: string,
  source: string = "system",
  data?: Record<string, unknown>
): SystemLog => ({
  id: `log-${Date.now()}-${logIdCounter++}`,
  timestamp: Date.now(),
  level,
  message,
  source,
  data,
});

export const logInfo = (message: string, source?: string, data?: Record<string, unknown>) =>
  createLog("info", message, source, data);

export const logWarn = (message: string, source?: string, data?: Record<string, unknown>) =>
  createLog("warn", message, source, data);

export const logError = (message: string, source?: string, data?: Record<string, unknown>) =>
  createLog("error", message, source, data);

export const logSystem = (message: string, source?: string, data?: Record<string, unknown>) =>
  createLog("system", message, source, data);

export const logAI = (message: string, source?: string, data?: Record<string, unknown>) =>
  createLog("ai", message, source, data);

export default ConsolePanel;
