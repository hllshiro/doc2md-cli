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

Validation Rules - Check based on contentType:

FOR "ascii" type:
1. Check if ascii type is appropriate: Should only be used for simple characters that can be directly typed without LaTeX (single letters like A, B, C, ω, λ, α, β, π, digits 0-9, simple symbols like +, -, =, <, >)
2. Check if the output text accurately represents the image: The character(s) should exactly match what's shown in the image
3. Common errors to catch: Using ascii for formulas that need LaTeX, wrong character recognition

FOR "latex" type:
1. Check if latex type is appropriate: Should be used for mathematical formulas, equations, or expressions
2. Check if the LaTeX code syntax is correct: Verify that the LaTeX code can compile without syntax errors
   - Check for balanced braces {}, brackets [], parentheses ()
   - Check for valid LaTeX commands (\\frac, \\sum, \\int, etc.)
   - Check for proper math mode syntax
3. Check if the LaTeX correctly represents the mathematical expression in the image
4. Common errors to catch: Missing delimiters, invalid commands, incorrect formula structure

FOR "description" type:
1. Check if description type is appropriate: Should be used for complex diagrams, flowcharts, illustrations, or non-formula content
2. Check if the description is detailed enough: Does it capture the key information, data, relationships, and structure shown in the image?
3. Check if the understanding is appropriate: Is the interpretation of the image content correct and comprehensive?
4. Check if the description is in Chinese as required
5. Common errors to catch: Too vague, missing key elements, incorrect interpretation, wrong language

Set "isCorrect" to true only if:
- The contentType is appropriate for the image content, AND
- The content passes all type-specific checks above

Set "isCorrect" to false if any check fails, and provide a specific reason explaining what is wrong and what the correct answer should be.

Respond ONLY with a JSON object in this exact format, no other text:
{"isCorrect": true/false, "reason": "..."}`

export const MAX_RECOGNITION_ATTEMPTS = 3
