// Two character ids, sorted, joined with "__". Selection order never changes the key.
export const pairKey = (a, b) => [a, b].sort().join('__');
