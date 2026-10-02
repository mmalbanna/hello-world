export const PROJECT_PALETTE = [
  '#0f4c81', '#c2410c', '#15803d', '#7c3aed', '#be123c',
  '#0e7490', '#a16207', '#4338ca', '#9d174d', '#166534',
  '#1d4ed8', '#b45309', '#6d28d9', '#047857', '#9f1239',
]

export function nextProjectColor(used: string[]) {
  const free = PROJECT_PALETTE.find((c) => !used.includes(c))
  return free ?? PROJECT_PALETTE[used.length % PROJECT_PALETTE.length]
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Light tint of a colour for cell backgrounds (keeps text readable). */
export function tint(hex: string, amount = 0.85): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

export function tintHex(hex: string, amount = 0.85): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')
  return `${mix(r)}${mix(g)}${mix(b)}`.toUpperCase()
}

export function readableText(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#0f172a' : '#ffffff'
}
