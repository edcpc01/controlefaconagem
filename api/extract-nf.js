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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada na Vercel.' })

  const { base64Data, pdfText: pdfTextDireto, imageBase64, operacao } = req.body

  if (!base64Data && !pdfTextDireto && !imageBase64) {
    return res.status(400).json({ error: 'Envie base64Data, pdfText ou imageBase64.' })
  }

  let textoNF = pdfTextDireto || ''

  if (!textoNF && base64Data) {
    try {
      const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js')
      const buf = Buffer.from(base64Data, 'base64')
      const data = await pdfParse(buf)
      textoNF = data.text || ''
    } catch (e) {
      textoNF = extrairTextoPDFBuffer(Buffer.from(base64Data, 'base64'))
    }
  }

  textoNF = textoNF.trim()
  const usarVision = (!textoNF || textoNF.length < 80) && imageBase64

  if (!usarVision && textoNF.length < 10) {
    return res.status(422).json({ error: 'Não foi possível extrair texto do PDF.' })
  }

  const loteDigitos = operacao === 'nilit' ? 5 : 4

  const promptTexto = `Extraia os dados desta Nota Fiscal. A NF pode conter UM ou MAIS itens/produtos.
Esta é uma operação primariamente do tipo: ${operacao || 'desconhecida'}.

Retorne SOMENTE este JSON (sem markdown, sem texto extra):
{
  "numero_nf": "número da NF sem zeros à esquerda",
  "data_emissao": "data de emissão no formato YYYY-MM-DD",
  "itens": [
    {
      "codigo_material": "código do produto (campo COD. PROD. — NÃO é o NCM que tem 8 dígitos). Ex: 152504",
      "descricao_material": "descrição completa do produto/serviço",
      "lote": "apenas os dígitos numéricos do lote POY (${loteDigitos} dígitos para esta operação). Se for insumo/consumo sem lote, retorne ''",
      "volume_kg": quantidade numérica (campo QTD ou QUANTID.),
      "valor_unitario": valor unitário como número decimal (campo V. UNITÁRIO)
    }
  ]
}

REGRAS:
- "numero_nf": sem zeros à esquerda (ex: "51550" não "000051550")
- "codigo_material": campo COD. PROD. da tabela (ex: 152504, 137157). NUNCA usar NCM/SH (8 dígitos).
- "lote": somente dígitos, ${loteDigitos} dígitos (ex: POY-100/34-37553 → "37553"). Insumos → "".
- "volume_kg": valor numérico da quantidade (KG, PC, EA, etc — use o número sempre).
- "valor_unitario": V. UNITÁRIO da tabela.
- Múltiplos produtos → retorne todos no array "itens".`

  try {
    const systemInstruction = 'Você é um extrator de dados de Notas Fiscais brasileiras. Retorne APENAS JSON válido, sem markdown, sem texto adicional.'

    const parts = usarVision
      ? [
          { text: promptTexto },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        ]
      : [{ text: `${promptTexto}\n\nTEXTO DA NOTA FISCAL:\n${textoNF.slice(0, 5000)}` }]

    const model = 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: `Gemini: ${err.slice(0, 300)}` })
    }

    const data = await response.json()
    const content = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()
    const clean = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      const match = clean.match(/\{[\s\S]*\}/)
      if (!match) return res.status(422).json({ error: 'JSON inválido.', raw: clean.slice(0, 200) })
      parsed = JSON.parse(match[0])
    }

    // Normaliza: se a IA retornou formato antigo (sem itens), converte
    if (!parsed.itens) {
      parsed.itens = [{
        codigo_material: parsed.codigo_material || '',
        descricao_material: parsed.descricao_material || parsed.descricao || '',
        lote: parsed.lote ? String(parsed.lote).replace(/\D/g,'').substring(0, loteDigitos) : '',
        volume_kg: parsed.volume_kg || 0,
        valor_unitario: parsed.valor_unitario || 0,
      }]
    }

    // Normaliza lotes de todos os itens
    parsed.itens = parsed.itens.map(item => ({
      ...item,
      descricao_material: item.descricao_material || item.descricao || '',
      lote: item.lote ? String(item.lote).replace(/\D/g,'').substring(0, loteDigitos) : '',
    }))

    return res.status(200).json(parsed)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
