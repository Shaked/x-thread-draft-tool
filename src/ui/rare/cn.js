// Rare UI's cn() without clsx and tailwind-merge: joins class names and drops false values. No caller here
// passes classes that override each other, so nothing needs merging.
export function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}
