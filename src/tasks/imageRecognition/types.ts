export interface ModelsResponse {
  data: { id: string }[]
}

export type ContentType = 'ascii' | 'latex' | 'description'

export interface RecognitionResult {
  contentType: ContentType
  content: string
}

export interface ValidationResult {
  isCorrect: boolean
  reason: string
}

export interface ImageMatch {
  fullMatch: string
  alt: string
  src: string
  lineIndex: number
  isBlock: boolean
}

export interface FailedImage {
  match: ImageMatch
  imgPath: string
  imageBuffer: Buffer
  mimeType: string
}
