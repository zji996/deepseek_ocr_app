import axios, { AxiosInstance } from 'axios'

export interface BoundingBox {
  label: string
  box: number[]
}

export interface TaskTiming {
  queued_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  duration_ms?: number | null
}

export interface ImageOCRResponse {
  success: boolean
  text: string
  raw_text: string
  boxes: BoundingBox[]
  image_dims?: { w: number; h: number }
  task_id?: string | null
  timing?: TaskTiming | null
  duration_ms?: number | null
}

export interface TaskCreateResponse {
  task_id: string
}

export interface PdfPageResult {
  index: number
  markdown: string
  raw_text: string
  image_assets: string[]
  boxes: BoundingBox[]
}

export interface TaskResult {
  markdown_url?: string
  raw_json_url?: string
  archive_url?: string
  image_urls: string[]
  pages: PdfPageResult[]
}

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface TaskProgress {
  current: number
  total: number
  percent: number
  message?: string | null
}

export interface TaskStatusResponse {
  task_id: string
  status: TaskStatus
  task_type: 'pdf' | 'image'
  created_at: string
  updated_at: string
  error_message?: string | null
  result?: TaskResult | null
  progress?: TaskProgress | null
  timing?: TaskTiming | null
}

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8001'

class OCRClient {
  private client: AxiosInstance

  constructor(baseURL: string = API_BASE_URL) {
    this.client = axios.create({
      baseURL,
      timeout: 300000,
    })

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const message = error.response?.data?.detail ?? error.message ?? 'Request failed'
        throw new Error(message)
      }
    )
  }

  async healthCheck() {
    const { data } = await this.client.get('/health')
    return data
  }

  async ocrImage(file: File): Promise<ImageOCRResponse> {
    const formData = new FormData()
    formData.append('image', file)

    const { data } = await this.client.post('/api/ocr/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  }

  async enqueuePdf(file: File): Promise<TaskCreateResponse> {
    const formData = new FormData()
    formData.append('pdf', file)

    const { data } = await this.client.post('/api/ocr/pdf', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  }

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const { data } = await this.client.get(`/api/tasks/${taskId}`)
    return data
  }
}

export const ocrClient = new OCRClient()

export default OCRClient
