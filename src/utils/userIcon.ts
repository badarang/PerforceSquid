// Generate a consistent icon and color for each user based on their username
// Uses different hash seeds for icon and color to maximize visual differentiation

const icons = [
  '🦊', '🐱', '🐶', '🐼', '🐨', '🐯', '🦁', '🐸',
  '🐵', '🐰', '🐻', '🦄', '🐲', '🦅', '🦉', '🐧',
  '🐤', '🦋', '🐢', '🦈', '🐬', '🦭', '🦩', '🦜',
  '🐙', '🦀', '🐝', '🐞', '🦔', '🐿️', '🦝', '🦦'
]

const colors = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-red-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-lime-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-sky-500',
  'bg-slate-500',
]

// Hex colors for inline styles
const hexColors = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#ef4444', // red
  '#a855f7', // purple
  '#ec4899', // pink
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#f43f5e', // rose
  '#f59e0b', // amber
  '#0ea5e9', // sky
  '#64748b', // slate
]

// Different hash functions for icon and color to reduce collisions
function hashForIcon(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) + hash) + char // djb2 algorithm
  }
  return Math.abs(hash)
}

function hashForColor(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 7) - hash) + char * (i + 1) // Different algorithm with position weight
    hash = hash & hash
  }
  return Math.abs(hash)
}

export function getUserIcon(username: string): string {
  const hash = hashForIcon(username)
  return icons[hash % icons.length]
}

export function getUserColor(username: string): string {
  const hash = hashForColor(username)
  return hexColors[hash % hexColors.length]
}

export function getUserColorClass(username: string): string {
  const hash = hashForColor(username)
  return colors[hash % colors.length]
}

export function getUserStyle(username: string): { icon: string; color: string } {
  return {
    icon: getUserIcon(username),
    color: getUserColor(username)
  }
}

export function getUserInitials(username: string): string {
  if (!username) return '?'
  // Handle common username formats
  const cleaned = username.replace(/[._-]/g, ' ').trim()
  const parts = cleaned.split(/\s+/)

  if (parts.length >= 2) {
    // First letter of first two parts
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }

  // Just use first two characters
  return cleaned.slice(0, 2).toUpperCase()
}
