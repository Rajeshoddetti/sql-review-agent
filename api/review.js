const SYSTEM_PROMPT = `You are an expert SQL Code Review Agent for Data Engineering teams. Analyze the provided SQL code and return a structured JSON review.

Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "summary": "Brief 1-2 sentence overall assessment",
  "score": <integer 0-100>,
  "detectedDB": "mysql|postgres|sqlserver|oracle|snowflake|unknown",
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
  "indexRecommendations": [
    {
      "table": "table_name",
      "columns": ["col1", "col2"],
      "reason": "Why this index helps"
    }
  ],
  "positives": ["List of things done well"],
  "refactoredSnippet": "Improved version of the SQL"
}

Severity must be one of: critical, warning, suggestion.
Category must be one of: Performance, Security, Readability, Best Practice, Anti-pattern, Correctness, Semantic-Safety.

REVIEW RULES:
1. SEMANTIC SAFETY: Never change join types or move LEFT JOIN predicates. Flag semantic changes as critical.
2. SARGABLE DATES: YEAR(col)=2024 -> col >= '2024-01-01' AND col < '2025-01-01'. CAST(col AS DATE)='date' -> range filter.
3. AGGREGATION PUSHDOWN: WHERE on aggregates -> suggest HAVING inside subquery.
4. NULL SEMANTICS: NOT IN subquery -> NOT EXISTS. = NULL -> IS NULL. != NULL -> IS NOT NULL.
5. INDEX RECOMMENDATIONS: Suggest indexes for JOIN keys, WHERE filters, ORDER BY columns.
6. DB DETECTION: TOP=SQLServer, LIMIT=MySQL/Postgres, ROWNUM=Oracle, DATE_TRUNC=Postgres, QUALIFY=Snowflake.
7. STANDARD: SELECT *=warning, cartesian join=critical, N+1=critical, non-sargable=critical, SQL injection=critical.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { sql } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'No SQL provided' });
  }

  try {
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
        max_tokens: 3000
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
