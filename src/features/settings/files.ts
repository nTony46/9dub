/** Trigger a browser download of JSON or text content. */
export function download(filename: string, content: unknown, type = 'application/json'): void {
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
}
