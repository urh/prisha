import { useEffect, useRef, useState } from 'react';
import type {
  EngineInputs,
  GridInputs,
  GridRow,
  PlansResult,
  Response,
} from '../workers/projection.worker';

/** Wait this long after the last input change before starting work. */
const DEBOUNCE_MS = 220;

/**
 * Drives the projection worker.
 *
 * Two things keep a slider drag smooth: the debounce (so we don't queue a
 * request per pixel) and the id check (so a slow result that has been
 * superseded is thrown away instead of flashing stale numbers on screen).
 * Previous results stay on screen while new ones compute.
 */
export function useProjectionEngine(planInputs: EngineInputs, gridInputs: GridInputs) {
  const workerRef = useRef<Worker | null>(null);
  const latest = useRef({ plans: 0, grid: 0 });
  const nextId = useRef(1);

  const [plans, setPlans] = useState<PlansResult | null>(null);
  const [grid, setGrid] = useState<GridRow[] | null>(null);
  const [plansPending, setPlansPending] = useState(true);
  const [gridPending, setGridPending] = useState(true);

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/projection.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<Response>) => {
      const res = e.data;
      if (res.kind === 'error') {
        console.error('projection worker failed:', res.message);
        setPlansPending(false);
        setGridPending(false);
        return;
      }
      if (res.kind === 'plans' && res.id === latest.current.plans) {
        setPlans(res.result);
        setPlansPending(false);
      }
      if (res.kind === 'grid' && res.id === latest.current.grid) {
        setGrid(res.result);
        setGridPending(false);
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    setPlansPending(true);
    const t = setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;
      const id = nextId.current++;
      latest.current.plans = id;
      worker.postMessage({ id, kind: 'plans', inputs: planInputs });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [planInputs]);

  useEffect(() => {
    setGridPending(true);
    const t = setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;
      const id = nextId.current++;
      latest.current.grid = id;
      worker.postMessage({ id, kind: 'grid', inputs: gridInputs });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [gridInputs]);

  return { plans, grid, plansPending, gridPending };
}
