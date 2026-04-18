import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listarNFsEntrada, criarNFEntrada, criarNFsEntradaLote,
  editarNFEntrada, deletarNFEntrada, extrairDadosNFdoPDF,
  verificarNFDuplicada, statusVencimentoNF, diasParaVencimento
} from '../lib/faconagem'
import { useAuth } from '../lib/AuthContext'
import { useUser } from '../lib/UserContext'
import { useOperacao } from '../lib/OperacaoContext'
import { format } from 'date-fns'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

const EMPTY_FORM = { data_emissao: '', numero_nf: '', codigo_material: '', descricao_material: '', lote: '', volume_kg: '', valor_unitario: '' }
const fmt         = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtCurrency = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 6 })

// ── Formulário reutilizável ───────────────────────────────────────
function NFForm({ form, set, onSubmit, onCancel, loading, extracting, onPDFUpload, pdfInputRef, isEdit }) {
  return (
    <div>
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
              <div style={{fontSize:11, color:'var(--text-dim)', marginTop:2}}>Clique ou arraste — suporta NFs com múltiplos itens</div>
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
          <label className="form-label">Descrição do Material</label>
          <input type="text" className="form-input" placeholder="Ex: POY, Tubete..." value={form.descricao_material} onChange={e => set('descricao_material', e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Lote POY</label>
          <input type="text" className="form-input" placeholder="Ex: 37553" value={form.lote} onChange={e => set('lote', e.target.value)} />
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
              R$ {(parseFloat(form.volume_kg||0)*parseFloat(form.valor_unitario||0)).toLocaleString('pt-BR',{minimumFractionDigits:2})}
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


// ── Painel de revisão multi-item (PDF ou manual) ──────────────────
function PainelMultiItem({ itens, onSalvar, onCancelar, loading, initialNF, initialData }) {
  const [linhas,  setLinhas]  = useState(itens.map((item, i) => ({ ...item, _id: i, incluir: true })))
  const [cabNF,   setCabNF]   = useState(initialNF   || '')
  const [cabData, setCabData] = useState(initialData || '')
  const nextId = useRef(itens.length)

  const setLinha = (id, campo, valor) =>
    setLinhas(ls => ls.map(l => l._id === id ? {...l, [campo]: valor} : l))
  const addLinha = () =>
    setLinhas(ls => [...ls, { _id: nextId.current++, incluir:true, codigo_material:'', descricao_material:'', lote:'', volume_kg:'', valor_unitario:'' }])
  const removeLinha = (id) => setLinhas(ls => ls.filter(l => l._id !== id))

  const totalVol = linhas.filter(l=>l.incluir).reduce((a,l) => a + (parseFloat(l.volume_kg)||0), 0)
  const totalVal = linhas.filter(l=>l.incluir).reduce((a,l) => a + (parseFloat(l.volume_kg)||0)*(parseFloat(l.valor_unitario)||0), 0)

  const handleSalvar = () => {
    if (!cabNF.trim())  { alert('Informe o número da NF.'); return }
    if (!cabData)       { alert('Informe a data de emissão.'); return }
    const ativas = linhas.filter(l => l.incluir)
    if (ativas.some(l => !l.codigo_material.trim())) { alert('Preencha o código do material em todas as linhas.'); return }
    onSalvar(ativas, cabNF.trim(), cabData)
  }

  return (
    <div className="card" style={{marginBottom:24, borderColor:'var(--accent)'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10}}>
        <div className="card-title" style={{margin:0}}>📋 NF com múltiplos materiais</div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn btn-ghost btn-sm" onClick={onCancelar}>✕ Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={handleSalvar}
            disabled={loading || linhas.filter(l=>l.incluir).length === 0}>
            {loading ? '⏳ Salvando...' : `💾 Salvar ${linhas.filter(l=>l.incluir).length} item${linhas.filter(l=>l.incluir).length!==1?'s':''}`}
          </button>
        </div>
      </div>

      {/* Cabeçalho NF */}
      <div style={{display:'flex', gap:12, marginBottom:16, flexWrap:'wrap'}}>
        <div className="form-group" style={{margin:0, flex:'1 1 160px'}}>
          <label className="form-label">Número da NF *</label>
          <input className="form-input" placeholder="Ex: 100394"
            value={cabNF} onChange={e => setCabNF(e.target.value)} />
        </div>
        <div className="form-group" style={{margin:0, flex:'1 1 160px'}}>
          <label className="form-label">Data de Emissão *</label>
          <input type="date" className="form-input"
            value={cabData} onChange={e => setCabData(e.target.value)} />
        </div>
        <div style={{flex:'2 1 200px', display:'flex', alignItems:'flex-end', paddingBottom:2}}>
          <div style={{fontSize:12, color:'var(--text-dim)'}}>
            Todos os itens usarão o mesmo número de NF e data. Revise antes de salvar.
          </div>
        </div>
      </div>

      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
          <thead>
            <tr style={{background:'rgba(255,255,255,0.04)'}}>
              <th style={{padding:'8px 10px', width:36, textAlign:'center'}}>
                <input type="checkbox" checked={linhas.every(l=>l.incluir)}
                  onChange={e => setLinhas(ls => ls.map(l => ({...l, incluir: e.target.checked})))} />
              </th>
              <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>Cód. Material *</th>
              <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>Descrição</th>
              <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>Lote POY</th>
              <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Volume (kg) *</th>
              <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Valor Unit. (R$) *</th>
              <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Total (R$)</th>
              <th style={{padding:'8px 10px', width:36}}></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => (
              <tr key={l._id} style={{borderBottom:'1px solid rgba(255,255,255,0.05)', opacity: l.incluir ? 1 : 0.4}}>
                <td style={{padding:'6px 10px', textAlign:'center'}}>
                  <input type="checkbox" checked={l.incluir} onChange={e => setLinha(l._id,'incluir',e.target.checked)} />
                </td>
                <td style={{padding:'6px 10px'}}>
                  <input className="form-input" style={{width:120, fontFamily:'monospace'}}
                    placeholder="Ex: 140911"
                    value={l.codigo_material} onChange={e => setLinha(l._id,'codigo_material',e.target.value)} />
                </td>
                <td style={{padding:'6px 10px'}}>
                  <input className="form-input" style={{width:150}}
                    placeholder="Descrição"
                    value={l.descricao_material} onChange={e => setLinha(l._id,'descricao_material',e.target.value)} />
                </td>
                <td style={{padding:'6px 10px'}}>
                  <input className="form-input" style={{width:90, fontFamily:'monospace'}}
                    placeholder="Ex: 37553" value={l.lote}
                    onChange={e => setLinha(l._id,'lote',e.target.value)} />
                </td>
                <td style={{padding:'6px 10px'}}>
                  <input className="form-input" type="number" step="0.001"
                    style={{width:110, textAlign:'right', fontFamily:'monospace'}}
                    placeholder="0,000"
                    value={l.volume_kg} onChange={e => setLinha(l._id,'volume_kg',e.target.value)} />
                </td>
                <td style={{padding:'6px 10px'}}>
                  <input className="form-input" type="number" step="0.000001"
                    style={{width:120, textAlign:'right', fontFamily:'monospace'}}
                    placeholder="0,000000"
                    value={l.valor_unitario} onChange={e => setLinha(l._id,'valor_unitario',e.target.value)} />
                </td>
                <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', color:'var(--accent)', fontWeight:600}}>
                  {((parseFloat(l.volume_kg)||0)*(parseFloat(l.valor_unitario)||0)).toLocaleString('pt-BR',{minimumFractionDigits:2})}
                </td>
                <td style={{padding:'6px 10px', textAlign:'center'}}>
                  {linhas.length > 1 && (
                    <button onClick={() => removeLinha(l._id)}
                      style={{background:'none', border:'none', cursor:'pointer', color:'var(--danger)', fontSize:16, padding:0}}
                      title="Remover linha">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{borderTop:'2px solid var(--border)', background:'rgba(255,255,255,0.03)'}}>
              <td colSpan={4} style={{padding:'8px 10px'}}>
                <button className="btn btn-ghost btn-sm" onClick={addLinha} style={{fontSize:12}}>
                  + Adicionar material
                </button>
              </td>
              <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--accent-2)'}}>
                {totalVol.toLocaleString('pt-BR',{minimumFractionDigits:3})} kg
              </td>
              <td />
              <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--accent)'}}>
                R$ {totalVal.toLocaleString('pt-BR',{minimumFractionDigits:2})}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Página Principal ─────────────────────────────────────────────
export default function EntradaPage() {
  const { user }   = useAuth()
  const { unidadeAtiva, isSupervisor } = useUser() || {}
  const { colecoes, operacaoAtiva } = useOperacao() || {}
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

  // Multi-item state
  const [multiItens, setMultiItens]   = useState(null) // { numero_nf, data_emissao, itens }

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }

  const load = () => {
    setLoadingList(true)
    listarNFsEntrada(unidadeAtiva || '', colecoes).then(setNfs).catch(e => toast(e.message, 'error')).finally(() => setLoadingList(false))
  }

  useEffect(() => { load() }, [unidadeAtiva, operacaoAtiva])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setEdit = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  // ── PDF Upload + Extração ────────────────────────────────────────
  const handlePDFUpload = async (file) => {
    setExtracting(true)
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = () => rej(new Error('Erro ao ler arquivo'))
        r.readAsDataURL(file)
      })
      const dados = await extrairDadosNFdoPDF(base64, operacaoAtiva)

      if (dados.itens && dados.itens.length > 1) {
        // Multi-item: abre painel de revisão
        setMultiItens({ numero_nf: dados.numero_nf, data_emissao: dados.data_emissao, itens: dados.itens })
        toast(`✅ ${dados.itens.length} itens encontrados na NF ${dados.numero_nf}. Revise e confirme.`)
      } else {
        // Item único: preenche formulário normalmente
        const item = dados.itens?.[0] || dados
        setForm({
          data_emissao:    dados.data_emissao   || '',
          numero_nf:       dados.numero_nf      || '',
          codigo_material: item.codigo_material  || '',
          descricao_material: item.descricao_material || '',
          lote:            item.lote            || '',
          volume_kg:       item.volume_kg       != null ? String(item.volume_kg) : '',
          valor_unitario:  item.valor_unitario  != null ? String(item.valor_unitario) : '',
        })
        toast('Dados extraídos com sucesso! Confira os campos.')
      }
    } catch (e) {
      const msg = e.message?.includes('OPENROUTER_API_KEY') || e.message?.includes('ANTHROPIC_API_KEY')
        ? '⚠ Chave da API não configurada na Vercel.'
        : `Erro na extração: ${e.message}`
      toast(msg, 'error')
    } finally {
      setExtracting(false)
      if (pdfRef.current) pdfRef.current.value = ''
    }
  }

  // ── Criar NF (único item) ────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.data_emissao || !form.numero_nf || !form.codigo_material || !form.volume_kg || !form.valor_unitario) {
      toast('Preencha todos os campos obrigatórios (Lote e Descrição opcionais).', 'error'); return
    }
    setLoading(true)
    try {
      const dup = await verificarNFDuplicada(form.numero_nf.trim(), colecoes)
      if (dup) { toast(`NF ${form.numero_nf} já cadastrada!`, 'error'); return }
      await criarNFEntrada({
        data_emissao:    form.data_emissao,
        numero_nf:       form.numero_nf.trim(),
        codigo_material: form.codigo_material.trim(),
        descricao_material: form.descricao_material?.trim() || '',
        lote:            form.lote?.trim() || '',
        volume_kg:       parseFloat(form.volume_kg),
        valor_unitario:  parseFloat(form.valor_unitario),
        unidade_id:      unidadeAtiva || '',
      }, user, colecoes)
      toast('NF cadastrada com sucesso!')
      setForm(EMPTY_FORM)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao cadastrar NF.', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Salvar multi-item ────────────────────────────────────────────
  const handleSalvarMulti = async (linhas, nfNum, nfData) => {
    setLoading(true)
    try {
      const itensPayload = linhas.map(l => ({
        data_emissao:    nfData,
        numero_nf:       nfNum,
        codigo_material: l.codigo_material.trim(),
        descricao_material: l.descricao_material?.trim() || '',
        lote:            l.lote?.trim() || '',
        volume_kg:       parseFloat(l.volume_kg),
        valor_unitario:  parseFloat(l.valor_unitario),
        unidade_id:      unidadeAtiva || '',
      }))
      await criarNFsEntradaLote(itensPayload, user, colecoes)
      toast(`✅ ${linhas.length} item${linhas.length!==1?'s':''} da NF ${nfNum} cadastrado${linhas.length!==1?'s':''}!`)
      setMultiItens(null)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao cadastrar NFs.', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Editar NF ────────────────────────────────────────────────────
  const abrirEditar = (nf) => {
    setEditando(nf)
    setEditForm({
      data_emissao:    nf.data_emissao || '',
      numero_nf:       nf.numero_nf || '',
      codigo_material: nf.codigo_material || '',
      descricao_material: nf.descricao_material || '',
      lote:            nf.lote || '',
      volume_kg:       String(nf.volume_kg || ''),
      valor_unitario:  String(nf.valor_unitario || ''),
    })
  }

  const handleEditar = async () => {
    if (!editForm.data_emissao || !editForm.numero_nf || !editForm.codigo_material || !editForm.volume_kg || !editForm.valor_unitario) {
      toast('Preencha os campos obrigatórios.', 'error'); return
    }
    setEditLoading(true)
    try {
      await editarNFEntrada(editando.id, {
        data_emissao:    editForm.data_emissao,
        numero_nf:       editForm.numero_nf.trim(),
        codigo_material: editForm.codigo_material.trim(),
        descricao_material: editForm.descricao_material?.trim() || '',
        lote:            editForm.lote?.trim() || '',
        volume_kg:       parseFloat(editForm.volume_kg),
        valor_unitario:  parseFloat(editForm.valor_unitario),
        unidade_id:      editando.unidade_id || unidadeAtiva || '',
      }, user, colecoes)
      toast('NF atualizada!')
      setEditando(null)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao editar NF.', 'error')
    } finally {
      setEditLoading(false)
    }
  }

  const handleDeletar = async () => {
    if (!confirmDelete) return
    try {
      await deletarNFEntrada(confirmDelete.id, confirmDelete.numero_nf, user, colecoes)
      toast('NF removida.')
      setConfirmDelete(null)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao remover NF.', 'error')
      setConfirmDelete(null)
    }
  }

  // Alertas de vencimento
  const nfsVencendo = nfs
    .filter(nf => Number(nf.volume_saldo_kg) > 0.01 && nf.data_emissao)
    .map(nf => {
      const diasRestantes = diasParaVencimento(nf)
      return { ...nf, diasRestantes }
    })
    .filter(nf => nf.diasRestantes <= 30 && nf.diasRestantes >= 0)
    .sort((a, b) => a.diasRestantes - b.diasRestantes)

  return (
    <div>
      <div className="page-header">
        <div className="page-title"><span>↓</span> NF de Entrada</div>
        <div className="page-sub">Cadastro e controle das NFs de entrada de material</div>
      </div>

      {/* Alertas de vencimento */}
      {nfsVencendo.length > 0 && (
        <div className="card" style={{marginBottom:16, borderColor:'var(--warn)', background:'rgba(255,180,0,0.05)'}}>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10}}>
            <span style={{fontSize:18}}>⚠️</span>
            <span style={{fontWeight:700, color:'var(--warn)', fontSize:14}}>
              {nfsVencendo.length} NF{nfsVencendo.length!==1?'s':''} próxima{nfsVencendo.length!==1?'s':''} do vencimento (30 dias)
            </span>
          </div>
          {nfsVencendo.map(n => (
            <div key={n.id} style={{fontSize:12, color:'var(--text)', marginBottom:4, display:'flex', gap:8, flexWrap:'wrap'}}>
              <span className="td-mono" style={{fontWeight:600}}>NF {n.numero_nf}</span>
              <span style={{color:'var(--text-dim)'}}>Lote {n.lote}</span>
              <span style={{color: n.diasRestantes<=7?'var(--danger)':'var(--warn)', fontWeight:600}}>
                {n.diasRestantes===0?'Vence hoje!':`${n.diasRestantes} dia${n.diasRestantes!==1?'s':''} restante${n.diasRestantes!==1?'s':''}`}
              </span>
              <span style={{color:'var(--text-dim)'}}>Saldo: {Number(n.volume_saldo_kg).toLocaleString('pt-BR',{minimumFractionDigits:2})} kg</span>
            </div>
          ))}
        </div>
      )}

      {/* Painel multi-item (quando PDF tem vários produtos) */}
      {!isSupervisor && multiItens && (
        <PainelMultiItem
          initialNF={multiItens.numero_nf}
          initialData={multiItens.data_emissao}
          itens={multiItens.itens}
          unidadeAtiva={unidadeAtiva}
          onSalvar={handleSalvarMulti}
          onCancelar={() => setMultiItens(null)}
          loading={loading}
        />
      )}

      {/* Formulário de cadastro — oculto para supervisor e quando multi-item está aberto */}
      {!isSupervisor && !multiItens && (
        <div className="card" style={{marginBottom:24}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10}}>
            <div className="card-title" style={{margin:0}}>Nova NF de Entrada</div>
            <button
              className="btn btn-ghost btn-sm"
              title="Cadastrar NF com múltiplos materiais manualmente"
              onClick={() => setMultiItens({
                numero_nf: form.numero_nf || '',
                data_emissao: form.data_emissao || '',
                itens: [{ codigo_material:'', descricao_material:'', lote:'', volume_kg:'', valor_unitario:'' }]
              })}
            >
              📋 Múltiplos materiais
            </button>
          </div>
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
      )}

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
                  <th className="col-hide-mobile">Cód. Material</th>
                  <th>Lote POY</th>
                  <th className="td-right col-hide-mobile">Volume (kg)</th>
                  <th className="td-right">Saldo (kg)</th>
                  <th className="td-right col-hide-mobile">V. Unitário</th>
                  <th style={{width:90}}></th>
                </tr>
              </thead>
              <tbody>
                {nfs.length === 0 && (
                  <tr><td colSpan={8}><div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Nenhuma NF cadastrada ainda</div></div></td></tr>
                )}
                {nfs.map(nf => {
                  const statusV = statusVencimentoNF(nf)
                  const dias    = diasParaVencimento(nf)
                  const rowBg   = statusV === 'vencida' ? 'rgba(255,60,60,0.07)' : statusV === 'alerta' ? 'rgba(255,180,0,0.07)' : undefined
                  return (
                    <tr key={nf.id} style={{background: rowBg}}>
                      <td className="td-mono" style={{fontWeight:600}}>
                        {nf.numero_nf}
                        {statusV==='vencida' && <span title={`Vencida há ${Math.abs(dias)} dias`} style={{marginLeft:5,cursor:'help'}}>🚨</span>}
                        {statusV==='alerta'  && <span title={`Vence em ${dias} dias`} style={{marginLeft:5,cursor:'help'}}>⚠️</span>}
                      </td>
                      <td>{format(new Date(nf.data_emissao),'dd/MM/yy')}</td>
                      <td className="col-hide-mobile">
                        {nf.codigo_material}
                        {nf.descricao_material && <div style={{fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120}} title={nf.descricao_material}>{nf.descricao_material}</div>}
                      </td>
                      <td>{nf.lote || '—'}</td>
                      <td className="td-right td-mono col-hide-mobile">{fmt(nf.volume_kg)}</td>
                      <td className="td-right td-mono" style={{color:Number(nf.volume_saldo_kg)<=0.01?'var(--danger)':'var(--accent-2)',fontWeight:600}}>
                        {fmt(nf.volume_saldo_kg)}
                      </td>
                      <td className="td-right td-mono col-hide-mobile">{fmtCurrency(nf.valor_unitario)}</td>
                      <td style={{width:90, minWidth:90, overflow:'visible'}}>
                        <div style={{display:'flex', gap:2}}>
                          <button className="btn btn-ghost btn-sm" title="Ver detalhes" onClick={() => navigate(`/nf/${nf.id}`)}>🔍</button>
                          {!isSupervisor && <button className="btn btn-ghost btn-sm" title="Editar" onClick={() => abrirEditar(nf)}>✏</button>}
                          {!isSupervisor && <button className="btn btn-danger btn-sm" title="Remover" onClick={() => setConfirmDelete(nf)}>✕</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
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
          <div className="modal" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{color:'var(--danger)'}}>Remover NF</div>
            <p style={{color:'var(--text)', marginBottom:20}}>
              Deseja remover a NF <strong>{confirmDelete.numero_nf}</strong> ({confirmDelete.codigo_material})?
              O saldo será perdido permanentemente.
            </p>
            <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button className="btn" style={{background:'var(--danger)',color:'#fff'}} onClick={handleDeletar}>Remover</button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  )
}
