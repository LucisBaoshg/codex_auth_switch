export function hasPendingAction(actions: ReadonlySet<string>, key: string): boolean {
  return actions.has(key);
}

export function hasPendingActionPrefix(actions: ReadonlySet<string>, prefix: string): boolean {
  for (const key of actions) {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      return true;
    }
  }
  return false;
}
