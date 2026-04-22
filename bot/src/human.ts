export async function humanDelay(minMs = 600, maxMs = 2200) {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  await new Promise((r) => setTimeout(r, ms));
}

export async function microDelay() {
  await humanDelay(120, 450);
}
