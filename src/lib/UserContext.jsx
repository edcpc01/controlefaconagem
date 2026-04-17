import { createContext, useContext, useEffect, useState } from 'react'
import { db } from './firebase'
import {
  doc, setDoc, getDocs, collection, updateDoc, Timestamp, onSnapshot
} from 'firebase/firestore'

export const UNIDADES_DEFAULT = [
  { id: 'corradi_matriz', label: 'Corradi Matriz' },
  { id: 'corradi_filial', label: 'Corradi Filial' },
]

export const OPERACOES = [
  { id: 'rhodia', label: 'Rhodia',  icon: '🔵', cor: '#1a6aff' },
  { id: 'nilit',  label: 'Nilit',   icon: '🟢', cor: '#00c864' },
]

// Roles do sistema
// admin            — acesso total, todas operações
// supervisor_rhodia — supervisor só da operação Rhodia
// supervisor_nilit  — supervisor só da operação Nilit
// analista          — operação definida por operacao_id no perfil

const UserContext = createContext(null)

async function criarPerfil(uid, email, displayName) {
  const ref = doc(db, 'usuarios', uid)
  const perfil = {
    email,
    nome:         displayName || email || uid,
    role:         'analista',
    unidade_id:   '',
    operacao_id:  '',   // 'rhodia' | 'nilit' | '' (todos)
    criado_em:    Timestamp.now(),
  }
  await setDoc(ref, perfil, { merge: false })
  return perfil
}

export function UserProvider({ children, firebaseUser }) {
  const [perfil,         setPerfil]        = useState(null)
  const [loadingPerfil,  setLoadingPerfil] = useState(true)
  const [unidadeAtiva,   setUnidadeAtiva]  = useState(
    () => sessionStorage.getItem('unidade_ativa') || ''
  )
  const [operacaoAtiva, setOperacaoAtiva] = useState(
    () => sessionStorage.getItem('operacao_ativa') || ''
  )

  useEffect(() => {
    if (!firebaseUser) { setPerfil(null); setLoadingPerfil(false); return }

    const ref  = doc(db, 'usuarios', firebaseUser.uid)
    let   init = true

    const unsub = onSnapshot(ref, async snap => {
      let p
      if (snap.exists()) {
        p = snap.data()
      } else if (init) {
        try { p = await criarPerfil(firebaseUser.uid, firebaseUser.email, firebaseUser.displayName) }
        catch { p = { email: firebaseUser.email, nome: firebaseUser.displayName, role: 'analista', unidade_id: '', operacao_id: '' } }
      } else { return }
      init = false
      setPerfil(p)

      // Analista fixo na unidade do perfil
      if (p.role === 'analista' && p.unidade_id) {
        setUnidadeAtiva(p.unidade_id)
        sessionStorage.setItem('unidade_ativa', p.unidade_id)
      }

      // Analista fixo na operação do perfil
      if (p.role === 'analista' && p.operacao_id) {
        setOperacaoAtiva(p.operacao_id)
        sessionStorage.setItem('operacao_ativa', p.operacao_id)
      }

      setLoadingPerfil(false)
    }, () => setLoadingPerfil(false))

    return unsub
  }, [firebaseUser?.uid])

  const isAdmin           = perfil?.role === 'admin'
  const isSupervisorRhodia = perfil?.role === 'supervisor_rhodia'
  const isSupervisorNilit  = perfil?.role === 'supervisor_nilit'
  const isSupervisor       = isSupervisorRhodia || isSupervisorNilit
  const isAnalista         = perfil?.role === 'analista'

  // Operações que este usuário pode acessar
  const operacoesPermitidas = isAdmin
    ? OPERACOES
    : isSupervisorRhodia
    ? OPERACOES.filter(o => o.id === 'rhodia')
    : isSupervisorNilit
    ? OPERACOES.filter(o => o.id === 'nilit')
    : isAnalista && perfil?.operacao_id
    ? OPERACOES.filter(o => o.id === perfil.operacao_id)
    : OPERACOES  // analista sem operacao_id vê tudo

  const operacaoObj = OPERACOES.find(o => o.id === operacaoAtiva) || null

  const selecionarOperacao = (id) => {
    // Analista só pode selecionar se a operação está nas permitidas
    const perm = operacoesPermitidas.find(o => o.id === id)
    if (!perm) return
    setOperacaoAtiva(id)
    sessionStorage.setItem('operacao_ativa', id)
  }

  const trocarUnidade = (id) => {
    if (isAnalista) return
    setUnidadeAtiva(id)
    sessionStorage.setItem('unidade_ativa', id)
  }

  const atualizarUsuario = async (uid, campos) => {
    await updateDoc(doc(db, 'usuarios', uid), campos)
  }

  const listarUsuarios = async () => {
    const snap = await getDocs(collection(db, 'usuarios'))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  return (
    <UserContext.Provider value={{
      perfil, isAdmin, isSupervisor, isSupervisorRhodia, isSupervisorNilit, isAnalista,
      unidadeAtiva, operacaoAtiva, operacaoObj, operacoesPermitidas, loadingPerfil,
      trocarUnidade, selecionarOperacao, atualizarUsuario, listarUsuarios,
    }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() { return useContext(UserContext) }
