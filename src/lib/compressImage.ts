/** 上传前压缩：限制最长边，输出 JPEG，控制体积便于手机上传 */
export async function compressImage(
  file: File,
  options?: { maxEdge?: number; quality?: number; maxBytes?: number },
): Promise<File> {
  const maxEdge = options?.maxEdge ?? 1920
  const quality = options?.quality ?? 0.82
  const maxBytes = options?.maxBytes ?? 1_200_000

  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file
  }

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)

    let q = quality
    let blob = await canvasToJpeg(canvas, q)
    while (blob.size > maxBytes && q > 0.45) {
      q -= 0.08
      blob = await canvasToJpeg(canvas, q)
    }

    if (blob.size >= file.size && scale === 1) return file

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } finally {
    bitmap.close()
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('图片压缩失败'))
        else resolve(blob)
      },
      'image/jpeg',
      quality,
    )
  })
}
