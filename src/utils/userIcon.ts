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
  return colors[hash % colors.length]
}

export function getUserStyle(username: string): { icon: string; color: string } {
  return {
    icon: getUserIcon(username),
    color: getUserColor(username)
  }
}
