import { useCallback, useEffect, useState } from "react";

/**
 * One query-string parameter, kept in the address bar.
 *
 * Deliberately built on the History API rather than a router, so the module
 * drops into a React Router app, a TanStack Router app, Next's app router or no
 * router at all without any of them having to agree. Writes use `replaceState`
 * — opening a lead shouldn't cost you a press of the back button — and reads
 * follow `popstate`, so browser navigation still works.
 */
export function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const read = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name));
  const [value, setValue] = useState<string | null>(read);

  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const write = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (next) params.set(name, next);
      else params.delete(name);
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      setValue(next);
    },
    [name],
  );

  return [value, write];
}
