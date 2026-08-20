export function decrypt(payload: string): string {
  try {
    return atob(payload);
  } catch {
    return payload;
  }
}
