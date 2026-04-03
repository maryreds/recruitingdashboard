// Vercel Serverless Function — AI-Generated Key Takeaways
// Uses OpenAI gpt-4o to generate adaptive recruiting insights from real pipeline data

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured.' });
  }

  const { totals, recruiters, rejections, topCompanies, dateRange } = req.body || {};

  if (!totals || !recruiters) {
    return res.status(400).json({ error: 'Missing required fields: totals, recruiters.' });
  }

  const systemPrompt = `You are a senior recruiting analytics advisor for JSM Consulting, a staffing and recruiting firm. You analyze pipeline data and produce sharp, actionable insights for the recruiting team lead.

You will receive real pipeline data (submittals, interviews, rejections, hires, recruiter breakdowns, client info). Generate 4-6 concise key takeaways.

Rules:
- Be specific: use real names, numbers, and percentages from the data
- Be accurate: do NOT say someone is "the only" one doing something unless it's literally true in the data
- Be actionable: each insight should suggest what to do next
- Be honest: flag problems directly, don't sugarcoat
- Vary your insights: cover conversion rates, team performance, client health, rejection patterns, pipeline risks, and opportunities
- Keep each takeaway to 1-2 sentences max
- Do NOT repeat the same data point in multiple takeaways
- Reference industry benchmarks where relevant (e.g. 15-25% submittal-to-interview conversion is typical)

Return a JSON array of objects, each with:
- "icon": a Google Material Symbol name (e.g. "trending_up", "warning", "star", "balance", "feedback", "priority_high", "check_circle", "group", "speed", "target")
- "text": the insight as plain HTML (you may use <strong> for emphasis)

Return ONLY the JSON array, no markdown fences, no explanation.`;

  const userPrompt = `Here is the current pipeline data for the period ${dateRange || 'recent'}:

TOTALS:
- Submittals: ${totals.submittals || 0}
- Interviews: ${totals.interviews || 0}
- Offers: ${totals.offers || 0}
- Hires: ${totals.hires || 0}
- Rejections: ${totals.rejections || 0}

RECRUITER BREAKDOWN:
${recruiters.map(r => `- ${r.name}: ${r.submittals} submittals, ${r.interviews} interviews, ${r.rejections || 0} rejections`).join('\n')}

${rejections && rejections.length > 0 ? `REJECTIONS:\n${rejections.map(r => `- ${r.recruiter}: "${r.candidate || 'Unknown'}" for ${r.role || 'Unknown role'} @ ${r.client || 'Unknown'} — Reason: ${r.reason || 'Not specified'}`).join('\n')}` : 'No rejections recorded.'}

${topCompanies && topCompanies.length > 0 ? `TOP CLIENTS:\n${topCompanies.map(c => `- ${c.name}: ${c.submittals} submittals, ${c.interviews || 0} interviews, ${c.hires || 0} hires`).join('\n')}` : ''}

Analyze this data and generate 4-6 key takeaways.`;

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
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('OpenAI error:', errBody);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();

    // Parse JSON, stripping markdown fences if present
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const takeaways = JSON.parse(cleaned);

    return res.status(200).json({ takeaways });
  } catch (err) {
    console.error('Takeaways error:', err);
    return res.status(500).json({ error: 'Failed to generate takeaways' });
  }
};
