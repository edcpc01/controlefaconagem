import { useEffect, useState, useMemo } from 'react'
import {
  listarNFsEntrada, listarSaidas, listarInventarios, buscarAlocacoesPorNF,
  TIPOS_SAIDA,
  relMovimentacoesNFPDF, relMovimentacoesNFXLSX,
  relFaturamentoPDF,    relFaturamentoXLSX,
  relDevolucoesPDF,     relDevolucoesXLSX,
  relInventarioPDF,     relInventarioXLSX,
} from '../lib/faconagem'
import { useUser } from '../lib/UserContext'
import { useOperacao } from '../lib/OperacaoContext'

const fmt = n => Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t=><div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

export default function RelatoriosPage() {
  const { unidadeAtiva } = useUser() || {}
  const { colecoes, operacaoAtiva } = useOperacao() || {}

  const [nfs,        setNfs]        = useState([])
  const [saidas,     setSaidas]     = useState([])
  const [inventarios,setInventarios] = useState([])
  const [alocacoes,  setAlocacoes]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [toasts,     setToasts]     = useState([])
  const [gerando,    setGerando]    = useState('')

  // Filtros
  const [de,      setDe]      = useState('')
  const [ate,     setAte]     = useState('')
  const [buscaNF, setBuscaNF] = useState('')
  const [buscaRom,setBuscaRom]= useState('')

  const toast = (msg, type='success') => {
    const id = Date.now()
    setToasts(t=>[...t,{id,msg,type}])
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),4000)
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      listarNFsEntrada(unidadeAtiva||'', colecoes),
      listarSaidas(unidadeAtiva||'', colecoes),
      listarInventarios(unidadeAtiva||'', colecoes),
    ]).then(async ([n, s, inv]) => {
      setNfs(n)
      setSaidas(s)
      setInventarios(inv)
      // Carrega todas as alocações de todas as NFs
      const todasAloc = []
      await Promise.all(n.map(async nf => {
        try {
          const alocs = await buscarAlocacoesPorNF(nf.id, colecoes)
          todasAloc.push(...alocs)
        } catch {}
      }))
      setAlocacoes(todasAloc)
    }).catch(e => toast(e.message,'error'))
      .finally(() => setLoading(false))
  }, [unidadeAtiva, operacaoAtiva])

  // Aplica filtros
  const aplicarFiltros = (items, campoData) => {
    return items.filter(item => {
      const d = item[campoData]
      if (de  && d && new Date(d) < new Date(de  + 'T00:00:00')) return false
      if (ate && d && new Date(d) > new Date(ate + 'T23:59:59')) return false
      return true
    })
  }

  const saidasFiltradas = useMemo(() => {
    return saidas.filter(s => {
      const d = s.criado_em
      if (de  && d && new Date(d) < new Date(de  + 'T00:00:00')) return false
      if (ate && d && new Date(d) > new Date(ate + 'T23:59:59')) return false
      if (buscaRom && !s.romaneio_microdata?.toLowerCase().includes(buscaRom.toLowerCase())) return false
      return true
    })
  }, [saidas, de, ate, buscaRom])

  const nfsFiltradas = useMemo(() => {
    return nfs.filter(n => {
      if (buscaNF && !n.numero_nf?.toLowerCase().includes(buscaNF.toLowerCase()) &&
          !n.lote?.toLowerCase().includes(buscaNF.toLowerCase())) return false
      return true
    })
  }, [nfs, buscaNF])

  const alocacoesFiltradas = useMemo(() => {
    const nfIds = new Set(nfsFiltradas.map(n => n.id))
    return alocacoes.filter(a => {
      if (!nfIds.has(a.nf_entrada_id)) return false
      const s = a.saida
      const d = s?.criado_em || a.criado_em
      if (de  && d && new Date(d) < new Date(de  + 'T00:00:00')) return false
      if (ate && d && new Date(d) > new Date(ate + 'T23:59:59')) return false
      return true
    })
  }, [alocacoes, nfsFiltradas, de, ate])

  const inventariosFiltrados = useMemo(() => {
    return inventarios.filter(inv => {
      const d = inv.criado_em
      if (de  && d && new Date(d) < new Date(de  + 'T00:00:00')) return false
      if (ate && d && new Date(d) > new Date(ate + 'T23:59:59')) return false
      return true
    })
  }, [inventarios, de, ate])

  const filtroLabel = de || ate
    ? `${de ? new Date(de+'T12:00').toLocaleDateString('pt-BR') : '—'} até ${ate ? new Date(ate+'T12:00').toLocaleDateString('pt-BR') : '—'}`
    : ''

  const fat  = saidasFiltradas.filter(s => s.tipo_saida === 'faturamento')
  const devs = saidasFiltradas.filter(s => ['dev_qualidade','dev_processo','dev_final_campanha'].includes(s.tipo_saida))

  const handle = async (key, fn) => {
    setGerando(key)
    try { await fn(); toast('Relatório gerado!') }
    catch (e) { toast(e.message||'Erro ao gerar relatório.','error') }
    finally { setGerando('') }
  }

  const BtnPDF  = ({k, onClick}) => (
    <button className="btn btn-ghost btn-sm" disabled={!!gerando} onClick={()=>handle(k+'-pdf',onClick)}
      style={{color:'var(--danger)',borderColor:'rgba(255,60,60,0.3)'}}>
      {gerando===k+'-pdf' ? '⏳' : '📄'} PDF
    </button>
  )
  const BtnXLSX = ({k, onClick}) => (
    <button className="btn btn-ghost btn-sm" disabled={!!gerando} onClick={()=>handle(k+'-xlsx',onClick)}
      style={{color:'var(--accent-2)',borderColor:'rgba(0,195,100,0.3)'}}>
      {gerando===k+'-xlsx' ? '⏳' : '📊'} XLSX
    </button>
  )

  if (loading) return <div className="loading"><div className="spinner"/><div>Carregando dados...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">📑 <span>Relatórios</span></div>
        <div className="page-sub">Gere relatórios em PDF ou XLSX com filtro de período, NF e romaneio</div>
      </div>

      {/* Filtros */}
      <div className="card" style={{marginBottom:24}}>
        <div className="card-title" style={{marginBottom:14}}>Filtros</div>
        <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end'}}>
          <div className="form-group" style={{margin:0}}>
            <label className="form-label">Data inicial</label>
            <input type="date" className="form-input" value={de} onChange={e=>setDe(e.target.value)} style={{maxWidth:160}} />
          </div>
          <div className="form-group" style={{margin:0}}>
            <label className="form-label">Data final</label>
            <input type="date" className="form-input" value={ate} onChange={e=>setAte(e.target.value)} style={{maxWidth:160}} />
          </div>
          <div className="form-group" style={{margin:0}}>
            <label className="form-label">NF ou Lote</label>
            <input className="form-input" placeholder="Ex: 99868 ou 5327" value={buscaNF} onChange={e=>setBuscaNF(e.target.value)} style={{maxWidth:160}} />
          </div>
          <div className="form-group" style={{margin:0}}>
            <label className="form-label">Romaneio</label>
            <input className="form-input" placeholder="Ex: 122041" value={buscaRom} onChange={e=>setBuscaRom(e.target.value)} style={{maxWidth:160}} />
          </div>
          {(de||ate||buscaNF||buscaRom) && (
            <button className="btn btn-ghost btn-sm" onClick={()=>{setDe('');setAte('');setBuscaNF('');setBuscaRom('')}}>
              ✕ Limpar
            </button>
          )}
        </div>
      </div>

      {/* Cards de relatório */}
      <div style={{display:'flex', flexDirection:'column', gap:16}}>

        {/* 1 — Movimentações NF de Entrada */}
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12}}>
            <div>
              <div className="card-title" style={{margin:0}}>📋 Movimentações de NF de Entrada</div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:4}}>
                Todas as baixas (saídas) realizadas referentes às NFs de entrada
              </div>
              <div style={{marginTop:8, display:'flex', gap:16, fontSize:12, flexWrap:'wrap'}}>
                <span>NFs: <strong style={{color:'var(--text)'}}>{nfsFiltradas.length}</strong></span>
                <span>Baixas: <strong style={{color:'var(--text)'}}>{alocacoesFiltradas.length}</strong></span>
                <span>Total abatido: <strong style={{color:'var(--accent)'}}>{fmt(alocacoesFiltradas.reduce((a,x)=>a+Number(x.volume_alocado_kg||0),0))} kg</strong></span>
              </div>
            </div>
            <div style={{display:'flex', gap:8}}>
              <BtnPDF  k="mov-nf" onClick={() => relMovimentacoesNFPDF(nfsFiltradas, alocacoesFiltradas, filtroLabel)} />
              <BtnXLSX k="mov-nf" onClick={() => relMovimentacoesNFXLSX(nfsFiltradas, alocacoesFiltradas)} />
            </div>
          </div>
        </div>

        {/* 2 — Faturamento */}
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12}}>
            <div>
              <div className="card-title" style={{margin:0}}>💰 Movimentações de Faturamento</div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:4}}>
                Apenas saídas do tipo Faturamento no período selecionado
              </div>
              <div style={{marginTop:8, display:'flex', gap:16, fontSize:12, flexWrap:'wrap'}}>
                <span>Romaneios: <strong style={{color:'var(--text)'}}>{fat.length}</strong></span>
                <span>Total: <strong style={{color:'var(--accent)'}}>{fmt(fat.reduce((a,s)=>a+Number(s.volume_abatido_kg||0),0))} kg</strong></span>
              </div>
            </div>
            <div style={{display:'flex', gap:8}}>
              <BtnPDF  k="fat" onClick={() => relFaturamentoPDF(saidasFiltradas, filtroLabel)} />
              <BtnXLSX k="fat" onClick={() => relFaturamentoXLSX(saidasFiltradas)} />
            </div>
          </div>
        </div>

        {/* 3 — Devoluções */}
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12}}>
            <div>
              <div className="card-title" style={{margin:0}}>↩️ Movimentações de Devoluções</div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:4}}>
                Devoluções de Qualidade, Processo e Final de Campanha
              </div>
              <div style={{marginTop:8, display:'flex', gap:16, fontSize:12, flexWrap:'wrap'}}>
                <span>Romaneios: <strong style={{color:'var(--text)'}}>{devs.length}</strong></span>
                <span>Total: <strong style={{color:'var(--accent)'}}>{fmt(devs.reduce((a,s)=>a+Number(s.volume_abatido_kg||0),0))} kg</strong></span>
                {(['dev_qualidade','dev_processo','dev_final_campanha']).map(tipo => {
                  const c = devs.filter(s=>s.tipo_saida===tipo).length
                  if (!c) return null
                  return <span key={tipo} style={{color:'var(--text-dim)'}}>{TIPOS_SAIDA.find(t=>t.value===tipo)?.label}: <strong style={{color:'var(--text)'}}>{c}</strong></span>
                })}
              </div>
            </div>
            <div style={{display:'flex', gap:8}}>
              <BtnPDF  k="dev" onClick={() => relDevolucoesPDF(saidasFiltradas, filtroLabel)} />
              <BtnXLSX k="dev" onClick={() => relDevolucoesXLSX(saidasFiltradas)} />
            </div>
          </div>
        </div>

        {/* 4 — Inventário */}
        <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12}}>
            <div>
              <div className="card-title" style={{margin:0}}>📦 Inventários</div>
              <div style={{fontSize:12, color:'var(--text-dim)', marginTop:4}}>
                Todos os inventários físicos registrados no período selecionado
              </div>
              <div style={{marginTop:8, display:'flex', gap:16, fontSize:12, flexWrap:'wrap'}}>
                <span>Inventários: <strong style={{color:'var(--text)'}}>{inventariosFiltrados.length}</strong></span>
                <span>Lotes totais: <strong style={{color:'var(--text)'}}>{inventariosFiltrados.reduce((a,i)=>a+(i.linhas?.length||0),0)}</strong></span>
              </div>
            </div>
            <div style={{display:'flex', gap:8}}>
              <BtnPDF  k="inv" onClick={() => relInventarioPDF(inventariosFiltrados, filtroLabel)} />
              <BtnXLSX k="inv" onClick={() => relInventarioXLSX(inventariosFiltrados)} />
            </div>
          </div>
        </div>

      </div>

      <Toast toasts={toasts} />
    </div>
  )
}
