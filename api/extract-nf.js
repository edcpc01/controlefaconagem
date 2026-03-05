// Vercel Serverless Function — extração de NF via OpenRouter
// Estratégia: extrai texto do PDF com regex simples sobre o buffer (sem dependências)
// Se não conseguir, tenta via pdfjs-dist como fallback

export const config = { maxDuration: 30 }

/** Extrai strings legíveis de um buffer PDF sem dependências externas */
function extrairTextoPDF(buffer) {
  const str = buffer.toString('latin1')
  // Captura streams de texto BT...ET e strings entre parênteses
  const matches = []
  // Strings entre parênteses (formato PDF text)
  const re1 = /\(([^\)\\]{2,})\)/g
  let m
  while ((m = re1.exec(str)) !== null) {
    const s = m[1].replace(/\\n/g, ' ').replace(/\\/g, '').trim()
    if (s.length > 1) matches.push(s)
  }
  return matches.join(' ')
}

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

  let textoNF = ''

  try {
    // Tenta pdfjs-dist primeiro (mais preciso)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
      .catch(() => null)

    if (pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = ''
      const pdfBytes  = Buffer.from(base64Data, 'base64')
      const loadTask  = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes),
        useWorkerFetch:  false,
        isEvalSupported: false,
        useSystemFonts:  true,
      })
      const pdf = await loadTask.promise
      for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i)
        const content = await page.getTextContent()
        textoNF += content.items.map(it => it.str).join(' ') + '\n'
      }
    } else {
      // Fallback: extração simples sem dependências
      const buf = Buffer.from(base64Data, 'base64')
      textoNF = extrairTextoPDF(buf)
    }

    textoNF = textoNF.trim()
    if (!textoNF || textoNF.length < 20) {
      return res.status(422).json({ error: 'Não foi possível extrair texto do PDF.' })
    }
  } catch (e) {
    // Fallback se pdfjs falhar
    try {
      const buf = Buffer.from(base64Data, 'base64')
      textoNF = extrairTextoPDF(buf).trim()
    } catch {
      return res.status(500).json({ error: 'Falha ao processar PDF: ' + e.message })
    }
  }

  try {
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
            content: 'Você é um extrator de dados de Notas Fiscais brasileiras. Retorne APENAS JSON válido, sem markdown, sem texto adicional.'
          },
          {
            role: 'user',
            content: `Extraia os dados desta Nota Fiscal e retorne SOMENTE este JSON:
{
  "numero_nf": "número sem zeros à esquerda, ex: 99733",
  "data_emissao": "formato YYYY-MM-DD",
  "codigo_material": "código do produto, ex: 140911",
  "lote": "lote POY, ex: 53274S",
  "volume_kg": peso_liquido_numero,
  "valor_unitario": valor_unitario_numero
}

NOTA FISCAL:
${textoNF.slice(0, 4000)}`
          }
        ]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: `OpenRouter: ${err.slice(0, 300)}` })
    }

    const data    = await response.json()
    const content = (data.choices?.[0]?.message?.content || '').trim()
    const clean   = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      const match = clean.match(/\{[\s\S]*\}/)
      if (!match) return res.status(422).json({ error: 'JSON inválido do modelo.', raw: clean.slice(0, 200) })
      parsed = JSON.parse(match[0])
    }

    return res.status(200).json(parsed)
  } catch (e) {
    console.error('OpenRouter error:', e)
    return res.status(500).json({ error: e.message })
  }
}
