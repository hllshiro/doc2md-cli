export const layer = 'imageRecognition'

// Regex to match Markdown image syntax: ![alt](src)
export const RE_MD_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g

export const VISION_PROMPT = `Analyze this image and determine its content type.

Rules:
1. If the image contains a mathematical formula, equation, or mathematical expression:
   - Set "isFormula" to true
   - Provide the LaTeX representation in "content" (without dollar sign delimiters)
   - Use standard LaTeX math notation
2. If the image is NOT a mathematical formula:
   - Set "isFormula" to false
   - Provide a concise text description in "content" that captures the key information,
     data, and relationships shown in the image
   - Use Chinese for the description

Respond ONLY with a JSON object in this exact format, no other text:
{"isFormula": true/false, "content": "..."}`

export const VALIDATION_PROMPT = `You are a strict validator. I will provide an image and a previous recognition result. Your job is to verify whether the recognition is correct.

Previous recognition result:
{RESULT}

Rules:
1. If the previous result correctly identified whether the image is a formula or not, AND
   the content (LaTeX or description) accurately represents the image, set "isCorrect" to true.
2. If the recognition is wrong (e.g. misidentified formula vs non-formula, or the LaTeX/description
   is inaccurate), set "isCorrect" to false and explain the error in "reason".

Respond ONLY with a JSON object in this exact format, no other text:
{"isCorrect": true/false, "reason": "..."}`

export const MAX_RECOGNITION_ATTEMPTS = 3
