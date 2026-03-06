export const config = { maxDuration: 30 }

function extrairTextoPDFBuffer(buffer) {
  const str = buffer.toString('latin1')
  const matches = []
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
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY não configurada na Vercel.' })

  // Aceita: { base64Data } ou { pdfText }
  const { base64Data, pdfText: pdfTextDireto } = req.body

  if (!base64Data && !pdfTextDireto) {
    return res.status(400).json({ error: 'Envie base64Data ou pdfText.' })
  }

  let textoNF = pdfTextDireto || ''

  // Se veio base64, extrai o texto no servidor
  if (base64Data && !textoNF) {
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null)
      if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = ''
        const buf = Buffer.from(base64Data, 'base64')
        const pdf = await pdfjsLib.getDocument({
          data: new Uint8Array(buf),
          useWorkerFetch: false,
          isEvalSupported: false,
          useSystemFonts: true,
        }).promise
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          textoNF += content.items.map(it => it.str).join(' ') + '\n'
        }
      } else {
        textoNF = extrairTextoPDFBuffer(Buffer.from(base64Data, 'base64'))
      }
    } catch (e) {
      textoNF = extrairTextoPDFBuffer(Buffer.from(base64Data, 'base64'))
    }
  }

  textoNF = textoNF.trim()
  if (!textoNF || textoNF.length < 10) {
    return res.status(422).json({ error: 'Não foi possível extrair texto do PDF.' })
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
            content: `Extraia os dados desta Nota Fiscal e retorne SOMENTE este JSON:\n{\n  "numero_nf": "número da NF sem zeros à esquerda",\n  "data_emissao": "data de emissão no formato YYYY-MM-DD",\n  "codigo_material": "código do produto/item (campo COD. ou Código do Produto na tabela de itens — NÃO é o NCM/SH que tem 8 dígitos). Ex: 140911",\n  "lote": "código do lote POY (campo Lote ou Lote/Qtd). Ex: 5327",\n  "volume_kg": 0,\n  "valor_unitario": 0\n}\n\nATENÇÃO:\n- codigo_material = campo COD. da tabela de produtos (ex: 140911). NÃO é o NCM/SH (sempre 8 dígitos como 54024520).\n- lote = apenas os primeiros 4 dígitos numéricos do campo Lote (ex: 53274S vira 5327).\n- volume_kg = campo QUANTID. em KG.\n- valor_unitario = campo VALOR UNITÁRIO.\n\nNOTA FISCAL:\n${textoNF.slice(0, 4000)}`
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
    return res.status(500).json({ error: e.message })
  }
}
