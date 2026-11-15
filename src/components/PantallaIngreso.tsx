import React, { useEffect, useState } from 'react';
import { LayoutGroup, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  GoogleAuthProvider
} from 'firebase/auth';
import { Factory, Truck, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import { auth } from '../firebase/firebaseConfig';
import { LogoLore } from './LogoLore';
import { RESORTE, DURACION, CURVA, DISTANCIA, ESCALON_BLOQUES, TEMBLOR } from '../lib/motion';

export type RolIngreso = 'operator' | 'courier';

const ROLES: { id: RolIngreso; etiqueta: string; icono: React.ReactNode }[] = [
  { id: 'operator', etiqueta: 'Operador', icono: <Factory className="w-4 h-4" strokeWidth={1.75} /> },
  { id: 'courier', etiqueta: 'Repartidor', icono: <Truck className="w-4 h-4" strokeWidth={1.75} /> }
];

function mensajeError(err: any): string {
  if (err?.code === 'auth/operation-not-allowed' || err?.code === 'auth/admin-restricted-operation') {
    return 'El acceso con correo y contraseña no está habilitado. Usa tu cuenta de Google o habla con el administrador.';
  }
  if (err?.code === 'auth/user-not-found' || err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
    return 'Correo o contraseña incorrectos.';
  }
  if (err?.code === 'auth/email-already-in-use') return 'Este correo ya tiene una cuenta. Usa "Ingresar".';
  if (err?.code === 'auth/weak-password') return 'La contraseña debe tener al menos 6 caracteres.';
  if (err?.code === 'auth/invalid-email') return 'El correo no tiene un formato válido.';
  if (err?.code === 'auth/too-many-requests') return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  if (err?.code === 'auth/network-request-failed') return 'No hay conexión. Revisa tu internet y vuelve a intentarlo.';
  return 'No fue posible ingresar. Vuelve a intentarlo.';
}

/**
 * Pantalla de inicio de sesión propia (reemplaza la app bloqueada cuando no hay sesión).
 * El rol elegido es una preferencia: la app lo aplica solo si la cuenta tiene esa función
 * (la validación real la hacen los permisos de la cuenta y las reglas de la base de datos).
 */
export const PantallaIngreso: React.FC<{ onRolElegido: (rol: RolIngreso) => void }> = ({ onRolElegido }) => {
  const reducido = useReducedMotion();
  const temblor = useAnimationControls();
  const [rol, setRol] = useState<RolIngreso>('operator');
  const [registro, setRegistro] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<{ campo: 'email' | 'password' | 'general'; texto: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Un error hace temblar el formulario una sola vez (4 px a cada lado)
  useEffect(() => {
    if (!error || reducido) return;
    const d = TEMBLOR.distancia;
    temblor.start({ x: [0, -d, d, -d, d, 0], transition: { duration: TEMBLOR.duracion } });
  }, [error, reducido, temblor]);

  const ingresar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const correo = email.trim();
    if (!correo) return setError({ campo: 'email', texto: 'Escribe tu correo.' });
    if (!password) return setError({ campo: 'password', texto: 'Escribe tu contraseña.' });
    setCargando(true);
    onRolElegido(rol);
    try {
      if (registro) await createUserWithEmailAndPassword(auth, correo, password);
      else await signInWithEmailAndPassword(auth, correo, password);
      // La app entra sola cuando la sesión queda activa
    } catch (err: any) {
      console.warn('Ingreso:', err?.code || err?.message);
      const texto = mensajeError(err);
      setError({ campo: err?.code === 'auth/invalid-email' ? 'email' : err?.code === 'auth/weak-password' ? 'password' : 'general', texto });
      setCargando(false);
    }
  };

  const ingresarGoogle = async () => {
    setError(null);
    setAviso(null);
    setCargando(true);
    onRolElegido(rol);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') setError({ campo: 'general', texto: mensajeError(err) });
      setCargando(false);
    }
  };

  const recuperar = async () => {
    setError(null);
    setAviso(null);
    const correo = email.trim();
    if (!correo) return setError({ campo: 'email', texto: 'Escribe tu correo y vuelve a pulsar "Olvidé mi contraseña".' });
    setCargando(true);
    try {
      await sendPasswordResetEmail(auth, correo);
      setAviso(`Si ${correo} tiene una cuenta con contraseña, te llegará un correo para restablecerla. Revisa también el correo no deseado.`);
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        setAviso(`Si ${correo} tiene una cuenta con contraseña, te llegará un correo para restablecerla. Revisa también el correo no deseado.`);
      } else {
        setError({ campo: err?.code === 'auth/invalid-email' ? 'email' : 'general', texto: mensajeError(err) });
      }
    } finally {
      setCargando(false);
    }
  };

  const bloque = (i: number) => ({
    initial: { opacity: 0, y: reducido ? 0 : DISTANCIA.tarjeta },
    animate: { opacity: 1, y: 0, transition: { duration: reducido ? DURACION.reducido : DURACION.entrada, ease: CURVA.entrada, delay: reducido ? 0 : i * ESCALON_BLOQUES } }
  });
  const anillo =
    'w-full min-h-11 px-3 text-base sm:text-sm border rounded-md bg-white outline-none transition-[box-shadow,border-color] duration-150 focus:ring-2 focus:ring-sky-500 focus:border-sky-500';

  return (
    <div className="min-h-dvh bg-white grid lg:grid-cols-[5fr_7fr]">
      {/* Identidad */}
      <motion.aside {...bloque(0)} className="bg-slate-900 text-white px-6 py-6 lg:px-14 lg:py-14 flex lg:flex-col lg:justify-between gap-4">
        <div className="flex items-center gap-3">
          <LogoLore className="w-12 h-10 lg:w-16 lg:h-12 text-amber-400" />
          <div>
            <p className="font-serif text-2xl lg:text-4xl leading-tight">Cultivos Loré</p>
            <p className="rotulo text-slate-300">Trazabilidad Tilapia Pro</p>
          </div>
        </div>
        <div className="hidden lg:block max-w-md">
          <p className="font-serif text-2xl leading-snug text-slate-100">
            Cada lote de tilapia roja, de la siembra a la mesa, con su historia firmada y verificable.
          </p>
          <div className="mt-6 border-t-[3px] border-double border-amber-500 w-24" />
          <p className="mt-6 text-sm text-slate-300">Turbaco, Bolívar, Colombia</p>
        </div>
      </motion.aside>

      {/* Formulario */}
      <motion.main {...bloque(1)} className="flex items-start lg:items-center justify-center px-4 py-8 sm:px-8">
        <motion.form animate={temblor} onSubmit={ingresar} noValidate className="w-full max-w-sm space-y-5" aria-describedby={error?.campo === 'general' ? 'error-ingreso' : undefined}>
          <div>
            <h1 className="text-2xl text-slate-900">{registro ? 'Crear cuenta' : 'Ingresar'}</h1>
            <p className="text-sm text-slate-600 mt-1">
              {registro ? 'El administrador aprobará tu cuenta antes de que puedas trabajar.' : 'Usa la cuenta que te autorizó el administrador.'}
            </p>
          </div>

          {/* Rol: control segmentado con indicador deslizante */}
          <fieldset>
            <legend className="text-sm font-medium text-slate-800 mb-2">Ingresar como</legend>
            <LayoutGroup id="rol-ingreso">
              <div role="radiogroup" className="grid grid-cols-2 rounded-md bg-slate-100 p-1">
                {ROLES.map((r) => {
                  const sel = r.id === rol;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      onClick={() => setRol(r.id)}
                      className={`pestana relative min-h-11 rounded-md text-sm font-semibold ${sel ? 'text-white' : 'text-slate-700 hover:text-slate-900'}`}
                    >
                      {sel && (
                        <motion.span
                          layoutId="rol-ingreso-indicador"
                          transition={reducido ? { duration: 0 } : RESORTE}
                          aria-hidden="true"
                          className="absolute inset-0 rounded-md bg-slate-900"
                        />
                      )}
                      <span className="relative inline-flex items-center justify-center gap-2">
                        {r.icono}
                        {r.etiqueta}
                      </span>
                    </button>
                  );
                })}
              </div>
            </LayoutGroup>
          </fieldset>

          <div>
            <label htmlFor="ingreso-correo" className="block text-sm font-medium text-slate-800 mb-2">
              Correo
            </label>
            <input
              id="ingreso-correo"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error?.campo === 'email'}
              aria-describedby={error?.campo === 'email' ? 'error-correo' : undefined}
              className={`${anillo} ${error?.campo === 'email' ? 'border-red-500' : 'border-slate-300'}`}
            />
            {error?.campo === 'email' && (
              <p id="error-correo" className="text-sm text-red-700 mt-2">
                {error.texto}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label htmlFor="ingreso-clave" className="text-sm font-medium text-slate-800">
                Contraseña
              </label>
              {!registro && (
                <button type="button" onClick={recuperar} disabled={cargando} className="text-sm text-sky-700 hover:underline">
                  Olvidé mi contraseña
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="ingreso-clave"
                type={verClave ? 'text' : 'password'}
                autoComplete={registro ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error?.campo === 'password'}
                aria-describedby={error?.campo === 'password' ? 'error-clave' : undefined}
                className={`${anillo} pr-12 ${error?.campo === 'password' ? 'border-red-500' : 'border-slate-300'}`}
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={verClave}
                className="absolute right-0 top-0 h-full min-w-11 grid place-items-center text-slate-600 hover:text-slate-900"
              >
                {verClave ? <EyeOff className="w-5 h-5" strokeWidth={1.75} /> : <Eye className="w-5 h-5" strokeWidth={1.75} />}
              </button>
            </div>
            {error?.campo === 'password' ? (
              <p id="error-clave" className="text-sm text-red-700 mt-2">
                {error.texto}
              </p>
            ) : (
              registro && <p className="text-sm text-slate-600 mt-2">Mínimo 6 caracteres.</p>
            )}
          </div>

          {error?.campo === 'general' && (
            <p id="error-ingreso" role="alert" className="flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-1 shrink-0" strokeWidth={1.75} />
              {error.texto}
            </p>
          )}
          {aviso && (
            <p role="status" className="flex items-start gap-2 text-sm text-emerald-700">
              <CheckCircle className="w-4 h-4 mt-1 shrink-0" strokeWidth={1.75} />
              {aviso}
            </p>
          )}

          <button
            type="submit"
            disabled={cargando}
            aria-busy={cargando}
            className="relative w-full min-h-11 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors disabled:opacity-80"
          >
            <span className={cargando ? 'opacity-0' : ''}>{registro ? 'Crear cuenta' : 'Ingresar'}</span>
            {cargando && (
              <span className="absolute inset-0 grid place-items-center" aria-hidden="true">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={ingresarGoogle}
            disabled={cargando}
            className="w-full min-h-11 rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continuar con Google
          </button>

          <p className="text-sm text-slate-600 text-center">
            {registro ? '¿Ya tienes cuenta?' : '¿Eres nuevo en la granja?'}{' '}
            <button
              type="button"
              onClick={() => {
                setRegistro((v) => !v);
                setError(null);
                setAviso(null);
              }}
              className="font-semibold text-sky-700 hover:underline"
            >
              {registro ? 'Ingresar' : 'Crear cuenta'}
            </button>
          </p>
        </motion.form>
      </motion.main>
    </div>
  );
};

