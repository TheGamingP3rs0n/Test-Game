// Tiny global event bus so systems (calls, chaos, HUD, 3D world) stay decoupled.
const listeners = new Map();

export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  },
  once(evt, fn) {
    const off = bus.on(evt, (...a) => {
      off();
      fn(...a);
    });
    return off;
  },
  emit(evt, ...args) {
    for (const fn of [...(listeners.get(evt) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[bus] handler for "${evt}" failed`, err);
      }
    }
  },
};
