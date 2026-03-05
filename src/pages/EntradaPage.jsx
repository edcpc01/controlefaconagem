import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listarNFsEntrada, criarNFEntrada, deletarNFEntrada } from '../lib/faconagem'
import { useAuth } from '../lib/AuthContext'
import { format } from 'date-fns'

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
  data_emissao: '',
  numero_nf: '',
  codigo_material: '',
  lote: '',
  volume_kg: '',
  valor_unitario: '',
}

export default function EntradaPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [nfs, setNfs] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [toasts, setToasts] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(null)

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }

  const load = () => {
    setLoadingList(true)
    listarNFsEntrada().then(setNfs).catch(e => toast(e.message, 'error')).finally(() => setLoadingList(false))
  }

  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.data_emissao || !form.numero_nf || !form.codigo_material || !form.lote || !form.volume_kg || !form.valor_unitario) {
      toast('Preencha todos os campos.', 'error'); return
    }
    setLoading(true)
    try {
      await criarNFEntrada({
        data_emissao: form.data_emissao,
        numero_nf: form.numero_nf.trim(),
        codigo_material: form.codigo_material.trim(),
        lote: form.lote.trim(),
        volume_kg: parseFloat(form.volume_kg),
        valor_unitario: parseFloat(form.valor_unitario),
      }, user)
      toast('NF cadastrada com sucesso!')
      setForm(EMPTY_FORM)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao cadastrar NF.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deletarNFEntrada(id, confirmDelete.numero_nf, user)
      toast('NF removida.')
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
    setConfirmDelete(null)
  }

  const fmt = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  const fmtCurrency = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 6 })

  return (
    <div>
      <div className="page-header">
        <div className="page-title"><span>↓</span> NF de Entrada</div>
        <div className="page-sub">Cadastro de notas fiscais de entrada de material</div>
      </div>

      {/* Formulário */}
      <div className="card" style={{marginBottom:24}}>
        <div className="card-title">Nova NF de Entrada</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Data de Emissão *</label>
            <input type="date" className="form-input" value={form.data_emissao} onChange={e => set('data_emissao', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Número da NF *</label>
            <input type="text" className="form-input" placeholder="Ex: 98565" value={form.numero_nf} onChange={e => set('numero_nf', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Código do Material *</label>
            <input type="text" className="form-input" placeholder="Ex: 140911" value={form.codigo_material} onChange={e => set('codigo_material', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Lote *</label>
            <input type="text" className="form-input" placeholder="Ex: 4527" value={form.lote} onChange={e => set('lote', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Volume (kg) *</label>
            <input type="number" step="0.0001" min="0" className="form-input" placeholder="0,0000" value={form.volume_kg} onChange={e => set('volume_kg', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Valor Unitário (R$) *</label>
            <input type="number" step="0.000001" min="0" className="form-input" placeholder="0,000000" value={form.valor_unitario} onChange={e => set('valor_unitario', e.target.value)} />
          </div>
        </div>

        {form.volume_kg && form.valor_unitario && (
          <div className="abatimento-box" style={{marginTop:16}}>
            <div className="abatimento-row">
              <span className="abatimento-label">Valor Total</span>
              <span className="abatimento-value highlight">
                R$ {(parseFloat(form.volume_kg || 0) * parseFloat(form.valor_unitario || 0)).toLocaleString('pt-BR', {minimumFractionDigits:2})}
              </span>
            </div>
          </div>
        )}

        <div style={{display:'flex', justifyContent:'flex-end', marginTop:20}}>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando...' : '+ Cadastrar NF'}
          </button>
        </div>
      </div>

      {/* Lista de NFs */}
      <div className="card">
        <div className="card-title">NFs Cadastradas</div>
        {loadingList ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>NF</th>
                  <th>Emissão</th>
                  <th>Cód. Material</th>
                  <th>Lote</th>
                  <th className="td-right">Volume Total (kg)</th>
                  <th className="td-right">Saldo (kg)</th>
                  <th className="td-right">V. Unitário</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {nfs.length === 0 && (
                  <tr><td colSpan={8}><div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Nenhuma NF cadastrada ainda</div></div></td></tr>
                )}
                {nfs.map(nf => (
                  <tr key={nf.id}>
                    <td className="td-mono" style={{fontWeight:600}}>{nf.numero_nf}</td>
                    <td>{format(new Date(nf.data_emissao), 'dd/MM/yyyy')}</td>
                    <td>{nf.codigo_material}</td>
                    <td>{nf.lote}</td>
                    <td className="td-right td-mono">{fmt(nf.volume_kg)}</td>
                    <td className="td-right td-mono" style={{color: Number(nf.volume_saldo_kg) <= 0.01 ? 'var(--danger)' : 'var(--accent-2)', fontWeight:600}}>
                      {fmt(nf.volume_saldo_kg)}
                    </td>
                    <td className="td-right td-mono">{fmtCurrency(nf.valor_unitario)}</td>
                    <td style={{display:'flex', gap:6}}>
                      <button className="btn btn-ghost btn-sm" title="Ver detalhes" onClick={() => navigate(`/nf/${nf.id}`)}>🔍</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(nf)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal confirma delete */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">⚠ Confirmar remoção</div>
            <p style={{color:'var(--text-dim)', fontSize:14}}>
              Deseja remover a NF <strong style={{color:'var(--text)'}}>{confirmDelete.numero_nf}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete.id)}>Remover</button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  )
}
