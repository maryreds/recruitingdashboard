// Vercel Serverless Function — Candidate Match API
// Accepts up to 10 CV texts + 1 JD, calls gpt-4o, returns ranked candidate analysis

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured. Set OPENAI_API_KEY in Vercel env vars.' });
  }

  const { candidates, jobDescription } = req.body || {};

  if (!jobDescription || typeof jobDescription !== 'string' || jobDescription.trim().length < 20) {
    return res.status(400).json({ error: 'Please provide a job description (at least 20 characters).' });
  }

  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one candidate CV.' });
  }

  if (candidates.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 candidates per comparison.' });
  }

  const candidateBlocks = candidates
    .map((c, i) => `=== CANDIDATE ${i + 1}: "${c.name}" ===\n${(c.text || '').slice(0, 6000)}\n`)
    .join('\n');

  const systemPrompt = `You are a senior recruiting analyst for JSM Consulting, a premium staffing firm. You receive a Job Description and up to 10 candidate CVs. Your job is to produce a brutally honest, data-driven comparative analysis.

You MUST return valid JSON only — no markdown, no code fences, no explanatory text.

Return a JSON object with this exact structure:

{
  "summary": "2-3 sentence executive summary of the candidate pool quality and top recommendation",
  "candidates": [
    {
      "name": "Candidate name (from CV or filename)",
      "rank": 1,
      "matchScore": 84,
      "matchPercentile": "Top 5%",
      "verdict": "Strong Match" | "Good Match" | "Moderate Match" | "Weak Match" | "Poor Match",
      "roleFit": {
        "score": 84,
        "summary": "1-2 sentences on how well skills/experience align with the JD requirements"
      },
      "stability": {
        "score": 70,
        "avgTenure": "2.5 years",
        "jobCount": 5,
        "flag": "Stable" | "Some Job Hopping" | "Frequent Job Hopping",
        "detail": "Brief explanation"
      },
      "employmentGaps": {
        "found": true,
        "detail": "Description of any gaps found, or 'No significant gaps detected'"
      },
      "location": {
        "detected": "City, Country or 'Not specified'",
        "availabilityNote": "Likely available for remote/relocation/local — based on what the CV suggests"
      },
      "workType": {
        "history": "Mostly Full-Time" | "Mostly Contract" | "Mixed" | "Not Clear",
        "detail": "Brief note"
      },
      "riskScore": {
        "level": 0-100,
        "label": "Low Risk" | "Proceed with Caution" | "Double-Check with Probing Questions" | "High Risk",
        "flags": [
          "Specific red flag or concern (e.g., 'CV appears heavily AI-generated — generic phrasing throughout')",
          "Another flag if applicable"
        ]
      },
      "strengths": ["Key strength 1", "Key strength 2", "Key strength 3"],
      "weaknesses": ["Key weakness or gap 1", "Key weakness or gap 2"],
      "positioningAdvice": "How to pitch this candidate to the hiring manager — what to emphasize, what to address proactively",
      "improvementTips": ["Specific tip to improve their chances 1", "Tip 2"],
      "interviewQuestions": ["A probing question to verify a claim or explore a concern", "Another question"]
    }
  ]
}

Analysis guidelines:
- Rank candidates from best to worst fit for THIS specific JD.
- matchScore: 0-100 based on skills match, experience depth, seniority alignment, and domain relevance.
- riskScore flags should catch: AI-written/generic CVs, shallow knowledge indicators, inflated titles, inconsistent timelines, buzzword stuffing without substance, suspiciously perfect formatting with no depth.
- For stability: calculate average tenure from listed positions. Flag if average < 1.5 years.
- For gaps: look for unexplained periods between roles.
- Be specific and actionable — no filler. Name exact skills, tools, or experiences that match or miss.
- interviewQuestions should probe the specific risks or gaps you identified for each candidate.
- If a CV is very short or clearly padded, flag it explicitly in riskScore.`;

  const userPrompt = `=== JOB DESCRIPTION ===
${jobDescription.slice(0, 6000)}

=== CANDIDATES (${candidates.length}) ===
${candidateBlocks}

Analyze all ${candidates.length} candidate(s) against this job description. Rank them and provide the full structured analysis.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 8000,
        temperature: 0.6,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error('OpenAI error:', response.status, errBody);
      return res.status(502).json({ error: 'AI service temporarily unavailable. Please try again.' });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '{}';

    content = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      console.error('JSON parse failed:', content.slice(0, 500));
      return res.status(502).json({ error: 'Failed to parse AI response. Please try again.' });
    }

    return res.status(200).json({ analysis });
  } catch (err) {
    console.error('Candidate match error:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};
