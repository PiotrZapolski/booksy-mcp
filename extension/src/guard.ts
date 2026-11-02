export interface TabUse {
  /** The tab is the selected one in its window. */
  active: boolean;
  /** Its window is minimized. */
  minimized: boolean;
  /** When the tab was last used, from Chrome. */
  lastAccessed: number | undefined;
  /** "active", "idle" or "locked", from chrome.idle. */
  computer: string;
  now: number;
}

/** True when safe mode should send nothing, because nobody has been around the panel for a while. */
export function unattended(use: TabUse, maxBackgroundMs: number): boolean {
  if (use.computer !== 'active') return true;
  if (use.active && !use.minimized) return false;
  if (use.lastAccessed === undefined) return false;
  return use.now - use.lastAccessed > maxBackgroundMs;
}
