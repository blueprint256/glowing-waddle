import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'bp-theme';

/** Read the saved mode (falls back to the OS preference, then dark). */
function readInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage unavailable (private mode etc.) */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/** Mirror the mode onto <html> so tokens.css ([data-theme]) switches too. */
function applyMode(mode: ThemeMode) {
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.style.colorScheme = mode;
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readInitialMode();
  applyMode(initial);
  return {
    mode: initial,
    setMode: (mode) => {
      applyMode(mode);
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        /* ignore */
      }
      set({ mode });
    },
    toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark')
  };
});
