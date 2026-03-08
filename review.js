exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SYSTEM_PROMPT = `You are an expert SQL Code Review Agent for Data Engineering teams. Analyze the provided SQL code and return a structured JSON review.
Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "summary": "Brief 1-2 sentence overall assessment",
  "score": <integer 0-100>,
  "findings": [
    {
      "id": 1,
      "severity": "critical" | "warning" | "suggestion",
      "category": "Performance" | "Security" | "Readability" | "Best Practice" | "Anti-pattern",
      "title": "Short title",
      "description": "What the issue is and why it matters",
      "lineRef": "Optional line or clause reference",
      "fix": "Concrete recommended fix with example SQL"
    }
  ],
  "positives": ["List of things done well"],
  "refactoredSnippet": "Improved version or null"
}
Check for: SELECT *, cartesian joins, N+1 patterns, non-sargable predicates, SQL injection, implicit conversions, missing NULL handling, hardcoded values.`;

  try {
    const { sql } = JSON.parse(event.body);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: 'Review this SQL:\n\n' + sql }]
      })
    });

    const data = await response.json();
    const text = (data.content || []).map(i => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: clean
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
