import React, { useState, useRef, useEffect, useCallback } from "react";

// ============================================================================
// CODE EDITOR COMPONENT
// Entity behavior script editor with syntax highlighting and autocomplete
// ============================================================================

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  entityName?: string;
  readOnly?: boolean;
  height?: string;
}

// Syntax highlighting tokens
const KEYWORDS = [
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  "instanceof",
];

const BUILTINS = ["Math", "console", "JSON", "Object", "Array", "String", "Number"];

// Autocomplete suggestions for entity scripting
const SUGGESTIONS: Record<string, string[]> = {
  entity: [
    "position",
    "rotation",
    "velocity",
    "scale",
    "color",
    "metadata",
    "name",
    "id",
    "type",
    "physics",
    "visible",
    "wireframe",
  ],
  "entity.position": ["x", "y", "z"],
  "entity.rotation": ["x", "y", "z"],
  "entity.velocity": ["x", "y", "z"],
  "entity.scale": ["x", "y", "z"],
  "entity.physics": ["mass", "friction", "restitution", "isStatic"],
  "entity.metadata": [],
  world: ["physics", "entities", "timeOfDay", "selectedEntityId"],
  "world.physics": ["gravity", "timeScale", "airResistance"],
  Math: [
    "sin",
    "cos",
    "tan",
    "abs",
    "floor",
    "ceil",
    "round",
    "sqrt",
    "pow",
    "min",
    "max",
    "random",
    "PI",
  ],
};

interface AutocompleteItem {
  label: string;
  insertText: string;
  detail?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  onRun,
  entityName = "Entity",
  readOnly = false,
  height = "300px",
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<AutocompleteItem[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [autocompletePosition, setAutocompletePosition] = useState({ top: 0, left: 0 });
  const [cursorPosition, setCursorPosition] = useState(0);

  // ============================================================================
  // SYNTAX HIGHLIGHTING
  // ============================================================================

  const highlightCode = useCallback((code: string): string => {
    // Escape HTML
    let html = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Comments
    html = html.replace(
      /(\/\/[^\n]*)/g,
      '<span class="text-gray-500 italic">$1</span>'
    );
    html = html.replace(
      /(\/\*[\s\S]*?\*\/)/g,
      '<span class="text-gray-500 italic">$1</span>'
    );

    // Strings
    html = html.replace(
      /("[^"]*"|'[^']*'|`[^`]*`)/g,
      '<span class="text-green-400">$1</span>'
    );

    // Numbers
    html = html.replace(
      /\b(\d+\.?\d*)\b/g,
      '<span class="text-orange-400">$1</span>'
    );

    // Keywords
    for (const keyword of KEYWORDS) {
      const regex = new RegExp(`\\b(${keyword})\\b`, "g");
      html = html.replace(regex, '<span class="text-purple-400">$1</span>');
    }

    // Builtins
    for (const builtin of BUILTINS) {
      const regex = new RegExp(`\\b(${builtin})\\b`, "g");
      html = html.replace(regex, '<span class="text-blue-400">$1</span>');
    }

    // Entity/world variables
    html = html.replace(
      /\b(entity|world|deltaTime|time)\b/g,
      '<span class="text-cyan-400 font-semibold">$1</span>'
    );

    // Properties after dot
    html = html.replace(
      /\.(\w+)/g,
      '.<span class="text-yellow-300">$1</span>'
    );

    // Function calls
    html = html.replace(
      /(\w+)\(/g,
      '<span class="text-yellow-400">$1</span>('
    );

    return html;
  }, []);

  // ============================================================================
  // AUTOCOMPLETE
  // ============================================================================

  const getWordBeforeCursor = useCallback((): { word: string; start: number } => {
    const text = value.substring(0, cursorPosition);
    const match = text.match(/[\w.]+$/);
    if (match) {
      return { word: match[0], start: cursorPosition - match[0].length };
    }
    return { word: "", start: cursorPosition };
  }, [value, cursorPosition]);

  const updateAutocomplete = useCallback(() => {
    const { word } = getWordBeforeCursor();

    if (word.length < 1) {
      setShowAutocomplete(false);
      return;
    }

    const items: AutocompleteItem[] = [];

    // Check for property suggestions (e.g., "entity." or "entity.position.")
    const parts = word.split(".");
    if (parts.length > 1) {
      const base = parts.slice(0, -1).join(".");
      const partial = parts[parts.length - 1].toLowerCase();

      const suggestions = SUGGESTIONS[base];
      if (suggestions) {
        for (const suggestion of suggestions) {
          if (suggestion.toLowerCase().startsWith(partial)) {
            items.push({
              label: suggestion,
              insertText: suggestion,
              detail: `${base}.${suggestion}`,
            });
          }
        }
      }
    } else {
      // Root-level suggestions
      const partial = word.toLowerCase();
      for (const key of Object.keys(SUGGESTIONS)) {
        if (!key.includes(".") && key.toLowerCase().startsWith(partial)) {
          items.push({
            label: key,
            insertText: key,
            detail: "Variable",
          });
        }
      }

      // Add keywords
      for (const keyword of KEYWORDS) {
        if (keyword.toLowerCase().startsWith(partial)) {
          items.push({
            label: keyword,
            insertText: keyword,
            detail: "Keyword",
          });
        }
      }
    }

    if (items.length > 0) {
      setAutocompleteItems(items.slice(0, 10));
      setAutocompleteIndex(0);
      setShowAutocomplete(true);

      // Calculate position
      if (textareaRef.current) {
        const textarea = textareaRef.current;
        const lines = value.substring(0, cursorPosition).split("\n");
        const lineNumber = lines.length;
        const columnNumber = lines[lines.length - 1].length;

        const lineHeight = 20;
        const charWidth = 8.4;

        setAutocompletePosition({
          top: lineNumber * lineHeight + 4,
          left: columnNumber * charWidth,
        });
      }
    } else {
      setShowAutocomplete(false);
    }
  }, [value, cursorPosition, getWordBeforeCursor]);

  const insertAutocomplete = useCallback(
    (item: AutocompleteItem) => {
      const { word, start } = getWordBeforeCursor();
      const parts = word.split(".");
      const removeLength = parts[parts.length - 1].length;

      const before = value.substring(0, cursorPosition - removeLength);
      const after = value.substring(cursorPosition);
      const newValue = before + item.insertText + after;

      onChange(newValue);
      setShowAutocomplete(false);

      // Update cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = cursorPosition - removeLength + item.insertText.length;
          textareaRef.current.selectionStart = newPos;
          textareaRef.current.selectionEnd = newPos;
          textareaRef.current.focus();
        }
      }, 0);
    },
    [value, cursorPosition, onChange, getWordBeforeCursor]
  );

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    onChange(e.target.value);
    setCursorPosition(e.target.selectionStart);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((i) =>
          i < autocompleteItems.length - 1 ? i + 1 : 0
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((i) =>
          i > 0 ? i - 1 : autocompleteItems.length - 1
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertAutocomplete(autocompleteItems[autocompleteIndex]);
        return;
      }
      if (e.key === "Escape") {
        setShowAutocomplete(false);
        return;
      }
    }

    // Tab for indentation
    if (e.key === "Tab" && !showAutocomplete) {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newValue = value.substring(0, start) + "  " + value.substring(end);
      onChange(newValue);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2;
          textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
      return;
    }

    // Ctrl+Enter to run
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun?.();
      return;
    }
  };

  const handleScroll = () => {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const handleSelect = () => {
    if (textareaRef.current) {
      setCursorPosition(textareaRef.current.selectionStart);
    }
  };

  // Update autocomplete on cursor/value change
  useEffect(() => {
    updateAutocomplete();
  }, [cursorPosition, updateAutocomplete]);

  // Sync scroll
  useEffect(() => {
    handleScroll();
  }, [value]);

  return (
    <div className="relative font-mono text-sm bg-gray-900 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-gray-300 text-xs font-medium">
          {entityName} Behavior Script
        </span>
        <div className="flex gap-2">
          {onRun && (
            <button
              onClick={onRun}
              className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
            >
              ▶ Run (Ctrl+Enter)
            </button>
          )}
        </div>
      </div>

      {/* Editor container */}
      <div className="relative" style={{ height }}>
        {/* Syntax highlight layer */}
        <pre
          ref={highlightRef}
          className="absolute inset-0 p-3 m-0 overflow-auto pointer-events-none whitespace-pre-wrap break-words"
          style={{
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: "20px",
          }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightCode(value) + "\n" }}
        />

        {/* Textarea layer */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onSelect={handleSelect}
          onClick={handleSelect}
          readOnly={readOnly}
          spellCheck={false}
          className="absolute inset-0 w-full h-full p-3 m-0 bg-transparent text-transparent caret-white resize-none outline-none"
          style={{
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: "20px",
          }}
          placeholder="// Write your entity behavior script here..."
        />

        {/* Autocomplete dropdown */}
        {showAutocomplete && (
          <div
            className="absolute z-50 bg-gray-800 border border-gray-600 rounded-md shadow-lg overflow-hidden"
            style={{
              top: autocompletePosition.top,
              left: autocompletePosition.left,
              maxHeight: "200px",
              minWidth: "200px",
            }}
          >
            {autocompleteItems.map((item, index) => (
              <div
                key={item.label}
                className={`px-3 py-1.5 cursor-pointer flex justify-between items-center ${
                  index === autocompleteIndex
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
                onClick={() => insertAutocomplete(item)}
              >
                <span className="font-medium">{item.label}</span>
                {item.detail && (
                  <span className="text-xs text-gray-400 ml-2">
                    {item.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with hints */}
      <div className="px-3 py-1.5 bg-gray-800 border-t border-gray-700 text-xs text-gray-500">
        <span>Available: </span>
        <code className="text-cyan-400">entity</code>,{" "}
        <code className="text-cyan-400">world</code>,{" "}
        <code className="text-cyan-400">deltaTime</code>,{" "}
        <code className="text-cyan-400">time</code>
      </div>
    </div>
  );
};

export default CodeEditor;
