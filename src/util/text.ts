/** Count user-perceived characters so CJK bubbles are not over-counted. */
export function charLength(value: string): number {
  return [...value].length;
}

/** Truncate on code-point boundaries, appending an ellipsis when shortened. */
export function truncateChars(value: string, limit: number): string {
  const characters = [...value];
  if (characters.length <= limit) return value;
  if (limit <= 1) return characters.slice(0, Math.max(limit, 0)).join('');
  return `${characters.slice(0, limit - 1).join('')}…`;
}
