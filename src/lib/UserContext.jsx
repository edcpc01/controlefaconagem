import { createContext, useContext, useEffect, useState } from 'react'
import { db } from './firebase'
import {
  doc, getDoc, setDoc, getDocs, collection, updateDoc, Timestamp, onSnapshot
} from 'firebase/firestore'

export const UNIDADES_DEFAULT = [
  { id: 'corradi_matriz', label: 'Corradi Matriz' },
  { id: 'corradi_filial', label: 'Corradi Filial' },
]

const UserContext = createContext(null)

async function criarPerfil(uid, email, displayName) {
  const ref    = doc(db, 'usuarios', uid)
  const perfil = {
    email,
    nome:       displayName || email || uid,
    role:       'pendente',   // aguarda aprovação do admin
    unidade_id: '',
    criado_em:  Timestamp.now(),
  }
  await setDoc(ref, perfil, { merge: false })
  return perfil
}

export function UserProvider({ children, firebaseUser }) {
  const [perfil,       setPerfil]       = useState(null)
  const [loadingPerfil, setLoadingPerfil] = useState(true)

  // Unidade ativa — admin escolhe livremente, analista herda do perfil
  const [unidadeAtiva, setUnidadeAtiva] = useState(
    () => sessionStorage.getItem('unidade_ativa') || ''
  )

  useEffect(() => {
    if (!firebaseUser) {
      setPerfil(null)
      setLoadingPerfil(false)
      return
    }

    const ref  = doc(db, 'usuarios', firebaseUser.uid)
    let   init = true   // primeira snapshot

    const unsub = onSnapshot(ref, async snap => {
      let p
      if (snap.exists()) {
        p = snap.data()
      } else if (init) {
        // Primeiro login — cria perfil
        try { p = await criarPerfil(firebaseUser.uid, firebaseUser.email, firebaseUser.displayName) }
        catch { p = { email: firebaseUser.email, nome: firebaseUser.displayName, role: 'pendente', unidade_id: '' } }
      } else {
        return   // snapshot intermediário antes do setDoc propagar
      }
      init = false
      setPerfil(p)

      // Analista sempre usa a unidade do seu perfil
      if (p.role !== 'admin' && p.role !== 'supervisor' && p.unidade_id) {
        setUnidadeAtiva(p.unidade_id)
        sessionStorage.setItem('unidade_ativa', p.unidade_id)
      }
      setLoadingPerfil(false)
    }, () => {
      // Erro de permissão (antes das rules do Firestore estarem configuradas)
      setLoadingPerfil(false)
    })

    return unsub
  }, [firebaseUser?.uid])

  const isAdmin            = perfil?.role === 'admin'
  const isSupervisor       = perfil?.role === 'supervisor_rhodia' || perfil?.role === 'supervisor_nilit'
  const isSupervisorRhodia = perfil?.role === 'supervisor_rhodia'
  const isSupervisorNilit  = perfil?.role === 'supervisor_nilit'

  const trocarUnidade = (id) => {
    if (!isAdmin && !isSupervisor) return   // só admin e supervisor podem trocar
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
      perfil, isAdmin, isSupervisor, isSupervisorRhodia, isSupervisorNilit,
      unidadeAtiva, loadingPerfil,
      trocarUnidade, atualizarUsuario, listarUsuarios,
    }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
