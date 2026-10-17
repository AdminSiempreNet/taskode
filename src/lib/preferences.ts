// Migrate saved browser preferences when an existing installation adopts Taskode.
export function readPreference(key: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const previous = localStorage.getItem(key.replace(/^taskode\./, "brote."));
    if (previous !== null) {
      try {
        localStorage.setItem(key, previous);
      } catch {
        // The existing value is still usable if storage cannot be written.
      }
    }
    return previous;
  } catch {
    return null;
  }
}
