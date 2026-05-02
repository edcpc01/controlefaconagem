import { createContext, useContext, useState, useEffect } from 'react'
import { useUser } from './UserContext'

// ─────────────────────────────────────────────────────────────────
// OPERAÇÕES DISPONÍVEIS
// ─────────────────────────────────────────────────────────────────

export const OPERACOES = [
  { id: 'rhodia', label: 'Rhodia',  cor: '#1a5096' },
  { id: 'nilit',  label: 'Nilit',   cor: '#0e7c6b' },
]

// Mapeamento de coleções Firebase por operação
export const COLECOES = {
  rhodia: {
    nf_entrada:     'nf_entrada',
    saida:          'saida',
    alocacao_saida: 'alocacao_saida',
    log_acoes:      'log_acoes',
    inventario:     'inventario',
    nf_historico:   'nf_historico',
    config:         'config',
    codigo_sankhia: 'codigo_sankhia',
  },
  nilit: {
    nf_entrada:     'nf_entrada_nilit',
    saida:          'saida_nilit',
    alocacao_saida: 'alocacao_saida_nilit',
    log_acoes:      'log_acoes_nilit',
    inventario:     'inventario_nilit',
    nf_historico:   'nf_historico_nilit',
    config:         'config_nilit',
    codigo_sankhia: 'codigo_sankhia_nilit',
  },
}

// ─────────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────────

const OperacaoContext = createContext(null)

export function OperacaoProvider({ children }) {
  const ctx = useUser()
  const perfil = ctx?.perfil

  // Determina operação fixa para supervisores
  const operacaoFixa =
    perfil?.role === 'supervisor_rhodia' ? 'rhodia' :
    perfil?.role === 'supervisor_nilit'  ? 'nilit'  :
    null

  const [operacaoAtiva, setOperacaoAtiva] = useState(() => {
    if (operacaoFixa) return operacaoFixa
    return sessionStorage.getItem('operacao_ativa') || 'rhodia'
  })

  // Quando o perfil carrega, força operação fixa para supervisores
  useEffect(() => {
    if (operacaoFixa) {
      setOperacaoAtiva(operacaoFixa)
      sessionStorage.setItem('operacao_ativa', operacaoFixa)
    }
  }, [operacaoFixa])

  const trocarOperacao = (id) => {
    if (operacaoFixa) return // supervisor não pode trocar
    setOperacaoAtiva(id)
    sessionStorage.setItem('operacao_ativa', id)
  }

  const colecoes      = COLECOES[operacaoAtiva] || COLECOES.rhodia
  const operacaoInfo  = OPERACOES.find(o => o.id === operacaoAtiva) || OPERACOES[0]
  const podeTrocar    = !operacaoFixa

  return (
    <OperacaoContext.Provider value={{
      operacaoAtiva,
      trocarOperacao,
      colecoes,
      operacaoInfo,
      podeTrocar,
    }}>
      {children}
    </OperacaoContext.Provider>
  )
}

export function useOperacao() {
  return useContext(OperacaoContext)
}
