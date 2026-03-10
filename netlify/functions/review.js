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

---
REVIEW RULES — apply ALL of these:

## 1. SEMANTIC SAFETY (flag as critical if violated)
- If refactoring changes query semantics, add a finding: severity=critical, category=Semantic-Safety, title="CRITICAL: Semantics Changed"
- Never replace hard-coded dates with CURRENT_DATE/NOW/DATE_TRUNC in refactored SQL unless user explicitly asked
- Never move LEFT JOIN filter predicates from ON clause to WHERE clause (converts to INNER JOIN)
- If JOIN type changes (INNER <-> LEFT), always warn with severity=critical
- Missing ON clause in JOIN = cartesian join = severity=critical
- Alias consistency: once alias is defined (e.g. "o" for orders), use it everywhere. Flag alias mismatches as severity=warning

## 2. SARGABLE DATE REWRITES (Performance)
- CAST(col AS DATE) = 'date' → col >= 'date' AND col < 'date+1day'
- YEAR(col) = 2024 → col >= '2024-01-01' AND col < '2025-01-01'
- MONTH(col) = 3 → col >= '2025-03-01' AND col < '2025-04-01'
- DATE(col) = 'date' → col >= 'date' AND col < 'date+1day'
Always apply these rewrites in refactoredSnippet. Flag original as severity=critical, category=Performance.

## 3. AGGREGATION PUSHDOWN (Performance)
- If WHERE filters on aggregated values (e.g. WHERE total > 10000 after a GROUP BY subquery), suggest moving to HAVING inside the subquery to reduce rows before join
- Flag as severity=warning, category=Performance

## 4. NULL SEMANTICS (Correctness)
- NOT IN (subquery) → suggest NOT EXISTS or anti-join (subquery NULL causes unexpected results)
- = NULL → IS NULL (flag as critical)
- != NULL → IS NOT NULL (flag as critical)
- COUNT(*) vs COUNT(col): note that COUNT(col) ignores NULLs, suggest only with explanation
- Flag NULL issues as severity=critical, category=Correctness

## 5. INDEX RECOMMENDATIONS
Based on the query, recommend indexes in the indexRecommendations array:
- JOIN key columns
- WHERE filter columns (most selective first)
- ORDER BY columns
- Example: orders(customer_id, status, created_at) — explain why

## 6. DATABASE DETECTION & DB-SPECIFIC WARNINGS
First, detect the database dialect from syntax clues:
- TOP N = SQL Server
- LIMIT = MySQL/PostgreSQL
- ROWNUM = Oracle
- DATE_TRUNC, ILIKE = PostgreSQL
- QUALIFY = Snowflake
Set detectedDB field accordingly. If unknown, warn about DB-specific syntax like DATE_TRUNC, ILIKE, TOP, LIMIT.
If DB is known, generate correct syntax in refactoredSnippet.

## 7. STANDARD CHECKS (always apply)
- SELECT * = warning (specify columns)
- Cartesian joins (missing ON) = critical
- Correlated subqueries / N+1 patterns = critical
- Non-sargable predicates (functions on indexed columns in WHERE) = critical
- SQL injection risks / hardcoded sensitive values = critical
- Implicit type conversions = warning
- Missing NULL handling = warning
- Hard-coded values that should be parameters = suggestion
- No comments on complex queries = suggestion
---

In refactoredSnippet: apply all safe rewrites (sargable dates, alias consistency, NULL fixes). Do NOT change semantics (join types, filter logic) without flagging it.`;

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
        max_tokens: 3000
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
