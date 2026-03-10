// Netlify/AWS Lambda style handler

// Improvements:

// - Strict JSON enforcement (parse + fallback)

// - Stronger prompt: semantic-safety, OFFSET->keyset, DISTINCT->EXISTS, LEFT JOIN predicate rule

// - Better error handling for non-200 Groq responses

// - Input validation + length cap

// - Timeout via AbortController

// - Optional light sanitization of common LLM glitch ("ON ON")
 
exports.handler = async function (event) {

  const headers = {

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Headers": "Content-Type",

    "Access-Control-Allow-Methods": "POST, OPTIONS",

    "Content-Type": "application/json",

  };
 
  if (event.httpMethod === "OPTIONS") {

    return { statusCode: 200, headers, body: "" };

  }
 
  if (event.httpMethod !== "POST") {

    return {

      statusCode: 405,

      headers,

      body: JSON.stringify({ error: "Method Not Allowed" }),

    };

  }
 
  const SYSTEM_PROMPT = `You are an expert SQL Code Review Agent for Data Engineering teams.

Analyze the provided SQL and return a structured JSON review.
 
CRITICAL OUTPUT RULES:

- Return ONLY valid JSON (no markdown, no backticks, no commentary).

- JSON must strictly match this format:
 
{

  "summary": "Brief 1-2 sentence overall assessment",

  "score": <integer 0-100>,

  "findings": [

    {

      "id": 1,

      "severity": "critical|warning|suggestion",

      "category": "Performance|Security|Readability|Best Practice|Anti-pattern",

      "title": "Short title",

      "description": "What the issue is and why it matters",

      "lineRef": "Optional line reference",

      "fix": "Concrete recommended fix with example SQL"

    }

  ],

  "positives": ["List of things done well"],

  "refactoredSnippet": "Improved version of the SQL"

}
 
SCORING RUBRIC:

- Start at 100.

- Each critical finding: -30

- Each warning: -10

- Each suggestion: -3

- Clamp score to [0, 100].

- Ensure score matches the rubric.
 
MUST CHECK FOR:

- SELECT *

- Cartesian joins / missing ON

- N+1 patterns / correlated subqueries

- Non-sargable predicates (functions on indexed columns, e.g. CAST(datecol AS DATE), DATE(col), etc.)

- SQL injection risk (string concatenation patterns, dynamic SQL)

- Implicit conversions

- Missing NULL handling (NOT IN with NULL trap, = NULL, etc.)

- Hardcoded values (warn only; don't change semantics)

- Deep pagination with OFFSET

- DISTINCT used to mask join duplication
 
SEMANTIC-SAFETY (VERY IMPORTANT):

- Refactored SQL MUST preserve semantics.

- Do NOT change join types (INNER/LEFT/RIGHT) unless you can prove equivalence.

- For LEFT JOIN: do NOT move right-table filters from ON to WHERE (it changes semantics). Prefer moving WHERE right-table predicates into ON when needed.

- Do NOT replace literal date ranges with CURRENT_DATE/NOW/DATE_TRUNC or other dynamic logic unless the original query already uses dynamic dates.

- Do NOT drop filters, add filters, or change constants.
 
REFACTOR RULES:

- If correlated subquery in WHERE/SELECT can be rewritten as JOIN + GROUP BY/HAVING, do it.

- If query uses NOT IN (subquery), prefer NOT EXISTS or LEFT JOIN ... IS NULL to avoid NULL trap.

- If query uses OFFSET, provide keyset pagination refactor TEMPLATE using placeholders:

  :last_sort_value and :last_id (tie-breaker). Also add ORDER BY with tie-breaker.

- If DISTINCT is used only to deduplicate after joins (and no aggregate requirement), prefer EXISTS-based rewrite (preserve original intent; if joined tables imply existence, keep them inside EXISTS).

- If you see CAST(datecol AS DATE) comparisons, refactor to range predicates:
>= start AND < next_day/next_month where appropriate.
 
VALIDITY:

- refactoredSnippet must be syntactically valid SQL.

- Avoid duplicated keywords like "ON ON".

- Use aliases consistently once introduced.`;
 
  try {

    // Parse request

    const body = event.body ? JSON.parse(event.body) : {};

    const sql = body.sql;
 
    if (typeof sql !== "string" || sql.trim().length < 3) {

      return {

        statusCode: 400,

        headers,

        body: JSON.stringify({ error: "No SQL provided" }),

      };

    }
 
    // Simple input cap to prevent abuse / runaway tokens

    const trimmedSql = sql.trim();

    const MAX_SQL_CHARS = 20000;

    const safeSql = trimmedSql.length > MAX_SQL_CHARS ? trimmedSql.slice(0, MAX_SQL_CHARS) : trimmedSql;
 
    if (!process.env.GROQ_API_KEY) {

      return {

        statusCode: 500,

        headers,

        body: JSON.stringify({ error: "Missing GROQ_API_KEY" }),

      };

    }
 
    // Timeout

    const controller = new AbortController();

    const timeoutMs = 15000;

    const timeout = setTimeout(() => controller.abort(), timeoutMs);
 
    let response;

    try {

      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {

        method: "POST",

        signal: controller.signal,

        headers: {

          "Content-Type": "application/json",

          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,

        },

        body: JSON.stringify({

          model: "llama-3.3-70b-versatile",

          messages: [

            { role: "system", content: SYSTEM_PROMPT },

            { role: "user", content: "Review this SQL:\n\n" + safeSql },

          ],

          temperature: 0.2,

          max_tokens: 2048,

        }),

      });

    } finally {

      clearTimeout(timeout);

    }
 
    // Handle non-2xx

    if (!response.ok) {

      const errText = await response.text().catch(() => "");

      return {

        statusCode: 502,

        headers,

        body: JSON.stringify({

          error: "Groq API request failed",

          status: response.status,

          details: errText.slice(0, 2000),

        }),

      };

    }
 
    const data = await response.json();
 
    if (data?.error) {

      return {

        statusCode: 500,

        headers,

        body: JSON.stringify({ error: data.error.message || "Groq API error" }),

      };

    }
 
    const text = data?.choices?.[0]?.message?.content || "";

    // Remove code fences if model violates instructions

    let clean = text.replace(/```json|```/g, "").trim();
 
    // Optional: quick fix for a common LLM glitch (still validate afterwards)

    clean = clean.replace(/\bON\s+ON\b/g, "ON");
 
    // Enforce valid JSON

    let parsed;

    try {

      parsed = JSON.parse(clean);

    } catch (e) {

      // Fallback safe JSON so frontend never breaks

      const fallback = {

        summary: "Model did not return valid JSON.",

        score: 0,

        findings: [

          {

            id: 1,

            severity: "critical",

            category: "Best Practice",

            title: "Invalid JSON response",

            description:

              "The LLM output was not valid JSON, so it cannot be safely consumed by the UI. Enforce strict JSON output and/or use a JSON response mode.",

            lineRef: "",

            fix: "Ensure the model returns strict JSON only. Consider response_format JSON mode if supported.",

          },

        ],

        positives: [],

        refactoredSnippet: "",

        raw: clean.slice(0, 1500),

      };
 
      return {

        statusCode: 200,

        headers,

        body: JSON.stringify(fallback),

      };

    }
 
    // Basic schema guard (lightweight)

    if (

      typeof parsed !== "object" ||

      parsed === null ||

      typeof parsed.summary !== "string" ||

      typeof parsed.score !== "number" ||

      !Array.isArray(parsed.findings) ||

      !Array.isArray(parsed.positives) ||

      typeof parsed.refactoredSnippet !== "string"

    ) {

      const fallback = {

        summary: "Model returned JSON but it did not match the required schema.",

        score: 0,

        findings: [

          {

            id: 1,

            severity: "critical",

            category: "Best Practice",

            title: "Schema mismatch",

            description:

              "The LLM output JSON did not conform to the required schema, so the UI may render incorrectly.",

            lineRef: "",

            fix: "Tighten prompt/schema and validate fields server-side before returning.",

          },

        ],

        positives: [],

        refactoredSnippet: "",

        raw: parsed,

      };
 
      return {

        statusCode: 200,

        headers,

        body: JSON.stringify(fallback),

      };

    }
 
    // Return normalized JSON (stringified)

    return {

      statusCode: 200,

      headers,

      body: JSON.stringify(parsed),

    };

  } catch (err) {

    const msg =

      err && typeof err.message === "string" ? err.message : "Unexpected error";
 
    const isAbort = msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort");
 
    return {

      statusCode: isAbort ? 504 : 500,

      headers,

      body: JSON.stringify({ error: msg }),

    };

  }

};
 
