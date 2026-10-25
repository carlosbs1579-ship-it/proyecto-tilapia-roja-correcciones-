import React, { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
} from 'firebase/auth';
import { auth } from '../firebase/firebaseConfig';
import { X, Lock, Mail, AlertCircle, CheckCircle, Shield } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// La sesión se obtiene en App.tsx mediante onAuthStateChanged; este modal solo autentica con Firebase
export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [esRegistro, setEsRegistro] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exitoMsg, setExitoMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setExitoMsg(null);
    setCargando(true);

    const emailLimpio = email.trim();

    try {
      if (esRegistro) {
        await createUserWithEmailAndPassword(auth, emailLimpio, password);
        setExitoMsg('Usuario operario registrado e iniciado exitosamente.');
      } else {
        await signInWithEmailAndPassword(auth, emailLimpio, password);
        setExitoMsg('Sesión iniciada correctamente.');
      }
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.warn('Firebase Auth intento:', err?.code || err?.message);

      let mensaje = 'Error al procesar la autenticación.';
      if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation') {
        mensaje = 'El acceso con correo y contraseña no está habilitado en Firebase. Usa tu cuenta de Google o contacta al administrador.';
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        mensaje = 'Correo o contraseña incorrectos.';
      } else if (err.code === 'auth/email-already-in-use') {
        mensaje = 'Este correo ya se encuentra registrado. Selecciona "Iniciar sesión".';
      } else if (err.code === 'auth/weak-password') {
        mensaje = 'La contraseña debe tener al menos 6 caracteres.';
      } else if (err.code === 'auth/invalid-email') {
        mensaje = 'El formato del correo electrónico no es válido.';
      } else if (err.message) {
        mensaje = err.message;
      }
      setErrorMsg(mensaje);
    } finally {
      setCargando(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setExitoMsg(null);
    setCargando(true);
    try {
      const provider = new GoogleAuthProvider();
      // Pedir siempre que se elija la cuenta, para no entrar automáticamente con la cuenta principal del navegador
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      setExitoMsg('Sesión iniciada con Google.');
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      console.error('Error Google Sign In:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setErrorMsg(err.message || 'Error al iniciar sesión con Google.');
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
        {/* Cabecera */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-sky-400" />
            <h3 className="font-semibold text-base">
              {esRegistro ? 'Registrar nuevo operario' : 'Acceso al Sistema Loré'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-xs text-slate-600 mb-4">
            Solo el personal autorizado de <strong>Cultivos Loré</strong> puede registrar lotes, registrar eventos y cerrar ciclos de trazabilidad.
          </p>

          {errorMsg && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {exitoMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-2 text-emerald-700 text-xs">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{exitoMsg}</span>
            </div>
          )}

          {/* Botón de Google Sign-in */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={cargando}
            className="w-full flex items-center justify-center space-x-2.5 py-2 px-4 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs transition-colors disabled:opacity-50 mb-4"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.14z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.76-2.1-6.7-4.93H1.27v3.15C3.25 21.36 7.35 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.3 14.27c-.24-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.27C.46 8.2 0 10.04 0 12s.46 3.8 1.27 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.25 2.64 1.27 6.58l4.03 3.15c.94-2.83 3.58-4.98 6.7-4.98z"
              />
            </svg>
            <span>Continuar con Cuenta Google</span>
          </button>

          <div className="relative flex items-center justify-center my-3">
            <div className="border-t border-slate-200 w-full" />
            <span className="bg-white px-2 text-[10px] uppercase tracking-wider text-slate-400 font-semibold absolute">
              o con correo de operario
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-700">
                  Correo del operario
                </label>
                <button
                  type="button"
                  onClick={() => setEmail('carlosbs1579@gmail.com')}
                  className="text-[10px] text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 font-semibold"
                >
                  👑 carlosbs1579@gmail.com
                </button>
              </div>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  placeholder="operario@cultivoslore.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={cargando}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
            >
              {cargando
                ? 'Verificando credenciales...'
                : esRegistro
                ? 'Registrar nuevo perfil'
                : 'Iniciar Sesión'}
            </button>
          </form>

          <div className="mt-4 pt-3 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => {
                setEsRegistro(!esRegistro);
                setErrorMsg(null);
                setExitoMsg(null);
              }}
              className="text-xs text-sky-600 hover:text-sky-800 font-medium"
            >
              {esRegistro
                ? '¿Ya tienes cuenta? Inicia sesión aquí'
                : '¿Nuevo operario? Regístrate aquí'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
