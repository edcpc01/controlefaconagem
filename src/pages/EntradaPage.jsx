import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listarNFsEntrada, criarNFEntrada, editarNFEntrada, deletarNFEntrada, extrairDadosNFdoPDF, verificarNFDuplicada } from '../lib/faconagem'
import { useAuth } from '../lib/AuthContext'
import { useUser } from '../lib/UserContext'
import { format } from 'date-fns'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

const EMPTY_FORM = { data_emissao: '', numero_nf: '', codigo_material: '', lote: '', volume_kg: '', valor_unitario: '' }

const fmt        = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const fmtCurrency = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 6 })

// ── Formulário reutilizável (criar + editar) ──────────────────────
function NFForm({ form, set, onSubmit, onCancel, loading, extracting, onPDFUpload, pdfInputRef, isEdit }) {
  return (
    <div>
      {/* Upload PDF */}
      {!isEdit && (
        <div
          className="pdf-dropzone"
          onClick={() => pdfInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
          onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
          onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) onPDFUpload(f) }}
        >
          <input ref={pdfInputRef} type="file" accept="application/pdf" style={{display:'none'}} onChange={e => e.target.files[0] && onPDFUpload(e.target.files[0])} />
          {extracting ? (
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <div className="spinner" style={{width:20, height:20, marginBottom:0}} />
              <span style={{color:'var(--accent)', fontSize:13}}>Extraindo dados da NF...</span>
            </div>
          ) : (
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:28, marginBottom:4}}>📄</div>
              <div style={{fontSize:13, color:'var(--text)', fontWeight:600}}>Importar PDF da NF</div>
              <div style={{fontSize:11, color:'var(--text-dim)', marginTop:2}}>Clique ou arraste o arquivo PDF para preencher automaticamente</div>
            </div>
          )}
        </div>
      )}

      <div className="form-grid" style={{marginTop: isEdit ? 0 : 16}}>
        <div className="form-group">
          <label className="form-label">Data de Emissão *</label>
          <input type="date" className="form-input" value={form.data_emissao} onChange={e => set('data_emissao', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Número da NF *</label>
          <input type="text" className="form-input" placeholder="Ex: 99733" value={form.numero_nf} onChange={e => set('numero_nf', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Código do Material *</label>
          <input type="text" className="form-input" placeholder="Ex: 140911" value={form.codigo_material} onChange={e => set('codigo_material', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Lote POY *</label>
          <input type="text" className="form-input" placeholder="Ex: 53274S" value={form.lote} onChange={e => set('lote', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Volume (kg) *</label>
          <input type="number" step="0.001" min="0" className="form-input" placeholder="0,000" value={form.volume_kg} onChange={e => set('volume_kg', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Valor Unitário (R$) *</label>
          <input type="number" step="0.000001" min="0" className="form-input" placeholder="0,000000" value={form.valor_unitario} onChange={e => set('valor_unitario', e.target.value)} />
        </div>
      </div>

      {form.volume_kg && form.valor_unitario && (
        <div className="abatimento-box" style={{marginTop:16}}>
          <div className="abatimento-row">
            <span className="abatimento-label">Valor Total da NF</span>
            <span className="abatimento-value highlight">
              R$ {(parseFloat(form.volume_kg || 0) * parseFloat(form.valor_unitario || 0)).toLocaleString('pt-BR', {minimumFractionDigits:2})}
            </span>
          </div>
        </div>
      )}

      <div style={{display:'flex', justifyContent:'flex-end', gap:10, marginTop:20}}>
        {onCancel && <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>}
        <button className="btn btn-primary" onClick={onSubmit} disabled={loading}>
          {loading ? 'Salvando...' : isEdit ? '✓ Salvar Alterações' : '+ Cadastrar NF'}
        </button>
      </div>
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────
export default function EntradaPage() {
  const { user }   = useAuth()
  const { unidadeAtiva } = useUser() || {}
  const navigate   = useNavigate()
  const pdfRef     = useRef()
  const [nfs, setNfs]                 = useState([])
  const [form, setForm]               = useState(EMPTY_FORM)
  const [loading, setLoading]         = useState(false)
  const [extracting, setExtracting]   = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [toasts, setToasts]           = useState([])
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editando, setEditando]       = useState(null)
  const [editForm, setEditForm]       = useState(EMPTY_FORM)
  const [editLoading, setEditLoading] = useState(false)

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }

  const load = () => {
    setLoadingList(true)
    listarNFsEntrada(unidadeAtiva || '').then(setNfs).catch(e => toast(e.message, 'error')).finally(() => setLoadingList(false))
  }

  useEffect(() => { load() }, [unidadeAtiva])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setEdit = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  // ── PDF Upload + Extração ──
  const handlePDFUpload = async (file) => {
    setExtracting(true)
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = () => rej(new Error('Erro ao ler arquivo'))
        r.readAsDataURL(file)
      })
      const dados = await extrairDadosNFdoPDF(base64)
      setForm({
        data_emissao:    dados.data_emissao   || '',
        numero_nf:       dados.numero_nf      || '',
        codigo_material: dados.codigo_material || '',
        lote:            dados.lote           || '',
        volume_kg:       dados.volume_kg      != null ? String(dados.volume_kg) : '',
        valor_unitario:  dados.valor_unitario != null ? String(dados.valor_unitario) : '',
      })
      toast('Dados extraídos com sucesso! Confira os campos.')
    } catch (e) {
      const msg = e.message?.includes('ANTHROPIC_API_KEY')
        ? '⚠ Chave da API não configurada na Vercel. Consulte o README.'
        : 'Erro ao extrair dados do PDF. Preencha manualmente.'
      toast(msg, 'error')
    } finally {
      setExtracting(false)
      if (pdfRef.current) pdfRef.current.value = ''
    }
  }

  // ── Criar NF ──
  const handleSubmit = async () => {
    if (!form.data_emissao || !form.numero_nf || !form.codigo_material || !form.lote || !form.volume_kg || !form.valor_unitario) {
      toast('Preencha todos os campos obrigatórios.', 'error'); return
    }
    setLoading(true)
    try {
      // Trava duplicata — verifica em TODAS as unidades
      const duplicata = await verificarNFDuplicada(form.numero_nf.trim())
      if (duplicata) {
        toast(`NF ${form.numero_nf} já está cadastrada no sistema. Números de NF são únicos em todas as unidades.`, 'error')
        setLoading(false); return
      }
      await criarNFEntrada({
        data_emissao:    form.data_emissao,
        numero_nf:       form.numero_nf.trim(),
        codigo_material: form.codigo_material.trim(),
        lote:            form.lote.trim(),
        volume_kg:       parseFloat(form.volume_kg),
        valor_unitario:  parseFloat(form.valor_unitario),
        unidade_id:      unidadeAtiva || '',
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

  // ── Editar NF ──
  const abrirEditar = (nf) => {
    setEditando(nf)
    setEditForm({
      data_emissao:    nf.data_emissao || '',
      numero_nf:       nf.numero_nf || '',
      codigo_material: nf.codigo_material || '',
      lote:            nf.lote || '',
      volume_kg:       String(nf.volume_kg || ''),
      valor_unitario:  String(nf.valor_unitario || ''),
    })
  }

  const handleEditar = async () => {
    if (!editForm.data_emissao || !editForm.numero_nf || !editForm.codigo_material || !editForm.lote || !editForm.volume_kg || !editForm.valor_unitario) {
      toast('Preencha todos os campos.', 'error'); return
    }
    setEditLoading(true)
    try {
      await editarNFEntrada(editando.id, {
        data_emissao:    editForm.data_emissao,
        numero_nf:       editForm.numero_nf.trim(),
        codigo_material: editForm.codigo_material.trim(),
        lote:            editForm.lote.trim(),
        volume_kg:       parseFloat(editForm.volume_kg),
        valor_unitario:  parseFloat(editForm.valor_unitario),
        unidade_id:      editando.unidade_id || unidadeAtiva || '',
      }, user)
      toast('NF atualizada!')
      setEditando(null)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao editar NF.', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  // ── Deletar NF ──
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

  return (
    <div>
      <div className="page-header">
        <div className="page-title"><span>↓</span> NF de Entrada</div>
        <div className="page-sub">Cadastro de notas fiscais de entrada — importe o PDF para preenchimento automático</div>
      </div>

      {/* Formulário de cadastro */}
      <div className="card" style={{marginBottom:24}}>
        <div className="card-title">Nova NF de Entrada</div>
        <NFForm
          form={form} set={set}
          onSubmit={handleSubmit}
          loading={loading}
          extracting={extracting}
          onPDFUpload={handlePDFUpload}
          pdfInputRef={pdfRef}
          isEdit={false}
        />
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
                  <th>Lote POY</th>
                  <th className="td-right">Volume (kg)</th>
                  <th className="td-right">Saldo (kg)</th>
                  <th className="td-right">V. Unitário</th>
                  <th style={{width:100}}></th>
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
                    <td>
                      <div style={{display:'flex', gap:4}}>
                        <button className="btn btn-ghost btn-sm" title="Ver detalhes" onClick={() => navigate(`/nf/${nf.id}`)}>🔍</button>
                        <button className="btn btn-ghost btn-sm" title="Editar" onClick={() => abrirEditar(nf)}>✏</button>
                        <button className="btn btn-danger btn-sm" title="Remover" onClick={() => setConfirmDelete(nf)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Edição */}
      {editando && (
        <div className="modal-overlay" onClick={() => setEditando(null)}>
          <div className="modal" style={{maxWidth:640}} onClick={e => e.stopPropagation()}>
            <div className="modal-title">✏ Editar NF {editando.numero_nf}</div>
            <NFForm
              form={editForm} set={setEdit}
              onSubmit={handleEditar}
              onCancel={() => setEditando(null)}
              loading={editLoading}
              isEdit={true}
            />
          </div>
        </div>
      )}

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
