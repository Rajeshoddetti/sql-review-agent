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

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Review this SQL:\n\n' + sql }
        ],
        temperature: 0.2,
        max_tokens: 2048
      })
    });

    const data = await response.json();

    if (data.error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: data.error.message }) };
    }

    const text = data.choices?.[0]?.message?.content || '';
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
