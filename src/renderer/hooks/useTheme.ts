import { useEffect } from 'react';
import { usePersistentState } from './usePersistentState';

export type Theme = 'dark' | 'light';

const isTheme = (v: unknown): Theme | null => (v === 'dark' || v === 'light' ? v : null);

/**
 * Dark / light mode. Dark is the default (unchanged from before this existed), so
 * nobody's screen changes until they tap the toggle. The choice is remembered
 * (`crimp.theme`) and applied as `data-theme` on <html>, which styles.css reads.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = usePersistentState<Theme>('crimp.theme', 'dark', isTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
