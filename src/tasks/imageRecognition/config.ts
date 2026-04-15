export interface AiConfig {
  baseURL: string
  apiKey: string
  model: string
  enableValidation: boolean
  timeout: number
}

export const aiConfig: AiConfig = {
  baseURL: '',
  apiKey: '',
  model: '',
  enableValidation: false,
  timeout: 0,
}
