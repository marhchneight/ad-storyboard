import { useEffect, useState, type ReactNode } from 'react';
import { ThemeContext, THEME_STORAGE_KEY, type Theme } from '../lib/themeContext';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Wraps the app to provide theme state. Saved preference wins; first-time
 * visitors default to light (this product's baseline design) rather than
 * following the OS color scheme. The actual attribute is already applied
 * synchronously by the inline script in index.html before React mounts —
 * this just picks up that initial value and keeps it in sync afterward.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
