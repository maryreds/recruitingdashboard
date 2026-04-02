// Vercel Serverless Function — Cover Letter Generator API
// Uses OpenAI gpt-4o to generate tailored cover letters

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

  const { candidateName, candidateTitle, candidateBackground, jobTitle, companyName, jobDescription, tone } = req.body || {};

  if (!candidateName || !candidateTitle || !candidateBackground || !jobTitle || !companyName) {
    return res.status(400).json({ error: 'Missing required fields: candidateName, candidateTitle, candidateBackground, jobTitle, companyName.' });
  }

  const toneInstructions = {
    professional: 'Use a polished, formal tone appropriate for C-suite and board-level audiences. Measured confidence, strategic language.',
    confident: 'Use a bold, assertive tone that positions the candidate as a proven leader. Direct statements of impact and capability.',
    personable: 'Use a warm yet professional tone that conveys genuine enthusiasm and cultural fit alongside strategic competence.',
  };

  const toneGuide = toneInstructions[tone] || toneInstructions.professional;

  const jdContext = jobDescription
    ? `\n\nJob Description for reference:\n${jobDescription.slice(0, 4000)}`
    : '';

  const systemPrompt = `You are an elite cover letter writer for JSM Consulting, a premium recruiting intelligence firm. You craft compelling, role-specific cover letters that position candidates as strategic assets.

Output ONLY well-structured HTML (no markdown, no code fences). Format the letter as:
- <div class="header"> containing the candidate's name (as <strong>), date, and company address
- Multiple <p> tags for the letter body (3-4 paragraphs)
- <div class="closing"> for the sign-off

Structure:
1. Opening paragraph: A compelling hook that connects the candidate's core value proposition to the specific role. Never start with "I am writing to apply for..."
2. Body paragraph 1: Highlight 2-3 most relevant achievements from their background, using specific metrics. Map these directly to what the role/company needs.
3. Body paragraph 2: Demonstrate knowledge of the company and explain unique strategic value the candidate brings. Show cultural and strategic alignment.
4. Closing paragraph: Confident, specific call to action. Express genuine interest in contributing to a specific company initiative or goal.

Rules:
- ${toneGuide}
- Keep it under 400 words.
- Never use generic phrases like "I believe I would be a great fit" or "Thank you for your consideration."
- Use the candidate's actual achievements from the background provided. Do not invent credentials.
- Address to "Dear Hiring Manager" unless a specific name is given in the job description.
- Date should be formatted as a full date (e.g., "April 2, 2026").
- Sign off with the candidate's full name and current title.`;

  const userPrompt = `Generate a cover letter for:

Candidate: ${candidateName}
Current Title: ${candidateTitle}
Target Role: ${jobTitle} at ${companyName}

Candidate Background:
${candidateBackground.slice(0, 4000)}${jdContext}`;

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
        max_tokens: 2000,
        temperature: 0.75,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error('OpenAI error:', response.status, errBody);
      return res.status(502).json({ error: 'AI service temporarily unavailable. Please try again.' });
    }

    const data = await response.json();
    let html = data.choices?.[0]?.message?.content || '';

    // Strip markdown code fences if present
    html = html.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim();

    return res.status(200).json({ html });
  } catch (err) {
    console.error('Cover letter error:', err);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};
