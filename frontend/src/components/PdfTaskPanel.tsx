import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileText, Loader2, Upload } from 'lucide-react'

import { TaskStatusResponse, ocrClient } from '../api/client'
import { isProcessing, statusBadgeStyles } from '../utils/taskStatus'
import { buildDownloadUrl } from '../utils/url'
import { formatDuration, formatTimestamp } from '../utils/time'

const PdfTaskPanel = () => {
  const [pdfTaskId, setPdfTaskId] = useState<string | null>(null)
  const [pdfStatus, setPdfStatus] = useState<TaskStatusResponse | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [isPdfUploading, setIsPdfUploading] = useState(false)
  const [pdfFileName, setPdfFileName] = useState<string | null>(null)
  const pdfInputId = useId()

  const pollPdfStatus = useCallback(async () => {
    if (!pdfTaskId) return
    try {
      const status = await ocrClient.getTaskStatus(pdfTaskId)
      setPdfStatus(status)
      setPdfError(null)
    } catch (error) {
      setPdfError((error as Error).message)
    }
  }, [pdfTaskId])

  useEffect(() => {
    if (!pdfTaskId) return
    void pollPdfStatus()
  }, [pdfTaskId, pollPdfStatus])

  useEffect(() => {
    if (!pdfTaskId) return
    if (!pdfStatus || isProcessing(pdfStatus)) {
      const timer = window.setInterval(() => {
        void pollPdfStatus()
      }, 1000)
      return () => window.clearInterval(timer)
    }
  }, [pdfTaskId, pdfStatus, pollPdfStatus])

  const handlePdfSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const fileInput = form.elements.namedItem('pdf') as HTMLInputElement | null
    const file = fileInput?.files?.[0]

    if (!file) {
      setPdfError('请选择一个 PDF 文件')
      return
    }

    setIsPdfUploading(true)
    setPdfError(null)
    setPdfFileName(file.name)

    try {
      const { task_id } = await ocrClient.enqueuePdf(file)
      setPdfTaskId(task_id)
      setPdfStatus(null)
    } catch (error) {
      setPdfError((error as Error).message)
      setPdfTaskId(null)
      setPdfStatus(null)
    } finally {
      setIsPdfUploading(false)
      form.reset()
    }
  }

  const pdfProgress = pdfStatus?.progress ?? null
  const pdfProgressPercent = Math.min(100, Math.max(0, pdfProgress?.percent ?? 0))
  const showPdfProgress = useMemo(() => {
    if (!pdfProgress) return false
    return pdfProgress.total > 0 || pdfProgress.percent > 0 || Boolean(pdfProgress.message)
  }, [pdfProgress])

  const archiveUrl = buildDownloadUrl(pdfStatus?.result?.archive_url ?? undefined)
  const pdfTiming = pdfStatus?.timing ?? null
  const pdfDurationLabel = formatDuration(pdfTiming?.duration_ms ?? null)
  const pdfStartedAt = formatTimestamp(pdfTiming?.started_at ?? null)
  const pdfFinishedAt = formatTimestamp(pdfTiming?.finished_at ?? null)

  return (
    <section className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <FileText className="h-4 w-4" />
            PDF OCR
          </div>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">异步队列 · PDF 批量处理</h2>
          <p className="mt-2 text-sm text-slate-500">系统会自动将页面加入 GPU 推理队列并每秒同步进度。</p>
        </div>
      </div>

      <form
        onSubmit={handlePdfSubmit}
        className="flex flex-col gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-5 transition hover:border-slate-400"
      >
        <label className="flex flex-col items-center gap-3 text-center text-sm text-slate-600" htmlFor={pdfInputId}>
          <Upload className="h-6 w-6 text-slate-500" />
          <span className="font-medium">{pdfFileName ? `已选择：${pdfFileName}` : '上传 PDF 文档以开启任务'}</span>
          <span className="text-xs text-slate-400">系统自动拆分页面并生成 Markdown、JSON 与压缩包。</span>
        </label>
        <input
          id={pdfInputId}
          className="hidden"
          type="file"
          name="pdf"
          accept="application/pdf"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) {
              setPdfFileName(file.name)
            } else {
              setPdfFileName(null)
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">任务 ID 可用于状态查询与结果下载。</span>
          <button
            type="submit"
            disabled={isPdfUploading}
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {isPdfUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {isPdfUploading ? '上传中…' : '提交到队列'}
          </button>
        </div>
      </form>

      {pdfError && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{pdfError}</p>
        </div>
      )}

      {pdfTaskId && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">任务状态</h3>
              <p className="mt-1 text-xs font-medium text-slate-500">ID：{pdfTaskId}</p>
            </div>
            {pdfStatus && (
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeStyles[pdfStatus.status]}`}
              >
                {pdfStatus.status === 'failed' ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : pdfStatus.status === 'succeeded' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-inherit" />
                )}
                {pdfStatus.status === 'pending' && '排队中'}
                {pdfStatus.status === 'running' && '执行中'}
                {pdfStatus.status === 'succeeded' && '已完成'}
                {pdfStatus.status === 'failed' && '失败'}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-400">系统每秒自动更新，无需手动刷新。</p>

          {pdfStatus?.error_message && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-white p-3 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{pdfStatus.error_message}</span>
            </div>
          )}

          {showPdfProgress && pdfProgress && (
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-inner">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>处理进度</span>
                <span>{Math.round(pdfProgressPercent)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${pdfProgressPercent}%` }}
                />
              </div>
              {pdfProgress.message && <p className="text-xs text-slate-500">{pdfProgress.message}</p>}
            </div>
          )}

          {pdfTiming && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-indigo-200 bg-white p-3 text-sm text-slate-600 shadow-inner">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-500">耗时</span>
                <p className="mt-1 text-base font-semibold text-slate-900">{pdfDurationLabel}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-inner">
                <span className="font-semibold uppercase tracking-wider text-slate-400">开始时间</span>
                <p className="mt-1 text-sm text-slate-700">{pdfStartedAt ?? '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-inner">
                <span className="font-semibold uppercase tracking-wider text-slate-400">完成时间</span>
                <p className="mt-1 text-sm text-slate-700">{pdfFinishedAt ?? '—'}</p>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-slate-700">结果下载</h4>
            <p className="mt-1 text-xs text-slate-400">
              任务完成后会提供打包 ZIP，包含 Markdown、JSON 与页面截图。
            </p>
            {pdfStatus?.status === 'succeeded' && archiveUrl ? (
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

export default PdfTaskPanel
