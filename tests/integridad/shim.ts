// Entorno mínimo de navegador para ejecutar los servicios reales de la app en Node (solo pruebas)
const memoria = new Map<string, string>();
(globalThis as any).localStorage ??= {
  getItem: (k: string) => (memoria.has(k) ? memoria.get(k)! : null),
  setItem: (k: string, v: string) => void memoria.set(k, String(v)),
  removeItem: (k: string) => void memoria.delete(k),
  clear: () => memoria.clear(),
  key: (i: number) => [...memoria.keys()][i] ?? null,
  get length() { return memoria.size; }
};
export {};
// Node 21+ trae un "navigator" sin onLine: la bandeja del repartidor lo tomaría como sin conexión
if (typeof navigator !== 'undefined' && (navigator as any).onLine === undefined) {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
}
