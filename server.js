const https = require('https');
const http = require('http');

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
6. DB DETECTION: Detect from syntax. TOP=SQLServer, LIMIT=MySQL/Postgres, ROWNUM=Oracle, DATE_TRUNC=Postgres, QUALIFY=Snowflake.
7. STANDARD: SELECT *=warning, cartesian join=critical, N+1=critical, non-sargable=critical, SQL injection=critical, alias mismatch=warning.`;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SQL Review Agent is running!');
    return;
  }

  if (req.method === 'POST' && req.url === '/review') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sql } = JSON.parse(body);
        if (!sql) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No SQL provided' }));
          return;
        }

        const payload = JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Review this SQL:\n\n' + sql }
          ],
          temperature: 0.2,
          max_tokens: 3000
        });

        const options = {
          hostname: 'api.groq.com',
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Length': Buffer.byteLength(payload)
          }
        };

        const apiReq = https.request(options, apiRes => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: parsed.error.message }));
                return;
              }
              const text = parsed.choices?.[0]?.message?.content || '';
              const clean = text.replace(/```json|```/g, '').trim();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(clean);
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        apiReq.on('error', e => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });

        apiReq.write(payload);
        apiReq.end();

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
