// Vercel Serverless Function — CV Enhancer API
// Uses OpenAI gpt-4o to extract structured profile data and enhance CV content

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

  const { cvText, targetRole, options } = req.body || {};

  if (!cvText || typeof cvText !== 'string' || cvText.trim().length < 20) {
    return res.status(400).json({ error: 'Please provide CV text (at least 20 characters).' });
  }

  // Build enhancement instructions based on options
  const enhancements = [];
  if (options?.includes('quantify_metrics')) {
    enhancements.push('- Quantify all achievements using the STAR framework. Add realistic metrics (percentages, dollar amounts, team sizes) where the original text implies impact but lacks numbers.');
  }
  if (options?.includes('optimize_keywords')) {
    enhancements.push('- Optimize for industry-standard keywords and leadership competencies favored by Fortune 500 talent acquisition teams and ATS systems.');
  }
  if (options?.includes('strategic_conciseness')) {
    enhancements.push('- Apply executive brevity: each bullet should be one impactful sentence. Remove filler words, passive voice, and redundancy.');
  }
  if (options?.includes('ats_friendly')) {
    enhancements.push('- Structure content for ATS compatibility: use standard section headers, avoid tables/columns, use common job title conventions.');
  }

  const roleContext = targetRole
    ? `The candidate is targeting the role of "${targetRole}". Tailor the title, summary language, and keyword emphasis accordingly.`
    : '';

  const systemPrompt = `You are an elite executive CV writer for JSM Consulting, a premium recruiting intelligence firm. Your job is to transform raw CV content into structured profile data.

You MUST return valid JSON only — no markdown, no code fences, no explanatory text. Return a JSON object with this exact structure:

{
  "name": "Full Name",
  "title": "Enhanced professional title/headline",
  "contact": {
    "email": "email if found or null",
    "phone": "phone if found or null",
    "location": "city/country if found or null"
  },
  "summary": "2-3 sentence professional summary in third person, emphasizing strategic value and impact",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "dates": "Start – End",
      "current": true or false,
      "bullets": [
        "Achievement bullet with quantified metrics",
        "Another achievement bullet"
      ]
    }
  ],
  "education": [
    {
      "degree": "Degree name and field",
      "school": "Institution name"
    }
  ],
  "skills": ["Skill 1", "Skill 2", "Skill 3"],
  "certifications": ["Certification 1", "Certification 2"],
  "metrics": [
    {
      "value": "94%",
      "label": "A key performance metric description"
    }
  ]
}

Guidelines for enhancing:
${enhancements.join('\n') || '- Improve clarity, impact, and professionalism throughout.'}
- Preserve all factual information. Do not invent employers, degrees, or certifications.
- You may strengthen language and add plausible metrics where the original implies impact.
- Use strong action verbs: Spearheaded, Architected, Orchestrated, Championed, Accelerated.
- For "metrics": extract or infer 2-3 impressive headline numbers from the CV (e.g. budget managed, team size, efficiency gain %, years of experience). Format value as a short string like "$12.4M" or "94%" or "15+". Label should be a brief descriptor.
- For "skills": include 5-8 key competencies. Put the 2 most important ones first (they get highlighted styling).
- For "certifications": only include real certifications mentioned or clearly implied. If none, use an empty array.
- Keep experience entries in chronological order (most recent first). Mark the most recent role as "current": true if it appears to be ongoing.
${roleContext}`;

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
          { role: 'user', content: `Parse and enhance this CV into the JSON structure:\n\n${cvText.slice(0, 8000)}` },
        ],
        max_tokens: 4000,
        temperature: 0.7,
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

    // Strip markdown code fences if present
    content = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();

    let profile;
    try {
      profile = JSON.parse(content);
    } catch {
      console.error('JSON parse failed:', content.slice(0, 500));
      return res.status(502).json({ error: 'Failed to parse AI response. Please try again.' });
    }

    return res.status(200).json({ profile });
  } catch (err) {
    console.error('Enhancement error:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};
