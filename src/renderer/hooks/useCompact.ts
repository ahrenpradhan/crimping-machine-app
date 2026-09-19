import { useEffect, useState } from 'react';
import { COMPACT_MAX_HEIGHT, COMPACT_MAX_WIDTH } from '../../shared/screen';

/** Same condition as the compact block in styles.css. */
const QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px), (max-height: ${COMPACT_MAX_HEIGHT}px)`;

/**
 * True on small screens (7" panels, 800x480 and the like): the crimp screen then
 * shows the parameters and the graphs on two tabs instead of side by side.
 */
export function useCompact(): boolean {
  const [compact, setCompact] = useState<boolean>(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const onChange = (): void => setCompact(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return compact;
}
