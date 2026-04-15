export const layer = 'imageRecognition'

// Regex to match Markdown image syntax: ![alt](src)
export const RE_MD_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g

export const VISION_PROMPT = `Analyze this image and determine its content type.

Follow these steps in order:

STEP 1: Check if the image contains simple content that can be directly represented as plain text characters
- Examples: single letters (A, B, C, ω, λ, α, β, π), digits (0-9), simple symbols (+, -, =, <, >), basic operators
- These are characters that can be directly typed or copied as text without LaTeX formatting
- If YES: Set "contentType" to "ascii" and provide the character(s) in "content"

STEP 2: If not ASCII, check if the image contains a mathematical formula, equation, or mathematical expression
- If YES: Set "contentType" to "latex" and provide the LaTeX representation in "content" (without dollar sign delimiters)
- Use standard LaTeX math notation

STEP 3: If neither ASCII nor LaTeX formula
- The image is a complex diagram, flowchart, illustration, or other visual content
- Set "contentType" to "description"
- Provide a concise text description in "content" that captures the key information, data, and relationships shown in the image
- Use Chinese for the description

Respond ONLY with a JSON object in this exact format, no other text:
{"contentType": "ascii|latex|description", "content": "..."}`

export const VALIDATION_PROMPT = `You are a strict validator. I will provide an image and a previous recognition result. Your job is to verify whether the recognition is correct.

Previous recognition result:
{RESULT}

Validation Rules:
1. Check if contentType is appropriate:
   - "ascii": Only for simple characters that can be directly typed (ω, λ, α, β, π, simple symbols)
   - "latex": For mathematical formulas, equations, or expressions
   - "description": For complex diagrams, flowcharts, illustrations, or non-formula content

2. Check if content accurately represents the image:
   - ASCII content should be the exact character(s) shown
   - LaTeX content should correctly represent the mathematical expression
   - Description should accurately capture key information in Chinese

3. Set "isCorrect" to true only if both contentType and content are accurate.
4. Set "isCorrect" to false if contentType is wrong or content is inaccurate, and explain the error in "reason".

Respond ONLY with a JSON object in this exact format, no other text:
{"isCorrect": true/false, "reason": "..."}`

export const MAX_RECOGNITION_ATTEMPTS = 3
