import { useSyncExternalStore } from 'react';

const query = () => (typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** Tracks the OS light/dark setting so canvas images re-render with the right colour ramp. */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = query();
      q?.addEventListener('change', cb);
      return () => q?.removeEventListener('change', cb);
    },
    () => query()?.matches ?? false,
  );
}
