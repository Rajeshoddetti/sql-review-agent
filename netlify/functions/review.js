exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const SYSTEM_PROMPT = `You are an expert SQL Code Review Agent for Data Engineering teams. Analyze the provided SQL code and return a structured JSON review.
Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "summary": "Brief 1-2 sentence overall assessment",
  "score": <integer 0-100>,
  "findings": [
    {
      "id": 1,
      "severity": "critical",
      "category": "Performance",
      "title": "Short title",
      "description": "What the issue is and why it matters",
      "lineRef": "Optional line reference",
      "fix": "Concrete recommended fix with example SQL"
    }
  ],
  "positives": ["List of things done well"],
  "refactoredSnippet": "Improved version of the SQL"
}
Severity must be one of: critical, warning, suggestion.
Category must be one of: Performance, Security, Readability, Best Practice, Anti-pattern.
Check for: SELECT *, cartesian joins, N+1 patterns, non-sargable predicates, SQL injection, implicit conversions, missing NULL handling, hardcoded values.`;

  try {
    const body = JSON.parse(event.body);
    const sql = body.sql;

    if (!sql) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No SQL provided' }) };
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: SYSTEM_PROMPT + '\n\nReview this SQL:\n\n' + sql
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048
        }
      })
    });

    const data = await response.json();

    if (data.error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: data.error.message }) };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();

    return {
      statusCode: 200,
      headers,
      body: clean
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
