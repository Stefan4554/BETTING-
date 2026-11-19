export async function cookies() {
  return { getAll: () => [] as { name: string; value: string }[], get: () => undefined, set: () => {} };
}
export async function headers() {
  return new Headers();
}
