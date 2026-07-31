// Shared helper for local smoke tests — not a unit-test fixture; not
// re-exported. Keeps scripts/smoke-*.mjs lean.

export function makeStubEmbedder() {
  const dimensions = 384;
  return {
    dimensions,
    async encode(text) {
      const arr = new Float32Array(dimensions);
      for (let i = 0; i < text.length && i < dimensions; i += 1) {
        arr[i] = (text.charCodeAt(i) % 97) / 97 - 0.5;
      }
      let seed = 0;
      for (let i = 0; i < text.length; i += 1) {
        seed = ((seed * 31) + text.charCodeAt(i)) >>> 0;
      }
      for (let i = text.length; i < dimensions; i += 1) {
        arr[i] = ((seed + i * 17) % 97) / 97 - 0.5;
      }
      return arr;
    },
    async embed(text) {
      return this.encode(text);
    },
  };
}
