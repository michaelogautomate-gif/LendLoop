import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type ToolCategory =
  | "power_tools"
  | "garden"
  | "kitchen"
  | "camping"
  | "automotive"
  | "cleaning"
  | "other";

export type ToolCondition = "new" | "excellent" | "good" | "fair";

export type LoanStatus = "pending" | "approved" | "declined" | "returned";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TOOL_CATEGORIES: ReadonlyArray<{
  value: ToolCategory;
  label: string;
}> = [
  { value: "power_tools", label: "Power Tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "automotive", label: "Automotive" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" },
];

export const TOOL_CONDITIONS: ReadonlyArray<{
  value: ToolCondition;
  label: string;
}> = [
  { value: "new", label: "New" },
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
];

export function formatCategoryLabel(category: ToolCategory): string {
  return (
    TOOL_CATEGORIES.find((item) => item.value === category)?.label ?? "Other"
  );
}

export function formatConditionLabel(condition: ToolCondition): string {
  return (
    TOOL_CONDITIONS.find((item) => item.value === condition)?.label ?? "Good"
  );
}

export function getTodayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function extractErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
  }
  if (err instanceof Error) {
    const cleaned = err.message
      .replace(/^\[CONVEX [A-Z]\([^)]+\)\]\s*/i, "")
      .replace(/^Uncaught ConvexError:\s*/i, "")
      .replace(/^Uncaught Error:\s*/i, "")
      .trim();
    return cleaned || "Something went wrong. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

