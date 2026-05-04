import { useEffect, useMemo, useRef, useState } from 'react'
import {
  listarCodigosSankhia, salvarCodigoSankhia, deletarCodigoSankhia,
  importarCodigosSankhiaXLSX, listarNFsEntrada,
} from '../lib/faconagem'
import { useAuth } from '../lib/AuthContext'
import { useUser } from '../lib/UserContext'
import { useOperacao } from '../lib/OperacaoContext'
import * as XLSX from 'xlsx'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

const EMPTY_FORM = { codigo_material: '', codigo_sankhia: '', descricao_sankhia: '' }

export default function CadastroSankhiaPage() {
  const { user } = useAuth()
  const { isSupervisor, isSupervisorCorradi } = useUser() || {}
  const readOnly = isSupervisor || isSupervisorCorradi
  const { colecoes, operacaoInfo } = useOperacao() || {}

  const [lista, setLista]         = useState([])
  const [nfsExistentes, setNfs]   = useState([])
  const [loadingList, setLoading] = useState(true)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [editandoId, setEditandoId] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [importando, setImportando] = useState(false)
  const [busca, setBusca]         = useState('')
  const [filtroFalt, setFiltroFalt] = useState(false) // só não cadastrados
  const [confirmDel, setConfirmDel] = useState(null)
  const [toasts, setToasts]       = useState([])
  const fileRef = useRef()

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  const load = () => {
    setLoading(true)
    Promise.all([listarCodigosSankhia(colecoes), listarNFsEntrada('', colecoes)])
      .then(([s, n]) => { setLista(s); setNfs(n) })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (colecoes) load() }, [colecoes])

  // Mapa código_material → codigo_sankhia
  const mapaSankhia = useMemo(() => {
    const m = new Map()
    for (const it of lista) m.set(String(it.codigo_material), it)
    return m
  }, [lista])

  // Materiais únicos a partir das NFs (com descrição da NF)
  const materiaisDeNFs = useMemo(() => {
    const m = new Map()
    for (const nf of nfsExistentes) {
      const cod = String(nf.codigo_material || '')
      if (!cod) continue
      if (!m.has(cod)) m.set(cod, { codigo_material: cod, descricao_nf: nf.descricao_material || '' })
    }
    return Array.from(m.values()).sort((a, b) => a.codigo_material.localeCompare(b.codigo_material))
  }, [nfsExistentes])

  // Lista exibida: combinação da tabela cadastrada + materiais das NFs sem mapeamento (placeholder)
  const linhasExibidas = useMemo(() => {
    const mapaCadastro = mapaSankhia
    const linhas = []
    // 1. Cadastros existentes
    for (const item of lista) {
      const matNF = materiaisDeNFs.find(m => m.codigo_material === String(item.codigo_material))
      linhas.push({
        id: item.id,
        codigo_material: item.codigo_material,
        codigo_sankhia: item.codigo_sankhia,
        descricao_sankhia: item.descricao_sankhia || '',
        descricao_nf: matNF?.descricao_nf || '',
        cadastrado: true,
      })
    }
    // 2. Materiais que estão em NFs mas não têm mapeamento
    for (const m of materiaisDeNFs) {
      if (!mapaCadastro.has(m.codigo_material)) {
        linhas.push({
          id: null,
          codigo_material: m.codigo_material,
          codigo_sankhia: '',
          descricao_sankhia: '',
          descricao_nf: m.descricao_nf,
          cadastrado: false,
        })
      }
    }
    // Filtros
    let resultado = linhas
    if (filtroFalt) resultado = resultado.filter(l => !l.cadastrado)
    if (busca) {
      const q = busca.toLowerCase()
      resultado = resultado.filter(l =>
        String(l.codigo_material).toLowerCase().includes(q) ||
        String(l.codigo_sankhia).toLowerCase().includes(q) ||
        String(l.descricao_nf).toLowerCase().includes(q) ||
        String(l.descricao_sankhia).toLowerCase().includes(q)
      )
    }
    return resultado.sort((a, b) => {
      // não cadastrados primeiro quando filtroFalt ativo
      if (a.cadastrado !== b.cadastrado) return a.cadastrado ? 1 : -1
      return String(a.codigo_material).localeCompare(String(b.codigo_material))
    })
  }, [lista, materiaisDeNFs, mapaSankhia, busca, filtroFalt])

  const totalCadastrados = lista.length
  const totalFaltando    = materiaisDeNFs.filter(m => !mapaSankhia.has(m.codigo_material)).length

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const resetForm = () => { setForm(EMPTY_FORM); setEditandoId(null) }

  const startEdit = (linha) => {
    setForm({
      codigo_material:   linha.codigo_material,
      codigo_sankhia:    linha.codigo_sankhia,
      descricao_sankhia: linha.descricao_sankhia,
    })
    setEditandoId(linha.id || null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSave = async () => {
    if (readOnly) return
    if (!form.codigo_material.trim() || !form.codigo_sankhia.trim()) {
      toast('Preencha código do material e código Sankhia.', 'error'); return
    }
    setSaving(true)
    try {
      await salvarCodigoSankhia(form, user, colecoes)
      toast(editandoId ? 'Mapeamento atualizado!' : 'Mapeamento cadastrado!')
      resetForm()
      load()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (linha) => {
    if (readOnly || !linha.id) return
    try {
      await deletarCodigoSankhia(linha.id, user, colecoes)
      toast('Mapeamento removido.')
      setConfirmDel(null)
      load()
    } catch (e) {
      toast(e.message, 'error')
      setConfirmDel(null)
    }
  }

  const handleImportXLSX = async (e) => {
    if (readOnly) return
    const file = e.target.files?.[0]
    if (!file) return
    setImportando(true)
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      // Lê tudo como array para detectar a linha de cabeçalho dinamicamente
      // (o arquivo Sankhia tem 2 linhas de metadados antes dos cabeçalhos reais)
      const todasLinhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const normalizar = s => String(s).replace(/[^\x20-\x7E]/g, '').trim().toUpperCase()
      const headerIdx = todasLinhas.findIndex(row =>
        row.some(c => normalizar(c) === 'CODPROD') &&
        row.some(c => normalizar(c) === 'COMPLDESC')
      )
      if (headerIdx === -1) {
        toast('Planilha inválida — colunas CODPROD e COMPLDESC não encontradas.', 'error')
        return
      }
      const headers = todasLinhas[headerIdx].map(normalizar)
      const normalizadas = todasLinhas.slice(headerIdx + 1)
        .filter(row => row.some(c => c !== ''))
        .map(row => {
          const out = {}
          headers.forEach((h, i) => { out[h] = row[i] ?? '' })
          return out
        })
      const { criados, atualizados, ignorados, erros } = await importarCodigosSankhiaXLSX(normalizadas, user, colecoes)
      toast(`Importação: ${criados} criados, ${atualizados} atualizados${ignorados ? `, ${ignorados} ignorados` : ''}${erros.length ? ` (${erros.length} erros)` : ''}`)
      load()
    } catch (err) {
      toast(`Erro ao importar: ${err.message}`, 'error')
    } finally {
      setImportando(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
        <div>
          <div className="page-title"><span>🔗</span> Cadastro Sankhia</div>
          <div className="page-sub">
            Vínculo Cód. NF ↔ Cód. Sankhia · Operação ativa: <strong style={{color: operacaoInfo?.cor || 'var(--accent)'}}>{operacaoInfo?.label}</strong>
          </div>
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{display:'none'}}
            onChange={handleImportXLSX}
          />
          {!readOnly && (
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importando}>
              {importando ? '⏳ Importando...' : '📥 Importar XLSX (CODPROD × COMPLDESC)'}
            </button>
          )}
        </div>
      </div>

      {/* KPIs simples */}
      <div className="form-grid-4" style={{marginBottom:20}}>
        <div style={{padding:'14px 16px', background:'var(--bg-2)', borderRadius:10, border:'1px solid var(--border)'}}>
          <div style={{fontSize:11, color:'var(--text-dim)', textTransform:'uppercase', letterSpacing:'0.04em'}}>Cadastrados</div>
          <div style={{fontSize:22, fontWeight:700, color:'var(--accent)', marginTop:4}}>{totalCadastrados}</div>
        </div>
        <div style={{padding:'14px 16px', background:'var(--bg-2)', borderRadius:10, border:'1px solid var(--border)'}}>
          <div style={{fontSize:11, color:'var(--text-dim)', textTransform:'uppercase', letterSpacing:'0.04em'}}>Materiais sem Cód. Sankhia</div>
          <div style={{fontSize:22, fontWeight:700, color: totalFaltando > 0 ? 'var(--warn)' : 'var(--accent-2)', marginTop:4}}>{totalFaltando}</div>
        </div>
      </div>

      {/* ── Form CRUD manual ── */}
      {!readOnly && (
        <div className="card" style={{marginBottom:20}}>
          <div className="card-title">{editandoId ? '✏ Editando Mapeamento' : '➕ Novo Mapeamento'}</div>
          <div className="form-grid-4" style={{marginTop:8}}>
            <div className="form-group">
              <label className="form-label">Cód. Material (NF) *</label>
              <input className="form-input" placeholder="Ex: 23033"
                value={form.codigo_material}
                disabled={!!editandoId}
                onChange={e => set('codigo_material', e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="form-group">
              <label className="form-label">Cód. Sankhia *</label>
              <input className="form-input" placeholder="Ex: 63747"
                value={form.codigo_sankhia}
                onChange={e => set('codigo_sankhia', e.target.value.trim())} />
            </div>
            <div className="form-group" style={{gridColumn:'span 2'}}>
              <label className="form-label">Descrição Sankhia (opcional)</label>
              <input className="form-input" placeholder="Ex: STANTEX® UNF"
                value={form.descricao_sankhia}
                onChange={e => set('descricao_sankhia', e.target.value)} />
            </div>
          </div>
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:14}}>
            {editandoId && <button className="btn btn-ghost" onClick={resetForm}>Cancelar</button>}
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : editandoId ? '✓ Atualizar' : '➕ Cadastrar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Lista ── */}
      <div className="card" style={{marginBottom:16, paddingBottom:0}}>
        <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', paddingBottom:16}}>
          <div className="card-title" style={{margin:0, flex:'1 1 200px'}}>Mapeamentos</div>
          <input className="form-input" style={{maxWidth:240}}
            placeholder="🔍 Cód. NF, Sankhia ou descrição..."
            value={busca} onChange={e => setBusca(e.target.value)} />
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--text-dim)', cursor:'pointer'}}>
            <input type="checkbox" checked={filtroFalt} onChange={e => setFiltroFalt(e.target.checked)} />
            Apenas faltando
          </label>
        </div>
      </div>

      <div className="card">
        {loadingList ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cód. Material (NF)</th>
                  <th>Cód. Sankhia</th>
                  <th>Descrição</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {linhasExibidas.length === 0 && (
                  <tr><td colSpan={5}>
                    <div className="empty">
                      <div className="empty-icon">{busca ? '🔍' : '📋'}</div>
                      <div className="empty-text">{busca ? 'Nenhum mapeamento encontrado.' : 'Nenhum mapeamento cadastrado ainda.'}</div>
                    </div>
                  </td></tr>
                )}
                {linhasExibidas.map((linha, i) => (
                  <tr key={linha.id || `nf-${linha.codigo_material}-${i}`}>
                    <td className="td-mono" style={{fontWeight:600}}>{linha.codigo_material}</td>
                    <td className="td-mono" style={{fontWeight:600, color: linha.cadastrado ? 'var(--accent)' : 'var(--text-dim)'}}>
                      {linha.codigo_sankhia || '—'}
                    </td>
                    <td style={{fontSize:13, color: linha.cadastrado ? 'var(--text)' : 'var(--text-dim)'}}>
                      {linha.descricao_sankhia || linha.descricao_nf || '—'}
                    </td>
                    <td>
                      {linha.cadastrado
                        ? <span className="badge badge-green">✓ Cadastrado</span>
                        : <span className="badge badge-warn">⚠ Faltando</span>}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {!readOnly && (
                        <div style={{display:'flex', gap:2}}>
                          <button className="btn btn-ghost btn-sm" title={linha.cadastrado ? 'Editar' : 'Cadastrar'}
                            onClick={() => startEdit(linha)}>{linha.cadastrado ? '✏' : '➕'}</button>
                          {linha.cadastrado && (
                            <button className="btn btn-ghost btn-sm" title="Excluir"
                              onClick={() => setConfirmDel(linha)}
                              style={{color:'var(--danger)'}}>🗑</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDel && (
        <div className="modal-overlay" onClick={() => setConfirmDel(null)}>
          <div className="modal" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{color:'var(--danger)'}}>🗑 Excluir Mapeamento</div>
            <p style={{color:'var(--text)', marginBottom:20}}>
              Excluir o vínculo <strong>{confirmDel.codigo_material}</strong> → <strong>{confirmDel.codigo_sankhia}</strong>?
            </p>
            <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button className="btn" style={{background:'var(--danger)', color:'#fff'}}
                onClick={() => handleDelete(confirmDel)}>Excluir</button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  )
}
