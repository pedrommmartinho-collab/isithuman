module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    let pageContent = '';
    let pageTitle = '';
    let fetchError = false;

    try {
      const pageRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; isithuman-bot/1.0)' },
        signal: AbortSignal.timeout(8000)
      });
      const html = await pageRes.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = titleMatch ? titleMatch[1].trim() : '';
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);
    } catch (e) {
      fetchError = true;
    }

    const prompt = fetchError
      ? `Analyse this URL for AI-generated content: ${url}`
      : `Analyse this webpage for AI-generated content.\nURL: ${url}\nTitle: ${pageTitle}\nContent:\n---\n${pageContent}\n---`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are isithuman.ai's analysis engine. Determine if a webpage was written by a human or AI.

Return ONLY valid JSON:
{
  "verdict": "HUMAN" | "AI_GENERATED" | "MIXED",
  "confidence": <integer 0-100>,
  "summary": "<2-3 sentence analysis>",
  "domain": [
    { "key": "Domain age", "value": "<assessment>", "flag": "ok" | "warn" | "mid" },
    { "key": "Publisher type", "value": "<assessment>", "flag": "ok" | "warn" | "mid" },
    { "key": "Author signals", "value": "<assessment>", "flag": "ok" | "warn" | "mid" }
  ],
  "signals": [
    { "name": "<signal>", "finding": "<finding>", "level": "HIGH" | "MEDIUM" | "LOW" },
    { "name": "<signal>", "finding": "<finding>", "level": "HIGH" | "MEDIUM" | "LOW" },
    { "name": "<signal>", "finding": "<finding>", "level": "HIGH" | "MEDIUM" | "LOW" },
    { "name": "<signal>", "finding": "<finding>", "level": "HIGH" | "MEDIUM" | "LOW" }
  ]
}`,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const textBlock = claudeData.content?.find(c => c.type === 'text');
    if (!textBlock) throw new Error('No response from Claude');

    const result = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim());
    return res.status(200).json(result);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
}
