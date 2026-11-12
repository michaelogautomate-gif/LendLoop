"use client";

import { TOOL_CATEGORIES, type ToolCategory } from "@/lib/utils";

interface CategoryFilterBarProps {
  selected: ToolCategory | undefined;
  onSelect: (category: ToolCategory | undefined) => void;
}

export function CategoryFilterBar({
  selected,
  onSelect,
}: CategoryFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onSelect(undefined)}
        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
          selected === undefined
            ? "bg-slate-900 text-white"
            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        All
      </button>
      {TOOL_CATEGORIES.map((cat) => (
        <button
          key={cat.value}
          type="button"
          onClick={() => onSelect(cat.value)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
            selected === cat.value
              ? "bg-slate-900 text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}

