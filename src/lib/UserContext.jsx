import { createContext, useContext, useEffect, useState } from 'react'
import { db } from './firebase'
import {
  doc, getDoc, setDoc, getDocs, collection, updateDoc, Timestamp, onSnapshot
} from 'firebase/firestore'

const UserContext = createContext(null)

// Unidades de façonagem disponíveis — admin pode adicionar mais via config
export const UNIDADES_DEFAULT = [
  { id: 'santo_andre', label: 'Santo André (Matriz)' },
  { id: 'tiete',       label: 'Tietê (Filial)' },
]

// Carrega ou cria o perfil do usuário no Firestore
async function carregarOuCriarPerfil(uid, email, displayName) {
  const ref = doc(db, 'usuarios', uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data()
  // Novo usuário → analista sem unidade definida
  const perfil = {
    email,
    nome:       displayName || email,
    role:       'analista',
    unidade_id: '',
    criado_em:  Timestamp.now(),
  }
  await setDoc(ref, perfil)
  return perfil
}

export function UserProvider({ children, firebaseUser }) {
  const [perfil, setPerfil]         = useState(null)  // { role, unidade_id, ... }
  const [unidadeAtiva, setUnidadeAtiva] = useState(() => {
    // Persiste a unidade escolhida na sessão
    return sessionStorage.getItem('unidade_ativa') || ''
  })
  const [loadingPerfil, setLoadingPerfil] = useState(true)

  useEffect(() => {
    if (!firebaseUser) { setPerfil(null); setLoadingPerfil(false); return }
    const ref = doc(db, 'usuarios', firebaseUser.uid)
    const unsub = onSnapshot(ref, async (snap) => {
      if (snap.exists()) {
        const p = snap.data()
        setPerfil(p)
        // Analista: usa a unidade do perfil sempre
        if (p.role !== 'admin' && p.unidade_id) {
          setUnidadeAtiva(p.unidade_id)
          sessionStorage.setItem('unidade_ativa', p.unidade_id)
        }
      } else {
        const p = await carregarOuCriarPerfil(firebaseUser.uid, firebaseUser.email, firebaseUser.displayName)
        setPerfil(p)
      }
      setLoadingPerfil(false)
    }, () => setLoadingPerfil(false))
    return unsub
  }, [firebaseUser?.uid])

  const isAdmin = perfil?.role === 'admin'

  // Admin troca unidade ativa livremente no header
  const trocarUnidade = (id) => {
    if (!isAdmin) return
    setUnidadeAtiva(id)
    sessionStorage.setItem('unidade_ativa', id)
  }

  // Admin atualiza role/unidade de outro usuário
  const atualizarUsuario = async (uid, campos) => {
    await updateDoc(doc(db, 'usuarios', uid), campos)
  }

  // Lista todos os usuários (admin only)
  const listarUsuarios = async () => {
    const snap = await getDocs(collection(db, 'usuarios'))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  return (
    <UserContext.Provider value={{
      perfil, isAdmin, unidadeAtiva, loadingPerfil,
      trocarUnidade, atualizarUsuario, listarUsuarios,
    }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() { return useContext(UserContext) }
