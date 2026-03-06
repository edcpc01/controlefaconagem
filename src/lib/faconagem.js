import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined) // undefined = loading
  const [error, setError]     = useState(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u ?? null))
    return unsub
  }, [])

  const loginGoogle = async () => {
    setError(null)
    try { await signInWithPopup(auth, googleProvider) }
    catch (e) { setError(mensagemErro(e.code)) }
  }

  const loginEmail = async (email, senha) => {
    setError(null)
    try { await signInWithEmailAndPassword(auth, email, senha) }
    catch (e) { setError(mensagemErro(e.code)) }
  }

  const cadastrarEmail = async (email, senha, nome) => {
    setError(null)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, senha)
      if (nome) await updateProfile(cred.user, { displayName: nome })
    } catch (e) { setError(mensagemErro(e.code)) }
  }

  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, error, setError, loginGoogle, loginEmail, cadastrarEmail, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

function mensagemErro(code) {
  const map = {
    'auth/user-not-found':      'Usuário não encontrado.',
    'auth/wrong-password':      'Senha incorreta.',
    'auth/invalid-email':       'E-mail inválido.',
    'auth/email-already-in-use':'E-mail já cadastrado.',
    'auth/weak-password':       'Senha muito fraca (mínimo 6 caracteres).',
    'auth/invalid-credential':  'E-mail ou senha inválidos.',
    'auth/popup-closed-by-user':'Login cancelado.',
    'auth/too-many-requests':   'Muitas tentativas. Tente novamente mais tarde.',
  }
  return map[code] || `Erro de autenticação (${code}).`
}


  pdoc.save(`romaneio_${saida.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`)
}


