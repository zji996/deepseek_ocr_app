export const formatDuration = (ms?: number | null): string => {
  if (ms === null || ms === undefined) return '—'
  if (Number.isNaN(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`

  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)} 秒`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds - minutes * 60
  if (minutes < 60) {
    const secondsLabel = remainingSeconds >= 10 ? remainingSeconds.toFixed(0) : remainingSeconds.toFixed(1)
    return `${minutes} 分 ${secondsLabel} 秒`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes - hours * 60
  return `${hours} 小时 ${remainingMinutes} 分`
}

export const formatTimestamp = (iso?: string | null): string | null => {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

