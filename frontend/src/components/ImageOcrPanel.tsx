import { FormEvent, useEffect, useId, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, FileText, ImageIcon, Loader2, Upload } from 'lucide-react'

import { ImageOCRResponse, ocrClient } from '../api/client'
import { formatDuration, formatTimestamp } from '../utils/time'

type PreviewBox = {
  id: string
  label: string
  left: number
  top: number
  width: number
  height: number
}

const buildPreviewBoxes = (result: ImageOCRResponse | null): PreviewBox[] => {
  if (!result?.boxes?.length || !result.image_dims) return []
  const { w, h } = result.image_dims
  if (!w || !h) return []

  const clamp = (value: number) => Math.min(100, Math.max(0, value))

  return result.boxes
    .map((box, index) => {
      const [x1, y1, x2, y2] = box.box
      const width = Math.max(x2 - x1, 0)
      const height = Math.max(y2 - y1, 0)
      if (width <= 0 || height <= 0) {
        return null
      }
      return {
        id: `${box.label}-${index}`,
        label: box.label,
        left: clamp((x1 / w) * 100),
        top: clamp((y1 / h) * 100),
        width: clamp((width / w) * 100),
        height: clamp((height / h) * 100),
      }
    })
    .filter((box): box is PreviewBox => Boolean(box))
}

const ImageOcrPanel = () => {
  const [imageResult, setImageResult] = useState<ImageOCRResponse | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [imageFileName, setImageFileName] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const imageInputId = useId()

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl)
      }
    }
  }, [imagePreviewUrl])

  const handleImageSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const fileInput = form.elements.namedItem('image') as HTMLInputElement | null
    const file = fileInput?.files?.[0]

    if (!file) {
      setImageError('请选择一张图片')
      return
    }

    setIsImageLoading(true)
    setImageError(null)
    setImageResult(null)
    setImageFileName(file.name)

    try {
      const result = await ocrClient.ocrImage(file)
      setImageResult(result)
    } catch (error) {
      setImageResult(null)
      setImageError((error as Error).message)
    } finally {
      setIsImageLoading(false)
      form.reset()
    }
  }

  const previewBoxes = useMemo(() => buildPreviewBoxes(imageResult), [imageResult])
  const imageBoxes = useMemo(() => imageResult?.boxes ?? [], [imageResult])
  const imageTiming = imageResult?.timing ?? null
  const imageDurationLabel = formatDuration(imageResult?.duration_ms ?? imageTiming?.duration_ms ?? null)
  const imageStartedAt = formatTimestamp(imageTiming?.started_at ?? null)
  const imageFinishedAt = formatTimestamp(imageTiming?.finished_at ?? null)

  return (
    <section className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <ImageIcon className="h-4 w-4" />
            图片 OCR
          </div>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">同步识别单张图片</h2>
          <p className="mt-2 text-sm text-slate-500">
            支持 JPG、PNG 等常见格式，识别结果会即时返回，包括原始输出与检测框信息。
          </p>
        </div>
      </div>

      <form
        onSubmit={handleImageSubmit}
        className="flex flex-col gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-5 transition hover:border-slate-400"
      >
        <label className="flex flex-col items-center gap-3 text-center text-sm text-slate-600" htmlFor={imageInputId}>
          <Upload className="h-6 w-6 text-slate-500" />
          <span className="font-medium">{imageFileName ? `已选择：${imageFileName}` : '点击或拖拽文件到此处'}</span>
          <span className="text-xs text-slate-400">最大 100 MB，推荐单页图片</span>
        </label>
        <input
          id={imageInputId}
          className="hidden"
          type="file"
          name="image"
          accept="image/*"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) {
              setImageFileName(file.name)
              if (imagePreviewUrl) {
                URL.revokeObjectURL(imagePreviewUrl)
              }
              setImagePreviewUrl(URL.createObjectURL(file))
              setImageResult(null)
              setImageError(null)
            } else {
              if (imagePreviewUrl) {
                URL.revokeObjectURL(imagePreviewUrl)
              }
              setImageFileName(null)
              setImagePreviewUrl(null)
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">返回内容包含 Markdown 文本、模型原始输出与检测框。</span>
          <button
            type="submit"
            disabled={isImageLoading}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isImageLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            {isImageLoading ? '识别中…' : '开始识别'}
          </button>
        </div>
      </form>
      {imageError && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{imageError}</p>
        </div>
      )}

      {imageResult && (
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-900">识别结果</h3>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              成功
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-white p-3 text-sm text-slate-600 shadow-inner">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-500">耗时</span>
              <p className="mt-1 text-base font-semibold text-slate-900">{imageDurationLabel}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-inner">
              <span className="font-semibold uppercase tracking-wider text-slate-400">开始时间</span>
              <p className="mt-1 text-sm text-slate-700">{imageStartedAt ?? '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-inner">
              <span className="font-semibold uppercase tracking-wider text-slate-400">完成时间</span>
              <p className="mt-1 text-sm text-slate-700">{imageFinishedAt ?? '—'}</p>
            </div>
          </div>

          {imagePreviewUrl && imageResult.image_dims && (
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">识别预览</span>
              <div
                className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-inner"
                style={{ aspectRatio: `${imageResult.image_dims.w} / ${imageResult.image_dims.h}` }}
              >
                <img src={imagePreviewUrl} alt="上传图片预览" className="h-full w-full object-contain" />
                <div className="pointer-events-none absolute inset-0">
                  {previewBoxes.map((box) => (
                    <div
                      key={box.id}
                      className="absolute rounded border-2 border-emerald-500 bg-emerald-400/15"
                      style={{
                        left: `${box.left}%`,
                        top: `${box.top}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                      }}
                    >
                      <span className="absolute left-0 top-0 -translate-y-full rounded bg-emerald-500 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        {box.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {previewBoxes.length === 0 && <p className="text-xs text-slate-400">模型未返回检测框。</p>}
            </div>
          )}

          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">文本内容</span>
            <pre className="max-h-80 overflow-auto rounded-2xl bg-white/80 p-4 text-sm leading-relaxed text-slate-800 shadow-inner">
              {imageResult.text}
            </pre>
          </div>

          <details className="group rounded-2xl bg-white/70 p-4 shadow-inner">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-600 transition group-open:text-slate-900">
              <FileText className="h-4 w-4" />
              查看原始模型输出
            </summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-900/90 p-4 text-xs leading-relaxed text-slate-100">
              {imageResult.raw_text}
            </pre>
          </details>

          {imageBoxes.length > 0 && (
            <div className="rounded-2xl bg-white/80 p-4 shadow-inner">
              <h4 className="text-sm font-semibold text-slate-700">检测框</h4>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {imageBoxes.map((box, index) => (
                  <li key={`${box.label}-${index}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <span className="font-medium text-slate-700">{box.label}</span>
                    <span className="text-xs text-slate-500">[{box.box.join(', ')}]</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default ImageOcrPanel
