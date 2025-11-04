import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, Loader2, Search } from 'lucide-react'

import { TaskStatusResponse, ocrClient } from '../api/client'
import { isProcessing, statusBadgeStyles } from '../utils/taskStatus'
import { buildDownloadUrl } from '../utils/url'
import { formatDuration, formatTimestamp } from '../utils/time'

const TaskLookupPanel = () => {
  const [taskIdInput, setTaskIdInput] = useState('')
  const [lookupTaskId, setLookupTaskId] = useState<string | null>(null)
  const [status, setStatus] = useState<TaskStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchStatus = useCallback(
    async (taskId: string) => {
      setIsLoading(true)
      try {
        const result = await ocrClient.getTaskStatus(taskId)
        setStatus(result)
        setError(null)
      } catch (err) {
        setStatus(null)
        setError((err as Error).message)
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!lookupTaskId) {
      setStatus(null)
      setError(null)
      return
    }
    void fetchStatus(lookupTaskId)
  }, [lookupTaskId, fetchStatus])

  useEffect(() => {
    if (!lookupTaskId) return
    if (!status || isProcessing(status)) {
      const timer = window.setInterval(() => {
        void fetchStatus(lookupTaskId)
      }, 1000)
      return () => window.clearInterval(timer)
    }
  }, [lookupTaskId, status, fetchStatus])

  const handleLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = taskIdInput.trim()
    if (!trimmed) {
      setError('请输入任务 ID')
      setLookupTaskId(null)
      setStatus(null)
      return
    }
    setLookupTaskId(trimmed)
  }

  const progress = status?.progress ?? null
  const progressPercent = Math.min(100, Math.max(0, progress?.percent ?? 0))
  const showProgress = useMemo(() => {
    if (!progress) return false
    return progress.total > 0 || progress.percent > 0 || Boolean(progress.message)
  }, [progress])
  const archiveUrl = buildDownloadUrl(status?.result?.archive_url ?? undefined)
  const timing = status?.timing ?? null
  const durationLabel = formatDuration(timing?.duration_ms ?? null)
  const startedAt = formatTimestamp(timing?.started_at ?? null)
  const finishedAt = formatTimestamp(timing?.finished_at ?? null)

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <Search className="h-4 w-4" />
            根据任务 ID 查询
          </div>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">随时查看任意任务进度</h2>
          <p className="mt-2 text-sm text-slate-500">支持在任意页面粘贴任务 ID，实时返回队列状态与结果下载。</p>
        </div>
      </div>

      <form
        onSubmit={handleLookup}
        className="flex flex-col gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-4 transition hover:border-slate-400"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <input
            className="h-10 flex-1 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            type="text"
            placeholder="粘贴任务 ID，例如 92dcb133-c8e7-4f0e-994f-3347d823f00c"
            value={taskIdInput}
            onChange={(event) => setTaskIdInput(event.target.value)}
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            查询任务
          </button>
        </div>
        <p className="text-xs text-slate-400">查询后会自动每秒刷新，直至任务完成或失败。</p>
      </form>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {lookupTaskId && !error && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">任务状态</h3>
              <p className="mt-1 text-xs font-medium text-slate-500">ID：{lookupTaskId}</p>
            </div>
            {status && (
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeStyles[status.status]}`}
              >
                {status.status === 'failed' ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : status.status === 'succeeded' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-inherit" />
                )}
                {status.status === 'pending' && '排队中'}
                {status.status === 'running' && '执行中'}
                {status.status === 'succeeded' && '已完成'}
                {status.status === 'failed' && '失败'}
              </span>
            )}
          </div>

          {showProgress && progress && (
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-inner">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>处理进度</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {progress.message && <p className="text-xs text-slate-500">{progress.message}</p>}
            </div>
          )}

          {timing && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-inner">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">耗时</span>
                <p className="mt-1 text-base font-semibold text-slate-900">{durationLabel}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-inner">
                <span className="font-semibold uppercase tracking-wider text-slate-400">开始时间</span>
                <p className="mt-1 text-sm text-slate-700">{startedAt ?? '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-inner">
                <span className="font-semibold uppercase tracking-wider text-slate-400">完成时间</span>
                <p className="mt-1 text-sm text-slate-700">{finishedAt ?? '—'}</p>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-slate-700">结果下载</h4>
            <p className="mt-1 text-xs text-slate-400">任务达到已完成后将提供 ZIP 下载链接。</p>
            {status?.status === 'succeeded' && archiveUrl ? (
              <a
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-700"
                href={archiveUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="h-3.5 w-3.5" />
                下载结果 ZIP
              </a>
            ) : (
              <p className="mt-3 text-xs text-slate-400">等待任务完成后即可下载。</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default TaskLookupPanel
