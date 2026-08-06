import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { tourStops } from "../tourStops.js";

const STORAGE_KEY = "hegota-tour-progress";

export interface TourContextValue {
  currentIndex: number | null;
  totalStops: number;
  completedPaths: Set<string>;
  scrolledToBottom: Set<string>;
  markComplete(path: string): void;
  reportScrolledToBottom(path: string): void;
  resetProgress(): void;
}

const TourContext = createContext<TourContextValue>({
  currentIndex: null,
  totalStops: tourStops.length,
  completedPaths: new Set(),
  scrolledToBottom: new Set(),
  markComplete: () => {},
  reportScrolledToBottom: () => {},
  resetProgress: () => {},
});

interface Progress {
  completed: Set<string>;
  scrolled: Set<string>;
}

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completed: new Set(), scrolled: new Set() };
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        completed: new Set(parsed.filter((p): p is string => typeof p === "string")),
        scrolled: new Set(),
      };
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const completed = Array.isArray(obj.completed)
        ? obj.completed.filter((p): p is string => typeof p === "string")
        : [];
      const scrolled = Array.isArray(obj.scrolled)
        ? obj.scrolled.filter((p): p is string => typeof p === "string")
        : [];
      return { completed: new Set(completed), scrolled: new Set(scrolled) };
    }
    return { completed: new Set(), scrolled: new Set() };
  } catch {
    return { completed: new Set(), scrolled: new Set() };
  }
}

function persist(completed: Set<string>, scrolled: Set<string>) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ completed: [...completed], scrolled: [...scrolled] }),
  );
}

export function TourProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [progress, setProgress] = useState<Progress>(() => loadProgress());

  const foundIndex = tourStops.findIndex((stop) => stop.path === location.pathname);
  const currentIndex = foundIndex === -1 ? null : foundIndex;

  function markComplete(path: string) {
    setProgress((prev) => {
      if (prev.completed.has(path)) return prev;
      const completed = new Set(prev.completed);
      completed.add(path);
      persist(completed, prev.scrolled);
      return { completed, scrolled: prev.scrolled };
    });
  }

  function reportScrolledToBottom(path: string) {
    setProgress((prev) => {
      if (prev.scrolled.has(path)) return prev;
      const scrolled = new Set(prev.scrolled);
      scrolled.add(path);
      persist(prev.completed, scrolled);
      return { completed: prev.completed, scrolled };
    });
  }

  function resetProgress() {
    const empty: Progress = { completed: new Set(), scrolled: new Set() };
    persist(empty.completed, empty.scrolled);
    setProgress(empty);
  }

  return (
    <TourContext.Provider
      value={{
        currentIndex,
        totalStops: tourStops.length,
        completedPaths: progress.completed,
        scrolledToBottom: progress.scrolled,
        markComplete,
        reportScrolledToBottom,
        resetProgress,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

export function useTour(): TourContextValue {
  return useContext(TourContext);
}
