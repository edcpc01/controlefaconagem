import { useEffect, useState } from 'react'
import {
  listarSaidas, criarSaida, listarNFsEntrada,
  TIPOS_SAIDA, TIPOS_COM_ABATIMENTO, PERCENTUAL_ABATIMENTO,
  calcularVolumeAbatido, gerarRomaneioPDF
} from '../lib/faconagem'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
      ))}
    </div>
  )
}

const EMPTY_FORM = {
  romaneio_microdata: '',
  codigo_produto: '',
  lote_produto: '',
  tipo_saida: '',
  volume_bruto_kg: '',
}

function tipoBadge(tipo) {
  const map = { faturamento:'badge-blue', sucata:'badge-danger', estopa:'badge-warn', dev_qualidade:'badge-green', dev_processo:'badge-green', dev_final_campanha:'badge-green' }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

function fmt(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export default function SaidaPage() {
  const [saidas, setSaidas] = useState([])
  const [nfs, setNfs] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [toasts, setToasts] = useState([])
  const [ultimaSaida, setUltimaSaida] = useState(null) // { saida, alocacoes }

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  const load = () => {
    setLoadingList(true)
    Promise.all([listarSaidas(), listarNFsEntrada()])
      .then(([s, n]) => { setSaidas(s); setNfs(n) })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoadingList(false))
  }

  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const volumeBruto = parseFloat(form.volume_bruto_kg) || 0
  const temAbatimento = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
  const volumeAbatido = calcularVolumeAbatido(volumeBruto, form.tipo_saida)
  const valorAbatimento = volumeBruto - volumeAbatido

  // Preview FIFO simulado
  const totalSaldo = nfs.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
  const saldoInsuficiente = volumeAbatido > totalSaldo + 0.01

  const handleSubmit = async () => {
    if (!form.romaneio_microdata || !form.codigo_produto || !form.lote_produto || !form.tipo_saida || !form.volume_bruto_kg) {
      toast('Preencha todos os campos.', 'error'); return
    }
    if (saldoInsuficiente) {
      toast(`Saldo insuficiente! Disponível: ${fmt(totalSaldo)} kg`, 'error'); return
    }
    setLoading(true)
    try {
      const resultado = await criarSaida({
        romaneio_microdata: form.romaneio_microdata.trim(),
        codigo_produto: form.codigo_produto.trim(),
        lote_produto: form.lote_produto.trim(),
        tipo_saida: form.tipo_saida,
        volume_bruto_kg: volumeBruto,
      })
      toast('Saída registrada com sucesso!')
      setUltimaSaida(resultado)
      setForm(EMPTY_FORM)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao registrar saída.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleGerarPDF = (saida, alocacoes) => {
    gerarRomaneioPDF(saida, alocacoes)
    toast('Romaneio PDF gerado!')
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title"><span>↑</span> Saída de Material</div>
        <div className="page-sub">Registro de saídas com abatimento e alocação FIFO nas NFs de entrada</div>
      </div>

      {/* Formulário */}
      <div className="card" style={{marginBottom:24}}>
        <div className="card-title">Registrar Nova Saída</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Romaneio Microdata *</label>
            <input type="text" className="form-input" placeholder="Ex: 122041" value={form.romaneio_microdata} onChange={e => set('romaneio_microdata', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Código do Produto *</label>
            <input type="text" className="form-input" placeholder="Ex: 140911" value={form.codigo_produto} onChange={e => set('codigo_produto', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Lote do Produto *</label>
            <input type="text" className="form-input" placeholder="Ex: 4527" value={form.lote_produto} onChange={e => set('lote_produto', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Tipo de Saída *</label>
            <select className="form-select" value={form.tipo_saida} onChange={e => set('tipo_saida', e.target.value)}>
              <option value="">Selecione o tipo...</option>
              {TIPOS_SAIDA.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Volume Bruto (kg) *</label>
            <input type="number" step="0.0001" min="0" className="form-input" placeholder="0,0000" value={form.volume_bruto_kg} onChange={e => set('volume_bruto_kg', e.target.value)} />
          </div>
        </div>

        {/* Preview abatimento */}
        {volumeBruto > 0 && form.tipo_saida && (
          <div className="abatimento-box" style={{marginTop:16}}>
            <div className="abatimento-row">
              <span className="abatimento-label">Volume Bruto Informado</span>
              <span className="abatimento-value">{fmt(volumeBruto)} kg</span>
            </div>
            {temAbatimento && (
              <>
                <div className="abatimento-row">
                  <span className="abatimento-label">
                    Abatimento 1,5% <span className="abatimento-badge">{TIPOS_SAIDA.find(t=>t.value===form.tipo_saida)?.label}</span>
                  </span>
                  <span className="abatimento-value" style={{color:'var(--warn)'}}>− {fmt(valorAbatimento)} kg</span>
                </div>
                <hr className="divider" style={{margin:'8px 0'}} />
              </>
            )}
            <div className="abatimento-row">
              <span className="abatimento-label" style={{fontWeight:700}}>
                {temAbatimento ? 'Volume Final (com abatimento)' : 'Volume Final (sem abatimento)'}
              </span>
              <span className="abatimento-value highlight">{fmt(volumeAbatido)} kg</span>
            </div>
            {saldoInsuficiente && (
              <div style={{marginTop:10, padding:'8px 12px', background:'rgba(255,77,109,0.1)', borderRadius:6, color:'var(--danger)', fontSize:12}}>
                ⚠ Saldo insuficiente nas NFs de entrada. Saldo disponível: <strong>{fmt(totalSaldo)} kg</strong>
              </div>
            )}
          </div>
        )}

        <div style={{display:'flex', justifyContent:'flex-end', marginTop:20}}>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || saldoInsuficiente}>
            {loading ? 'Processando...' : '+ Registrar Saída'}
          </button>
        </div>
      </div>

      {/* Modal de sucesso com opção de romaneio */}
      {ultimaSaida && (
        <div className="modal-overlay" onClick={() => setUltimaSaida(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{color:'var(--accent-2)'}}>✓ Saída Registrada!</div>

            <div className="abatimento-box" style={{marginBottom:16}}>
              <div className="abatimento-row">
                <span className="abatimento-label">Romaneio Microdata</span>
                <span className="abatimento-value">{ultimaSaida.saida.romaneio_microdata}</span>
              </div>
              <div className="abatimento-row">
                <span className="abatimento-label">Tipo</span>
                <span>{tipoBadge(ultimaSaida.saida.tipo_saida)}</span>
              </div>
              <div className="abatimento-row">
                <span className="abatimento-label">Volume Bruto</span>
                <span className="abatimento-value">{fmt(ultimaSaida.saida.volume_bruto_kg)} kg</span>
              </div>
              <div className="abatimento-row">
                <span className="abatimento-label">Volume Final</span>
                <span className="abatimento-value highlight">{fmt(ultimaSaida.saida.volume_abatido_kg)} kg</span>
              </div>
            </div>

            <div className="section-title" style={{fontSize:13}}>Alocações FIFO</div>
            <div className="table-wrap" style={{marginBottom:16}}>
              <table>
                <thead><tr><th>NF</th><th>Emissão</th><th className="td-right">Abatido (kg)</th></tr></thead>
                <tbody>
                  {ultimaSaida.alocacoes.map((a, i) => (
                    <tr key={i}>
                      <td className="td-mono">{a.numero_nf}</td>
                      <td>{format(new Date(a.data_emissao), 'dd/MM/yyyy')}</td>
                      <td className="td-right td-mono">{fmt(a.volume_alocado_kg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setUltimaSaida(null)}>Fechar</button>
              <button className="btn btn-success" onClick={() => handleGerarPDF(ultimaSaida.saida, ultimaSaida.alocacoes)}>
                📄 Gerar Romaneio PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista de saídas */}
      <div className="card">
        <div className="card-title">Histórico de Saídas</div>
        {loadingList ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Romaneio</th>
                  <th>Cód. Produto</th>
                  <th>Lote</th>
                  <th>Tipo</th>
                  <th className="td-right">Bruto (kg)</th>
                  <th className="td-right">Final (kg)</th>
                  <th>Data</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {saidas.length === 0 && (
                  <tr><td colSpan={8}><div className="empty"><div className="empty-icon">📋</div><div className="empty-text">Nenhuma saída registrada ainda</div></div></td></tr>
                )}
                {saidas.map(s => (
                  <tr key={s.id}>
                    <td className="td-mono" style={{fontWeight:600}}>{s.romaneio_microdata}</td>
                    <td>{s.codigo_produto}</td>
                    <td>{s.lote_produto}</td>
                    <td>{tipoBadge(s.tipo_saida)}</td>
                    <td className="td-right td-mono">{fmt(s.volume_bruto_kg)}</td>
                    <td className="td-right td-mono" style={{color:'var(--accent)', fontWeight:600}}>{fmt(s.volume_abatido_kg)}</td>
                    <td style={{fontSize:12, color:'var(--text-dim)'}}>
                      {format(new Date(s.criado_em), 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Gerar Romaneio PDF"
                        onClick={() => handleGerarPDF(s, s.alocacao_saida || [])}
                      >📄</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Toast toasts={toasts} />
    </div>
  )
}
