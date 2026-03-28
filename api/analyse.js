export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    // ── STEP 1: Fetch the actual page content ──
    let pageContent = '';
    let pageTitle = '';
    let fetchError = false;

    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; isithuman-bot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000)
      });

      const html = await pageRes.text();

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = titleMatch ? titleMatch[1].trim() : '';

      // Strip HTML tags and extract clean text
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000); // Send first 4000 chars to Claude

    } catch (e) {
      fetchError = true;
      pageContent = `Could not fetch page content directly. Analysing URL structure only: ${url}`;
    }

    // ── STEP 2: Send to Claude for analysis ──
    const prompt = fetchError
      ? `Analyse this URL for AI-generated content indicators: ${url}\n\nNote: Could not fetch page content directly. Base analysis on URL structure, domain patterns, and known indicators.`
      : `Analyse this webpage for AI-generated content.\n\nURL: ${url}\nTitle: ${pageTitle}\n\nPage content (first 4000 characters):\n---\n${pageContent}\n---\n\nAnalyse both the URL/domain AND the actual content text above.`;

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

Return ONLY valid JSON — no markdown, no preamble:
{
  "verdict": "HUMAN" | "AI_GENERATED" | "MIXED",
  "confidence": <integer 0-100>,
  "summary": "<2-3 sentence professional analysis>",
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
}

For signals analyse: perplexity, burstiness, vocabulary entropy, structural patterns, semantic coherence, publishing behaviour, domain reputation.
Return ONLY the JSON object.`,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const textBlock = claudeData.content?.find(c => c.type === 'text');
    if (!textBlock) throw new Error('No response from Claude');

    const result = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim());
    return res.status(200).json(result);

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Analysis failed', message: error.message });
  }
}
