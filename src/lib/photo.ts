/** Resize an image file to a small square JPEG data URL (stored inline in Firestore). */
export async function fileToAvatarDataUrl(file: File, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  const img: ImageBitmap | HTMLImageElement = bitmap ?? (await loadImg(file))
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const w = 'width' in img ? img.width : 0; const h = 'height' in img ? img.height : 0
  const side = Math.min(w, h)
  const sx = (w - side) / 2; const sy = (h - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.82)
}

function loadImg(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = reject
    img.src = url
  })
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
}
