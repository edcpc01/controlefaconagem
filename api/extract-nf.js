// Vercel Serverless Function — extração de NF via OpenRouter
// Usa pdfjs-dist (já dependência do projeto) para extrair texto do PDF

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

  const { base64Data } = req.body
  if (!base64Data) return res.status(400).json({ error: 'base64Data é obrigatório.' })

  try {
    // ── Extração de texto via pdfjs-dist (compatível com Node.js serverless) ──
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = ''  // sem worker no servidor

    const pdfBytes  = Buffer.from(base64Data, 'base64')
    const loadTask  = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true })
    const pdf       = await loadTask.promise

    let textoNF = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i)
      const content = await page.getTextContent()
      const linhas  = content.items.map(item => item.str).join(' ')
      textoNF += linhas + '\n'
    }

    textoNF = textoNF.trim()
    if (!textoNF) {
      return res.status(422).json({ error: 'Não foi possível extrair texto do PDF. Verifique se o PDF não é escaneado.' })
    }

    // ── Chamada ao OpenRouter ──
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  'https://controlefaconagem.vercel.app',
        'X-Title':       'Façonagem Rhodia',
      },
      body: JSON.stringify({
        model:       'arcee-ai/trinity-large-preview:free',
        max_tokens:  512,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'Você é um extrator de dados de Notas Fiscais brasileiras. Retorne APENAS JSON válido, sem markdown, sem texto adicional, sem explicações.'
          },
          {
            role: 'user',
            content: `Extraia os dados desta Nota Fiscal e retorne SOMENTE este JSON preenchido:
{
  "numero_nf": "número da NF sem zeros à esquerda, ex: 99733",
  "data_emissao": "data no formato YYYY-MM-DD",
  "codigo_material": "código do produto/material (campo COD ou similar), ex: 140911",
  "lote": "código do lote POY (campo Lote), ex: 53274S",
  "volume_kg": numero_decimal_do_peso_liquido_em_kg,
  "valor_unitario": numero_decimal_do_valor_unitario
}

TEXTO DA NOTA FISCAL:
${textoNF.slice(0, 4000)}`
          }
        ]
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('OpenRouter error:', errText)
      return res.status(response.status).json({ error: `OpenRouter: ${errText.slice(0, 200)}` })
    }

    const data    = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim() || ''

    // Limpa possível markdown e extrai JSON
    const clean = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      const match = clean.match(/\{[\s\S]*\}/)
      if (!match) {
        console.error('Resposta não-JSON do modelo:', clean)
        return res.status(422).json({ error: 'Modelo não retornou JSON válido.', raw: clean.slice(0, 300) })
      }
      parsed = JSON.parse(match[0])
    }

    return res.status(200).json(parsed)

  } catch (e) {
    console.error('extract-nf error:', e.message, e.stack)
    return res.status(500).json({ error: e.message || 'Erro interno no servidor.' })
  }
}
