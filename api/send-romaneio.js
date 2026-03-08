export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY não configurada no Vercel.' })

  const { emailDestino, nomeUsuario, romaneios } = req.body
  // romaneios: [{ romaneio_microdata, tipo_saida, lote_poy, volume_liquido_kg, volume_abatido_kg, codigo_material, pdfBase64 }]

  if (!emailDestino || !romaneios?.length) {
    return res.status(400).json({ error: 'emailDestino e romaneios são obrigatórios.' })
  }

  const fmt = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const tipoMap = {
    faturamento: 'Faturamento',
    dev_qualidade: 'Devolução Qualidade',
    dev_processo: 'Devolução Processo',
    dev_final_campanha: 'Devolução Final de Campanha',
    sucata: 'Sucata',
    estopa: 'Estopa',
  }

  const totalKg = romaneios.reduce((a, r) => a + Number(r.volume_abatido_kg || 0), 0)
  const isLote  = romaneios.length > 1
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  // ── Corpo do e-mail HTML ────────────────────────────────
  const linhasTabela = romaneios.map(r => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e8edf5;font-family:monospace;font-weight:600;">${r.romaneio_microdata}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8edf5;">${r.codigo_material || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8edf5;">${r.lote_poy || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8edf5;">${tipoMap[r.tipo_saida] || r.tipo_saida}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8edf5;text-align:right;font-family:monospace;">${fmt(r.volume_liquido_kg)} kg</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8edf5;text-align:right;font-family:monospace;font-weight:700;color:#1a6aff;">${fmt(r.volume_abatido_kg)} kg</td>
    </tr>`).join('')

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f4fa;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4fa;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#0f2850;padding:28px 32px;">
          <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:0.5px;">⬡ Façonagem Rhodia</div>
          <div style="color:#7db3ff;font-size:13px;margin-top:4px;">Sistema de Controle de Façonagem</div>
        </td></tr>

        <!-- Título -->
        <tr><td style="padding:28px 32px 8px;">
          <h2 style="margin:0;color:#0f2850;font-size:18px;">
            ${isLote ? `📦 Lote com ${romaneios.length} Romaneios Gerado` : '📄 Romaneio de Saída Gerado'}
          </h2>
          <p style="margin:8px 0 0;color:#666;font-size:13px;">
            Olá${nomeUsuario ? ', ' + nomeUsuario.split('@')[0] : ''}! 
            ${isLote
              ? `Segue em anexo os ${romaneios.length} PDFs dos romaneios registrados.`
              : 'Segue em anexo o PDF do romaneio registrado.'}
          </p>
          <p style="margin:4px 0 0;color:#999;font-size:12px;">Emitido em: ${dataHora}</p>
        </td></tr>

        <!-- Resumo total (lote) -->
        ${isLote ? `
        <tr><td style="padding:8px 32px;">
          <div style="background:#f0f7ff;border-radius:8px;padding:14px 18px;display:flex;align-items:center;gap:16px;">
            <div>
              <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Total Debitado</div>
              <div style="font-size:22px;font-weight:700;color:#1a6aff;">${fmt(totalKg)} kg</div>
            </div>
            <div style="margin-left:24px;">
              <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Romaneios</div>
              <div style="font-size:22px;font-weight:700;color:#0f2850;">${romaneios.length}</div>
            </div>
          </div>
        </td></tr>` : ''}

        <!-- Tabela -->
        <tr><td style="padding:16px 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e8edf5;">
            <thead>
              <tr style="background:#0f2850;">
                <th style="padding:10px 12px;text-align:left;color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;">Romaneio</th>
                <th style="padding:10px 12px;text-align:left;color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;">Cód.</th>
                <th style="padding:10px 12px;text-align:left;color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;">Lote POY</th>
                <th style="padding:10px 12px;text-align:left;color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;">Tipo</th>
                <th style="padding:10px 12px;text-align:right;color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;">Vol. Líq.</th>
                <th style="padding:10px 12px;text-align:right;color:#fff;font-size:11px;font-weight:600;text-transform:uppercase;">Vol. Final</th>
              </tr>
            </thead>
            <tbody>${linhasTabela}</tbody>
            <tfoot>
              <tr style="background:#f0f4fa;">
                <td colspan="5" style="padding:10px 12px;font-weight:700;font-size:13px;color:#0f2850;">TOTAL</td>
                <td style="padding:10px 12px;text-align:right;font-weight:700;font-family:monospace;font-size:14px;color:#1a6aff;">${fmt(totalKg)} kg</td>
              </tr>
            </tfoot>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8faff;padding:16px 32px;border-top:1px solid #e8edf5;">
          <p style="margin:0;font-size:11px;color:#999;">
            Este e-mail foi gerado automaticamente pelo sistema de controle de façonagem da Rhodia.<br>
            ${isLote ? `${romaneios.length} PDF${romaneios.length > 1 ? 's' : ''} em anexo.` : '1 PDF em anexo.'}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  // ── Anexos ──────────────────────────────────────────────
  const attachments = romaneios.map(r => ({
    filename: `romaneio_${r.romaneio_microdata}.pdf`,
    content:  r.pdfBase64,
    type:     'application/pdf',
    disposition: 'attachment',
  }))

  // ── Envia via Resend ─────────────────────────────────────
  const payload = {
    from:    'Façonagem Rhodia <noreply@faconagem.rhodia.com.br>',
    to:      [emailDestino],
    subject: isLote
      ? `📦 Lote de ${romaneios.length} Romaneios — ${fmt(totalKg)} kg`
      : `📄 Romaneio ${romaneios[0].romaneio_microdata} — ${fmt(totalKg)} kg`,
    html:        htmlBody,
    attachments,
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  const resendData = await resendRes.json()

  if (!resendRes.ok) {
    console.error('Resend error:', resendData)
    return res.status(500).json({ error: resendData.message || 'Erro ao enviar e-mail.' })
  }

  return res.status(200).json({ ok: true, id: resendData.id })
}
