import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db } from './firebase/firebaseConfig';
import { Lote, ConfiguracionGeneral, UsuarioPerfil, RolFuncional } from './types';
import { CONFIG_DEFAULT } from './utils/constants';
import { escucharConfiguracion } from './services/configService';
import { escucharLotes } from './services/lotesService';
import {
  sincronizarPerfilUsuario,
  escucharPerfilPropio,
  esAdminMaestro,
  funcionesDisponibles
} from './services/usuariosService';

import { Navbar, TabTipo, tabsDeFuncion } from './components/Navbar';
import { SelectorFuncion } from './components/SelectorFuncion';
import { RepartidorPanel } from './components/RepartidorPanel';
import { PedidosTab } from './components/PedidosTab';
import { DashboardTab } from './components/DashboardTab';
import { LotesTab } from './components/LotesTab';
import { AnaliticaTab } from './components/AnaliticaTab';
import { ConfiguracionTab } from './components/ConfiguracionTab';
import { UsuariosTab } from './components/UsuariosTab';
import { AuthModal } from './components/AuthModal';
import { NuevoLoteModal } from './components/NuevoLoteModal';
import { LoteDetailModal } from './components/LoteDetailModal';
import { QrModal } from './components/QrModal';
import { PublicTraceabilityView } from './components/PublicTraceabilityView';
import { AlertCircle, Lock, Crown, ShieldAlert, Users } from 'lucide-react';

const SESION_STORAGE_KEY_ANTIGUA = 'cultivos_lore_sesion_activa';

// Función elegida por cada cuenta en este navegador. Solo decide qué se muestra; los permisos
// reales los aplica Firestore según los roles asignados.
const claveFuncion = (uid: string) => `cultivos_lore_funcion_${uid}`;

function leerFuncionGuardada(uid: string): string | null {
  try {
    return localStorage.getItem(claveFuncion(uid));
  } catch {
    return null;
  }
}

function guardarFuncion(uid: string, funcion: RolFuncional | null): void {
  try {
    if (funcion) localStorage.setItem(claveFuncion(uid), funcion);
    else localStorage.removeItem(claveFuncion(uid));
  } catch {}
}

interface UsuarioSesion {
  uid: string;
  email: string;
  displayName: string;
}

export default function App() {
  const [tabActiva, setTabActiva] = useState<TabTipo>('inicio');

  // Si se ingresó mediante escaneo de QR (con parámetro ?lote=...), mostrar vista pública
  const [lotePublicoCodigo, setLotePublicoCodigo] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('lote');
    }
    return null;
  });

  // La sesión la determina únicamente Firebase Authentication
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);

  const [perfilUsuario, setPerfilUsuario] = useState<UsuarioPerfil | null>(null);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [authCargando, setAuthCargando] = useState(true);

  const [config, setConfig] = useState<ConfiguracionGeneral>(CONFIG_DEFAULT);
  const [lotes, setLotes] = useState<Lote[]>(() => {
    try {
      const cached = localStorage.getItem('cultivos_lore_lotes_backup');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });
  const [lotesCargando, setLotesCargando] = useState(true);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);

  // Modales
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [nuevoLoteModalOpen, setNuevoLoteModalOpen] = useState(false);
  const [loteDetalle, setLoteDetalle] = useState<Lote | null>(null);
  const [loteQr, setLoteQr] = useState<Lote | null>(null);

  const esAdmin = esAdminMaestro(usuario?.email);

  // Funciones (roles) con las que la cuenta puede trabajar y la elegida en esta sesión
  const [funcionActiva, setFuncionActiva] = useState<RolFuncional | null>(null);
  const funciones = usuario ? funcionesDisponibles(perfilUsuario) : [];
  const clavefunciones = funciones.join(',');
  const mostrarSelectorFuncion = Boolean(usuario) && funciones.length > 1 && !funcionActiva;
  const puedeVerProduccion = funcionActiva === 'admin' || funcionActiva === 'operator';

  // 1. Elegir la función: directa si solo hay una; la guardada si sigue asignada; si no, el selector
  useEffect(() => {
    if (!usuario || funciones.length === 0) {
      setFuncionActiva(null);
      return;
    }
    if (funciones.length === 1) {
      setFuncionActiva(funciones[0]);
      return;
    }
    setFuncionActiva((actual) => {
      if (actual && funciones.includes(actual)) return actual;
      const guardada = leerFuncionGuardada(usuario.uid) as RolFuncional | null;
      return guardada && funciones.includes(guardada) ? guardada : null;
    });
  }, [usuario?.uid, clavefunciones]);

  // Mantener la pestaña dentro de las de la función activa
  useEffect(() => {
    const permitidas = tabsDeFuncion(funcionActiva);
    if (!permitidas.includes(tabActiva)) setTabActiva(permitidas[0]);
    if (funcionActiva !== 'admin' && funcionActiva !== 'operator') {
      setLoteDetalle(null);
      setLoteQr(null);
      setNuevoLoteModalOpen(false);
    }
  }, [funcionActiva]);

  const handleSeleccionarFuncion = (funcion: RolFuncional) => {
    if (!usuario || !funciones.includes(funcion)) return;
    guardarFuncion(usuario.uid, funcion);
    setFuncionActiva(funcion);
    setTabActiva(tabsDeFuncion(funcion)[0]);
  };

  const handleCambiarFuncion = () => {
    if (usuario) guardarFuncion(usuario.uid, null);
    setFuncionActiva(null);
  };


  // 2. Escuchar cambios de autenticación de Firebase
  useEffect(() => {
    try {
      localStorage.removeItem(SESION_STORAGE_KEY_ANTIGUA);
    } catch {}

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUsuario(null);
        setPerfilUsuario(null);
        setErrorPerfil(null);
        setAuthCargando(false);
        return;
      }

      // Validar si el token es accesible o si requiere reautenticación
      try {
        await fbUser.getIdToken();
      } catch (tokenErr) {
        console.warn('Sesión previa inválida, restableciendo autenticación limpia:', tokenErr);
        try {
          await signOut(auth);
        } catch {}
        setUsuario(null);
        setPerfilUsuario(null);
        setAuthCargando(false);
        return;
      }

      setUsuario({
        uid: fbUser.uid,
        email: fbUser.email || '',
        displayName: fbUser.displayName || fbUser.email?.split('@')[0] || ''
      });
      setAuthCargando(false);

      try {
        const perfil = await sincronizarPerfilUsuario(fbUser);
        setPerfilUsuario(perfil);
        setErrorPerfil(null);
      } catch (err) {
        console.warn('Sincronización perfil:', err);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2b. Mantener el perfil propio al día (roles, nombres de función y estado) una vez sincronizado
  const perfilSincronizado = Boolean(perfilUsuario);
  useEffect(() => {
    if (!usuario?.uid || !perfilSincronizado) return;
    return escucharPerfilPropio(usuario.uid, (perfil) => setPerfilUsuario(perfil));
  }, [usuario?.uid, perfilSincronizado]);

  // 3. Escuchar configuración en tiempo real
  useEffect(() => {
    const unsubConfig = escucharConfiguracion(
      (nuevaConfig) => {
        if (nuevaConfig) {
          setConfig(nuevaConfig);
        }
      },
      (err) => {
        console.warn('Error escuchando configuración:', err);
      }
    );
    return () => unsubConfig();
  }, []);

  // 4. Escuchar en tiempo real los lotes de la granja (permanentes en vivo). Solo para las
  // funciones de producción: Firestore no permite listarlos a los demás.
  useEffect(() => {
    if (!puedeVerProduccion) {
      setLotes([]);
      setLotesCargando(false);
      setErrorConexion(null);
      return;
    }
    setLotesCargando(true);
    const unsubLotes = escucharLotes(
      (listaLotes) => {
        setLotes(listaLotes);
        setLotesCargando(false);
        setErrorConexion(null);
        try {
          localStorage.setItem('cultivos_lore_lotes_backup', JSON.stringify(listaLotes));
        } catch {}

        // Si hay un lote abierto en detalle, mantenerlo actualizado en vivo
        if (loteDetalle) {
          const actualizado = listaLotes.find((l) => l.codigo === loteDetalle.codigo);
          if (actualizado) {
            setLoteDetalle(actualizado);
          }
        }
      },
      (err) => {
        console.warn('Error escuchando lotes en Firestore:', err);
        setLotesCargando(false);
        setErrorConexion(
          err?.code === 'permission-denied'
            ? 'No tienes permiso para consultar los lotes de la granja.'
            : 'No fue posible sincronizar los lotes en vivo con Firestore.'
        );
      }
    );

    return () => unsubLotes();
  }, [puedeVerProduccion]);

  const handleCerrarSesion = async () => {
    // Al volver a ingresar, una cuenta con varias funciones elige de nuevo
    if (usuario) guardarFuncion(usuario.uid, null);
    // La copia local de los lotes no queda en el navegador para la siguiente persona
    try {
      localStorage.removeItem('cultivos_lore_lotes_backup');
    } catch {}
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Error al cerrar sesión:', err);
    }
    setUsuario(null);
    setPerfilUsuario(null);
    setFuncionActiva(null);
  };

  const accesoRestringido = (
    <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-6 flex items-start space-x-3 text-xs text-slate-700">
      <Lock className="w-5 h-5 text-slate-400 shrink-0" />
      <div>
        <p className="font-bold text-sm text-slate-900">Información productiva restringida</p>
        <p className="mt-1">
          {!usuario
            ? 'Ingresa al sistema con una cuenta autorizada para consultar los lotes de la granja.'
            : 'Tu cuenta no tiene una función de producción autorizada. Si crees que es un error, contacta al administrador.'}
        </p>
      </div>
    </div>
  );

  const handleAbrirNuevoLote = () => {
    if (!usuario) {
      setAuthModalOpen(true);
      return;
    }
    setNuevoLoteModalOpen(true);
  };

  const handleLoteCreado = (nuevoLote: Lote) => {
    setLoteDetalle(nuevoLote);
  };

  // Si se detectó un código de lote por escaneo de QR en la URL, mostrar vista pública interactiva
  if (lotePublicoCodigo) {
    const loteEncontrado = lotes.find(
      (l) => l.codigo === lotePublicoCodigo || l.codigo.toUpperCase() === lotePublicoCodigo.toUpperCase()
    );

    return (
      <PublicTraceabilityView
        codigoLote={lotePublicoCodigo}
        loteInicial={loteEncontrado}
        config={config}
        onVolverAlPanel={() => {
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', window.location.pathname);
          }
          setLotePublicoCodigo(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      {/* NAVBAR */}
      <Navbar
        tabActiva={tabActiva}
        setTabActiva={setTabActiva}
        usuario={usuario as User}
        perfilUsuario={perfilUsuario}
        funcionActiva={funcionActiva}
        puedeCambiarFuncion={funciones.length > 1 && Boolean(funcionActiva)}
        eligiendoFuncion={mostrarSelectorFuncion}
        onCambiarFuncion={handleCambiarFuncion}
        onAbrirAuth={() => setAuthModalOpen(true)}
        onCerrarSesion={handleCerrarSesion}
        onNuevoLote={handleAbrirNuevoLote}
      />

      {/* BANNER 1: SI NO HA INICIADO SESIÓN */}
      {!usuario && !authCargando && (
        <div className="bg-sky-950 text-sky-100 px-4 py-2.5 text-xs border-b border-sky-800">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <Lock className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                <strong>Modo Consulta:</strong> Para ver los lotes de la granja, crear lotes o registrar eventos debes ingresar. Carlos (<strong>carlosbs1579@gmail.com</strong>) tiene acceso de Administrador Maestro.
              </span>
            </div>
            <button
              onClick={() => setAuthModalOpen(true)}
              className="px-3.5 py-1 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-md shadow-xs transition-colors shrink-0"
            >
              Ingresar al sistema
            </button>
          </div>
        </div>
      )}

      {/* BANNER 2: SESIÓN DE ADMINISTRADOR MAESTRO (CARLOS), TRABAJANDO COMO ADMINISTRADOR */}
      {usuario && esAdmin && funcionActiva === 'admin' && (
        <div className="bg-amber-500/10 border-b border-amber-400/30 px-4 py-2 text-xs text-amber-900">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Crown className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Sesión Administrador Maestro (Carlos):</strong> Tienes control total en Cultivos Loré. Puedes otorgar cargos y autorizaciones en la pestaña <strong>"Personal & Permisos"</strong>.
              </span>
            </div>
            <button
              onClick={() => setTabActiva('usuarios')}
              className="text-amber-800 hover:text-amber-950 underline font-semibold text-[11px] shrink-0 ml-2 flex items-center space-x-1"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Gestionar Personal</span>
            </button>
          </div>
        </div>
      )}

      {/* BANNER 3: SI EL USUARIO ESTÁ PENDIENTE DE APROBACIÓN */}
      {usuario && !esAdmin && perfilUsuario?.estado === 'pendiente' && (
        <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 text-xs text-amber-900">
          <div className="max-w-7xl mx-auto flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Perfil Pendiente:</strong> Tu cuenta ({usuario.email}) ha sido registrada pero aún no ha sido autorizada por Carlos (<strong>carlosbs1579@gmail.com</strong>). Tan pronto Carlos te autorice en la pestaña "Personal & Permisos", tendrás acceso operativo.
            </span>
          </div>
        </div>
      )}

      {/* BANNER 4: SI EL USUARIO FUE DESACTIVADO */}
      {usuario && !esAdmin && perfilUsuario?.estado === 'inactivo' && (
        <div className="bg-slate-200 border-b border-slate-300 px-4 py-2 text-xs text-slate-800">
          <div className="max-w-7xl mx-auto flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-slate-600 shrink-0" />
            <span>
              <strong>Cuenta inactiva:</strong> Tu cuenta ({usuario.email}) no tiene acceso a los lotes de la granja. Contacta al administrador si crees que es un error.
            </span>
          </div>
        </div>
      )}

      {/* BANNER 5: CUENTA ACTIVA SIN FUNCIONES ASIGNADAS */}
      {usuario && perfilUsuario && perfilUsuario.estado === 'activo' && funciones.length === 0 && (
        <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 text-xs text-amber-900">
          <div className="max-w-7xl mx-auto flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Sin funciones asignadas:</strong> Tu cuenta ({usuario.email}) está autorizada, pero aún no tiene una función (operador o repartidor). El administrador debe asignártela en "Personal & Permisos".
            </span>
          </div>
        </div>
      )}

      {/* ERROR AL CARGAR EL PERFIL OPERATIVO */}
      {usuario && errorPerfil && (
        <div className="bg-red-600 text-white px-4 py-2 text-xs flex items-center justify-center space-x-2">
          <AlertCircle className="w-4 h-4" />
          <span>{errorPerfil}</span>
        </div>
      )}

      {/* ERROR DE CONEXIÓN */}
      {errorConexion && (
        <div className="bg-red-600 text-white px-4 py-2 text-xs flex items-center justify-center space-x-2">
          <AlertCircle className="w-4 h-4" />
          <span>{errorConexion}</span>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL SEGÚN PESTAÑA SELECCIONADA */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* SELECCIÓN DE FUNCIÓN (CUENTAS CON VARIOS ROLES) */}
        {mostrarSelectorFuncion && perfilUsuario && (
          <SelectorFuncion
            perfil={perfilUsuario}
            funciones={funciones}
            onSeleccionar={handleSeleccionarFuncion}
            onCerrarSesion={handleCerrarSesion}
          />
        )}

        {!mostrarSelectorFuncion && (
        <>
        {/* PANEL DE REPARTO */}
        {tabActiva === 'reparto' && funcionActiva === 'courier' && perfilUsuario && (
          <RepartidorPanel perfil={perfilUsuario} />
        )}

        {/* SIN FUNCIÓN DE PRODUCCIÓN: SIN ACCESO A LOTES */}
        {!puedeVerProduccion && (tabActiva === 'inicio' || tabActiva === 'lotes' || tabActiva === 'pedidos' || tabActiva === 'analitica') && accesoRestringido}

        {puedeVerProduccion && (
        <>
        {/* 1. INICIO */}
        {tabActiva === 'inicio' && (
          <DashboardTab
            lotes={lotes}
            config={config}
            onNuevoLote={handleAbrirNuevoLote}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
            onAbrirQr={(lote) => setLoteQr(lote)}
          />
        )}

        {/* 2. LOTES */}
        {tabActiva === 'lotes' && (
          <LotesTab
            lotes={lotes}
            config={config}
            onNuevoLote={handleAbrirNuevoLote}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
            onAbrirQr={(lote) => setLoteQr(lote)}
          />
        )}

        {/* PEDIDOS: ÓRDENES DE ENTREGA VINCULADAS A LOS LOTES */}
        {tabActiva === 'pedidos' && (
          <PedidosTab lotes={lotes} perfilActual={perfilUsuario} />
        )}

        {/* 3. ANALÍTICA */}
        {tabActiva === 'analitica' && (
          <AnaliticaTab
            lotes={lotes}
            config={config}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
          />
        )}
        </>
        )}

        {/* 4. CONFIGURACIÓN DE GRANJA Y ESTANQUES */}
        {tabActiva === 'configuracion' && (
          <ConfiguracionTab
            config={config}
            userEmail={usuario?.email || ''}
            perfilActual={perfilUsuario}
            onConfigActualizada={(nuevaConfig) => setConfig(nuevaConfig)}
          />
        )}

        {/* 5. GESTIÓN DE PERSONAL Y PERMISOS (NUEVA PESTAÑA DEDICADA) */}
        {tabActiva === 'usuarios' && (
          <UsuariosTab
            userEmail={usuario?.email || ''}
            perfilActual={perfilUsuario}
            gestionHabilitada={funcionActiva === 'admin'}
          />
        )}
        </>
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 py-6 text-xs text-center">
        <div className="max-w-7xl mx-auto px-4">
          <p className="font-semibold text-slate-300">
            Cultivos Loré — Granja de Tilapia Roja en Turbaco (Bolívar, Colombia)
          </p>
          <p className="text-slate-500 mt-1">
            Producto: Tilapia roja entera fresca, limpia (escamada y eviscerada), calibre 450 a 500 g • Modalidad Tilapia Pro
          </p>
          <p className="text-[11px] text-slate-500 mt-2">
            Este registro documenta cómo se produjo y manejó el lote; no reemplaza los controles de inocuidad.
          </p>
        </div>
      </footer>

      {/* MODALES */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />

      {usuario && (
        <NuevoLoteModal
          isOpen={nuevoLoteModalOpen}
          onClose={() => setNuevoLoteModalOpen(false)}
          config={config}
          userEmail={usuario.email}
          perfilActual={perfilUsuario}
          onLoteCreado={handleLoteCreado}
        />
      )}

      {loteDetalle && (
        <LoteDetailModal
          isOpen={Boolean(loteDetalle)}
          onClose={() => setLoteDetalle(null)}
          loteInicial={loteDetalle}
          config={config}
          userEmail={usuario?.email || ''}
          perfilActual={perfilUsuario}
          onLoteActualizado={(loteActualizado) => setLoteDetalle(loteActualizado)}
          onAbrirVistaPublica={(codigo) => {
            setLoteDetalle(null);
            setLotePublicoCodigo(codigo);
            if (typeof window !== 'undefined') {
              window.history.pushState({}, '', `/?lote=${encodeURIComponent(codigo)}`);
            }
          }}
        />
      )}

      {loteQr && (
        <QrModal
          isOpen={Boolean(loteQr)}
          onClose={() => setLoteQr(null)}
          lote={loteQr}
          config={config}
          onAbrirVistaPublica={(codigo) => {
            setLoteQr(null);
            setLotePublicoCodigo(codigo);
            if (typeof window !== 'undefined') {
              window.history.pushState({}, '', `/?lote=${encodeURIComponent(codigo)}`);
            }
          }}
        />
      )}
    </div>
  );
}
