// Vercel Serverless Function — extração de NF via OpenRouter
// Usa pdf-parse para extrair texto do PDF, depois envia ao modelo via OpenRouter

import { Buffer } from 'buffer'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENROUTER_API_KEY não configurada. Acesse: Vercel Dashboard → Settings → Environment Variables'
    })
  }

  const { base64Data } = req.body
  if (!base64Data) return res.status(400).json({ error: 'base64Data é obrigatório.' })

  try {
    // Extrai texto do PDF usando pdf-parse (roda no servidor Node.js da Vercel)
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const pdfBuffer = Buffer.from(base64Data, 'base64')
    const pdfData   = await pdfParse(pdfBuffer)
    const textoNF   = pdfData.text?.trim()

    if (!textoNF) {
      return res.status(422).json({ error: 'Não foi possível extrair texto do PDF.' })
    }

    // Envia o texto ao OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  'https://controlefaconagem.vercel.app',
        'X-Title':       'Façonagem Rhodia',
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
            content: `Extraia os dados desta Nota Fiscal e retorne SOMENTE um JSON no formato abaixo:
{
  "numero_nf": "número da NF (apenas dígitos, sem zeros à esquerda, ex: 99733)",
  "data_emissao": "data no formato YYYY-MM-DD",
  "codigo_material": "código do produto/material (ex: 140911)",
  "lote": "código do lote POY (ex: 53274S)",
  "volume_kg": número decimal do peso líquido em kg (ex: 6234.75),
  "valor_unitario": número decimal do valor unitário (ex: 26.1693)
}

TEXTO DA NOTA FISCAL:
${textoNF.slice(0, 3000)}`
          }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: `OpenRouter error: ${err}` })
    }

    const data    = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim() || ''
    const clean   = content.replace(/```json|```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      // Tenta extrair JSON de dentro de texto
      const match = clean.match(/\{[\s\S]*\}/)
      if (!match) return res.status(422).json({ error: 'Modelo não retornou JSON válido.', raw: clean })
      parsed = JSON.parse(match[0])
    }

    return res.status(200).json(parsed)
  } catch (e) {
    console.error('extract-nf error:', e)
    return res.status(500).json({ error: e.message || 'Erro interno.' })
  }
}
