export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY não configurada na Vercel.' })
  }

  const { pdfText, base64Data } = req.body || {}
  const textoNF = (pdfText || base64Data || '').trim()

  if (!textoNF || textoNF.length < 10) {
    return res.status(400).json({ error: 'Texto do PDF não recebido ou muito curto.' })
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://controlefaconagem.vercel.app',
        'X-Title': 'Façonagem Rhodia',
      },
      body: JSON.stringify({
        model: 'arcee-ai/trinity-large-preview:free',
        max_tokens: 512,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'Você é um extrator de dados de Notas Fiscais brasileiras. Retorne APENAS JSON válido, sem markdown, sem texto adicional.'
          },
          {
            role: 'user',
            content: `Extraia os dados desta Nota Fiscal e retorne SOMENTE este JSON preenchido:\n{\n  "numero_nf": "número sem zeros à esquerda, ex: 99733",\n  "data_emissao": "formato YYYY-MM-DD",\n  "codigo_material": "código do produto, ex: 140911",\n  "lote": "lote POY, ex: 53274S",\n  "volume_kg": 0.000,\n  "valor_unitario": 0.000000\n}\n\nTEXTO DA NOTA FISCAL:\n${textoNF.slice(0, 4000)}`
          }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: `OpenRouter: ${err.slice(0, 300)}` })
    }

    const data = await response.json()
    const content = (data.choices?.[0]?.message?.content || '').trim()
    const clean = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      const match = clean.match(/\{[\s\S]*\}/)
      if (!match) return res.status(422).json({ error: 'JSON inválido.', raw: clean.slice(0, 200) })
      parsed = JSON.parse(match[0])
    }

    return res.status(200).json(parsed)
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}
