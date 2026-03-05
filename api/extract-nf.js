// Vercel Serverless Function — proxy para a API Anthropic
// Resolve o bloqueio de CORS ao chamar api.anthropic.com diretamente do browser
// Deploy: qualquer arquivo em /api/* vira uma serverless function na Vercel automaticamente

export default async function handler(req, res) {
  // CORS — permite o domínio do frontend
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'ANTHROPIC_API_KEY não configurada. Acesse: Vercel Dashboard → seu projeto → Settings → Environment Variables → adicione ANTHROPIC_API_KEY com sua chave sk-ant-...' 
    })
  }

  try {
    const { base64Data } = req.body

    if (!base64Data) {
      return res.status(400).json({ error: 'base64Data é obrigatório.' })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64Data }
            },
            {
              type: 'text',
              text: `Extraia os dados desta Nota Fiscal e retorne APENAS um JSON válido, sem texto adicional, sem markdown, sem explicações:
{
  "numero_nf": "número da NF sem zeros à esquerda desnecessários",
  "data_emissao": "data no formato YYYY-MM-DD",
  "codigo_material": "código do produto/material (campo COD)",
  "lote": "código do lote (apenas o código, sem a quantidade, ex: 53274S)",
  "volume_kg": número em ponto flutuante do peso líquido em kg,
  "valor_unitario": número em ponto flutuante do valor unitário
}
Retorne SOMENTE o JSON, nada mais.`
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }

    const data = await response.json()
    const text = data.content?.map(c => c.text || '').join('').trim()
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    return res.status(200).json(parsed)
  } catch (e) {
    console.error('extract-nf error:', e)
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}
