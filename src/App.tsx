import React, { useState, useEffect, useLayoutEffect, Suspense, lazy, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EsqueletoPantalla } from './components/Esqueleto';
import { PantallaVerificando } from './components/PantallaVerificando';
const PantallaIngreso = lazy(() => import('./components/PantallaIngreso').then((m) => ({ default: m.PantallaIngreso })));
import { DISTANCIA, DURACION, VAR_CONTENIDO_TAB, entrada, salida } from './lib/motion';
import { LimiteError, recargarUnaVez } from './components/LimiteError';
import { useConservar, usePresencia } from './lib/presencia';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db } from './firebase/firebaseConfig';
import { Lote, ConfiguracionGeneral, UsuarioPerfil, RolFuncional } from './types';
import { CONFIG_DEFAULT } from './utils/constants';
import { escucharConfiguracion } from './services/configService';
import { escucharLotes } from './services/lotesService';
import { establecerFuncionActiva } from './services/pedidosService';
import {
  sincronizarPerfilUsuario,
  escucharPerfilPropio,
  esAdminMaestro,
  funcionesDisponibles,
  verificarPermiso,
  establecerNombreSesion
} from './services/usuariosService';

import { Navbar, TabTipo, tabsDeFuncion } from './components/Navbar';
import { SelectorFuncion } from './components/SelectorFuncion';
import { DashboardTab } from './components/DashboardTab';

// Pestañas que no se usan al abrir la app: se descargan la primera vez que se abren
const RepartidorPanel = lazy(() => import('./components/RepartidorPanel').then((m) => ({ default: m.RepartidorPanel })));
const PedidosTab = lazy(() => import('./components/PedidosTab').then((m) => ({ default: m.PedidosTab })));
const AnaliticaTab = lazy(() => import('./components/AnaliticaTab').then((m) => ({ default: m.AnaliticaTab })));
const ConfiguracionTab = lazy(() => import('./components/ConfiguracionTab').then((m) => ({ default: m.ConfiguracionTab })));
const UsuariosTab = lazy(() => import('./components/UsuariosTab').then((m) => ({ default: m.UsuariosTab })));
const ConsultaEntregaPublica = lazy(() =>
  import('./components/ConsultaEntregaPublica').then((m) => ({ default: m.ConsultaEntregaPublica }))
);

const Cargando = () => <EsqueletoPantalla />;
import { LotesTab } from './components/LotesTab';
import { AuthModal } from './components/AuthModal';
import { NuevoLoteModal } from './components/NuevoLoteModal';
// El detalle del lote se descarga al abrirlo por primera vez (mantiene el paquete inicial bajo 500 kB)
const LoteDetailModal = lazy(() => import('./components/LoteDetailModal').then((m) => ({ default: m.LoteDetailModal })));
import { QrModal } from './components/QrModal';
import { PublicTraceabilityView } from './components/PublicTraceabilityView';
import { AlertCircle, Lock, Shield, ShieldAlert } from 'lucide-react';

const SESION_STORAGE_KEY_ANTIGUA = 'cultivos_lore_sesion_activa';

// Función elegida por cada cuenta en este navegador. Solo decide qué se muestra; los permisos
// reales los aplica Firestore según los roles asignados.
const claveFuncion = (uid: string) => `cultivos_lore_funcion_${uid}`;

/**
 * Borra las copias locales de perfiles y de "mis entregas" (nombres, direcciones y teléfonos de
 * clientes) de toda cuenta distinta de `conservarUid`; con null, las de todas (H50). La bandeja de
 * acciones del repartidor sin enviar se conserva para no perderlas.
 */
function limpiarCopiasLocales(conservarUid: string | null): void {
  try {
    localStorage.removeItem('cultivos_lore_lotes_backup');
    const prefijos = ['cultivos_lore_perfil_', 'cultivos_lore_mis_entregas_'];
    const borrar: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (!clave) continue;
      const prefijo = prefijos.find((p) => clave.startsWith(p));
      if (prefijo && clave.slice(prefijo.length) !== conservarUid) borrar.push(clave);
    }
    borrar.forEach((clave) => localStorage.removeItem(clave));
  } catch {}
}

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
  // Dirección del cambio de pestaña (1 avanza, -1 retrocede) y posición de scroll de cada pestaña
  const tabAnterior = useRef<TabTipo>('inicio');
  const scrollPorTab = useRef<Partial<Record<TabTipo, number>>>({});
  const ORDEN_TABS: TabTipo[] = ['inicio', 'lotes', 'pedidos', 'analitica', 'configuracion', 'usuarios', 'reparto'];
  const direccionTab = ORDEN_TABS.indexOf(tabActiva) >= ORDEN_TABS.indexOf(tabAnterior.current) ? 1 : -1;
  // Pestaña cuyo scroll se está registrando; nula mientras se cambia de pestaña, para que el recorte
  // que hace el navegador al cambiar la altura de la página no pise la posición guardada (H31)
  const tabMedida = useRef<TabTipo | null>('inicio');
  useEffect(() => {
    const alDesplazar = () => {
      if (tabMedida.current) scrollPorTab.current[tabMedida.current] = window.scrollY;
    };
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => window.removeEventListener('scroll', alDesplazar);
  }, []);
  useLayoutEffect(() => {
    tabAnterior.current = tabActiva;
    tabMedida.current = null;
    const y = scrollPorTab.current[tabActiva] ?? 0;
    // Se restaura cuando la pestaña nueva ya está montada con su contenido real (sin esqueletos) y la
    // página alcanza la altura necesaria; se renuncia a los 2 s o si la persona se desplaza antes
    const inicio = performance.now();
    let raf = 0;
    const terminar = () => {
      cancelAnimationFrame(raf);
      quitarEscuchas();
      tabMedida.current = tabActiva;
    };
    const intento = () => {
      const main = document.querySelector(`main[data-tab="${tabActiva}"]`);
      const listo = main && !main.querySelector('.esqueleto');
      const alcanza = document.documentElement.scrollHeight - window.innerHeight >= y - 1;
      if (listo && (alcanza || y === 0)) {
        window.scrollTo({ top: y });
        terminar();
        return;
      }
      if (performance.now() - inicio > 2000) {
        if (main) window.scrollTo({ top: Math.min(y, document.documentElement.scrollHeight - window.innerHeight) });
        terminar();
        return;
      }
      raf = requestAnimationFrame(intento);
    };
    const porLaPersona = () => terminar();
    const EVENTOS = ['wheel', 'touchstart', 'keydown'] as const;
    const quitarEscuchas = () => EVENTOS.forEach((ev) => window.removeEventListener(ev, porLaPersona));
    EVENTOS.forEach((ev) => window.addEventListener(ev, porLaPersona, { passive: true }));
    raf = requestAnimationFrame(intento);
    return () => {
      cancelAnimationFrame(raf);
      quitarEscuchas();
    };
  }, [tabActiva]);

  // Tras un despliegue nuevo los paquetes viejos ya no existen: se recarga una sola vez (H33)
  useEffect(() => {
    const alFallarPaquete = (e: Event) => {
      if (recargarUnaVez()) e.preventDefault();
    };
    window.addEventListener('vite:preloadError', alFallarPaquete);
    return () => window.removeEventListener('vite:preloadError', alFallarPaquete);
  }, []);

  // Si se ingresó mediante escaneo de QR (con parámetro ?lote=...), mostrar vista pública
  const [lotePublicoCodigo, setLotePublicoCodigo] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('lote');
    }
    return null;
  });

  // Consulta pública de una entrega (QR del comprobante, ?entrega=CODIGO)
  const [entregaPublicaToken, setEntregaPublicaToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('entrega');
    }
    return null;
  });

  // La sesión la determina únicamente Firebase Authentication
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);

  const [perfilUsuario, setPerfilUsuario] = useState<UsuarioPerfil | null>(null);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [authCargando, setAuthCargando] = useState(true);

  const [config, setConfig] = useState<ConfiguracionGeneral>(CONFIG_DEFAULT);
  // Los lotes se leen solo de Firestore en vivo. La copia completa que se guardaba en localStorage
  // (todos los lotes con sus fases) crecía sin límite y nunca se llegaba a usar (H54): se retira.
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [lotesCargando, setLotesCargando] = useState(true);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);

  // Modales
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [nuevoLoteModalOpen, setNuevoLoteModalOpen] = useState(false);
  const [loteDetalle, setLoteDetalle] = useState<Lote | null>(null);
  // Se conserva unos milisegundos al cerrar para que la ventana termine de desvanecerse
  const loteDetalleVisible = useConservar(loteDetalle);
  const [loteQr, setLoteQr] = useState<Lote | null>(null);
  const loteQrVisible = useConservar(loteQr);

  const esAdmin = esAdminMaestro(usuario?.email);

  // Funciones (roles) con las que la cuenta puede trabajar y la elegida en esta sesión
  const [funcionActiva, setFuncionActiva] = useState<RolFuncional | null>(null);
  // Función elegida en la pantalla de ingreso: es solo una preferencia; se aplica si la cuenta la tiene
  const [funcionPedida, setFuncionPedida] = useState<RolFuncional | null>(null);
  const [avisoFuncionPedida, setAvisoFuncionPedida] = useState<string | null>(null);
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
  }, [usuario?.uid, clavefunciones, perfilUsuario?.uid]);

  // 1b. Preferencia elegida en el ingreso. El perfil puede llegar en dos pasos (primero la copia
  // sincronizada, luego la de tiempo real con todos los roles), así que se aplica en cuanto la cuenta
  // tiene la función; el aviso solo aparece si después de unos segundos sigue sin tenerla.
  useEffect(() => {
    if (!funcionPedida || !usuario || !perfilUsuario) return;
    const aplicable = funciones.includes(funcionPedida)
      ? funcionPedida
      : funcionPedida === 'operator' && funciones.includes('admin')
      ? 'admin'
      : null;
    if (aplicable) {
      setFuncionPedida(null);
      setAvisoFuncionPedida(null);
      guardarFuncion(usuario.uid, aplicable);
      setFuncionActiva(aplicable);
      return;
    }
    const t = setTimeout(() => {
      setFuncionPedida(null);
      setAvisoFuncionPedida(
        `Tu cuenta no tiene la función de ${funcionPedida === 'courier' ? 'repartidor' : 'operador'}. Entraste con las funciones que te asignó el administrador.`
      );
    }, 3000);
    return () => clearTimeout(t);
  }, [funcionPedida, usuario?.uid, clavefunciones, Boolean(perfilUsuario)]);

  // Los registros nuevos guardan el nombre visible de quien los hace (no solo el correo)
  useEffect(() => {
    establecerNombreSesion(perfilUsuario?.displayName);
  }, [perfilUsuario?.displayName]);

  // Mantener la pestaña dentro de las de la función activa
  useEffect(() => {
    establecerFuncionActiva(funcionActiva);
    const permitidas = tabsDeFuncion(funcionActiva, perfilUsuario);
    if (!permitidas.includes(tabActiva)) setTabActiva(permitidas[0]);
    if (funcionActiva !== 'admin' && funcionActiva !== 'operator') {
      setLoteDetalle(null);
      setLoteQr(null);
      setNuevoLoteModalOpen(false);
    }
  }, [funcionActiva, perfilUsuario]);

  const handleSeleccionarFuncion = (funcion: RolFuncional) => {
    if (!usuario || !funciones.includes(funcion)) return;
    guardarFuncion(usuario.uid, funcion);
    setFuncionActiva(funcion);
    setTabActiva(tabsDeFuncion(funcion, perfilUsuario)[0]);
  };

  // Aviso breve de la función con la que se está trabajando (en lugar de una barra fija)
  const [avisoFuncion, setAvisoFuncion] = useState<string | null>(null);
  useEffect(() => {
    if (!funcionActiva) return;
    setAvisoFuncion(
      funcionActiva === 'admin'
        ? esAdmin
          ? 'Ingresaste como Administrador.'
          : 'Ingresaste como Administrador.'
        : `Trabajando como ${funcionActiva === 'operator' ? 'Operador' : 'Repartidor'}.`
    );
    const t = setTimeout(() => setAvisoFuncion(null), 4000);
    return () => clearTimeout(t);
  }, [funcionActiva, esAdmin]);


  // 2. Escuchar cambios de autenticación de Firebase
  useEffect(() => {
    try {
      localStorage.removeItem(SESION_STORAGE_KEY_ANTIGUA);
      localStorage.removeItem('cultivos_lore_lotes_backup');
    } catch {}

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        // La sesión terminó sin pasar por "Cerrar sesión" (vencida, revocada o cerrada en otra
        // pestaña): no quedan en el navegador copias de perfiles ni entregas de nadie (H50)
        limpiarCopiasLocales(null);
        setUsuario(null);
        setPerfilUsuario(null);
        setErrorPerfil(null);
        setAuthCargando(false);
        return;
      }

      // Validar si el token es accesible o si requiere reautenticación
      try {
        await fbUser.getIdToken();
      } catch (tokenErr: any) {
        // Sin conexión no se puede renovar el token: se conserva la sesión (el repartidor sigue
        // consultando y guardando acciones en el teléfono). Solo se cierra si la sesión es inválida.
        if (tokenErr?.code !== 'auth/network-request-failed' && navigator.onLine) {
          console.warn('Sesión previa inválida, restableciendo autenticación limpia:', tokenErr);
          limpiarCopiasLocales(null);
          try {
            await signOut(auth);
          } catch {}
          setUsuario(null);
          setPerfilUsuario(null);
          setAuthCargando(false);
          return;
        }
      }

      // Otra cuenta en este navegador: se borran las copias locales de las demás (H50)
      limpiarCopiasLocales(fbUser.uid);
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
        // El lote abierto en detalle se toma de esta misma lista (ver loteDetalleVivo)
        setLotes(listaLotes);
        setLotesCargando(false);
        setErrorConexion(null);
      },
      (err) => {
        console.warn('Error escuchando lotes en Firestore:', err);
        setLotesCargando(false);
        setErrorConexion(
          err?.code === 'permission-denied'
            ? 'No tienes permiso para consultar los lotes de la granja.'
            : 'No fue posible actualizar los lotes en este momento. Revisa tu conexión.'
        );
      }
    );

    return () => unsubLotes();
  }, [puedeVerProduccion]);

  const handleCerrarSesion = async () => {
    // Se recuerda la última función usada: al volver a ingresar se entra directo a ella (se cambia
    // con un clic desde la barra superior)
    // Las copias locales (lotes, perfil, entregas) no quedan en el navegador para la siguiente
    // persona. La bandeja de acciones del repartidor sin enviar se conserva para no perderlas.
    limpiarCopiasLocales(null);
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Error al cerrar sesión:', err);
    }
    setUsuario(null);
    setPerfilUsuario(null);
    setFuncionActiva(null);
  };

  // Mientras llega el perfil (o se aplica su única función) no se muestra el aviso de acceso
  // restringido: sería falso para quien sí tiene funciones (H26)
  const perfilPendiente = Boolean(usuario) && (!perfilUsuario || (funciones.length > 0 && !funcionActiva));

  // Lote abierto en detalle: la versión más reciente entre la de la lista en vivo y la recibida al
  // registrar una acción (la lista puede tardar un instante en reflejarla)
  const loteDetalleEnLista = loteDetalleVisible ? lotes.find((l) => l.codigo === loteDetalleVisible.codigo) : undefined;
  const loteDetalleVivo =
    loteDetalleEnLista && loteDetalleVisible && (loteDetalleEnLista.actualizadoEn || '') >= (loteDetalleVisible.actualizadoEn || '')
      ? loteDetalleEnLista
      : loteDetalleVisible;

  const accesoRestringido = (
    <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-6 flex items-start space-x-3 text-xs text-slate-700">
      <Lock className="w-5 h-5 text-slate-500 shrink-0" />
      <div>
        <p className="font-semibold text-sm text-slate-900">Información productiva restringida</p>
        <p className="mt-1">
          {!usuario
            ? 'Ingresa al sistema con una cuenta autorizada para consultar los lotes de la granja.'
            : 'Tu cuenta no tiene una función de producción autorizada. Si crees que es un error, contacta al administrador.'}
        </p>
      </div>
    </div>
  );

  // Permiso efectivo en la función activa (el administrador trabaja con todos)
  const puede = (clave: Parameters<typeof verificarPermiso>[1]) => funcionActiva === 'admin' || verificarPermiso(perfilUsuario, clave);
  const tabsPermitidas = tabsDeFuncion(funcionActiva, perfilUsuario);

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
  // La pantalla de ingreso se desvanece (180 ms) cuando la sesión queda activa, antes de que entre la app
  const ingreso = usePresencia(!usuario && !authCargando);

  if (entregaPublicaToken && !lotePublicoCodigo) {
    return (
      <LimiteError pantallaCompleta>
      <Suspense fallback={<Cargando />}>
      <ConsultaEntregaPublica
        token={entregaPublicaToken}
        onAbrirLote={(codigo) => {
          if (typeof window !== 'undefined') window.history.pushState({}, '', `/?lote=${encodeURIComponent(codigo)}`);
          setEntregaPublicaToken(null);
          setLotePublicoCodigo(codigo);
        }}
        onVolver={() => {
          if (typeof window !== 'undefined') window.history.pushState({}, '', window.location.pathname);
          setEntregaPublicaToken(null);
        }}
      />
      </Suspense>
      </LimiteError>
    );
  }

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

  // Sin sesión: pantalla breve con el logo mientras se verifica y, después, la pantalla de ingreso
  if (authCargando && !usuario) return <PantallaVerificando />;
  if (!usuario || ingreso.saliendo) {
    return (
      <div className={ingreso.saliendo ? "opacity-0 transition-opacity duration-(--mov-salida) ease-(--curva-salida)" : ""}>
        <LimiteError pantallaCompleta>
          <Suspense fallback={<PantallaVerificando />}>
            <PantallaIngreso onRolElegido={(rol) => setFuncionPedida(rol)} />
          </Suspense>
        </LimiteError>
      </div>
    );
  }

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: DISTANCIA.tarjeta }}
      animate={{ opacity: 1, y: 0, transition: entrada() }}
      className="min-h-dvh bg-white flex flex-col font-sans"
    >
      {/* NAVBAR */}
      <Navbar
        tabActiva={tabActiva}
        setTabActiva={setTabActiva}
        usuario={usuario as User}
        perfilUsuario={perfilUsuario}
        funcionActiva={funcionActiva}
        funciones={funciones}
        eligiendoFuncion={mostrarSelectorFuncion}
        onSeleccionarFuncion={handleSeleccionarFuncion}
        onAbrirAuth={() => setAuthModalOpen(true)}
        onCerrarSesion={handleCerrarSesion}
        onNuevoLote={handleAbrirNuevoLote}
      />

      {avisoFuncionPedida && (
        <div role="status" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-start justify-between gap-3">
            <span>{avisoFuncionPedida}</span>
            <button type="button" onClick={() => setAvisoFuncionPedida(null)} className="font-semibold underline shrink-0">
              Entendido
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
              <strong>Perfil Pendiente:</strong> Tu cuenta ({usuario.email}) ha sido registrada pero aún no ha sido autorizada por el administrador. Tendrás acceso operativo tan pronto te autorice.
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
      <div className="relative flex-1 flex flex-col min-h-[60vh]">
      {/* mode="wait": solo un main sale a la vez y la pestaña nueva se monta cuando termina (H58) */}
      <AnimatePresence mode="wait" initial={false} custom={direccionTab}>
      <motion.main
        key={tabActiva}
        data-tab={tabActiva}
        custom={direccionTab}
        variants={VAR_CONTENIDO_TAB}
        initial="entra"
        animate="visible"
        exit="sale"
        className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6"
      >
        <LimiteError>
        <Suspense fallback={<Cargando />}>
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
        {!puedeVerProduccion && (tabActiva === 'inicio' || tabActiva === 'lotes' || tabActiva === 'pedidos' || tabActiva === 'analitica') && (
          perfilPendiente ? (
            <div role="status" aria-live="polite">
              <p className="sr-only">Cargando tu perfil...</p>
              <EsqueletoPantalla />
            </div>
          ) : accesoRestringido
        )}

        {puedeVerProduccion && (
        <>
        {/* 1. INICIO */}
        {tabActiva === 'inicio' && tabsPermitidas.includes('inicio') && (funcionActiva === 'admin' || puede('verInicio') || puede('crearLotes')) && (
          lotesCargando && lotes.length === 0 ? <EsqueletoPantalla /> : <DashboardTab
            lotes={lotes}
            config={config}
            onNuevoLote={handleAbrirNuevoLote}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
            onAbrirQr={(lote) => setLoteQr(lote)}
            puedeCrearLote={puede('crearLotes')}
            puedeBuscar={puede('buscarLotes')}
            puedeDocumentos={puede('descargarDocumentosLote')}
          />
        )}
        {tabActiva === 'inicio' && funcionActiva === 'operator' && !puede('verInicio') && !puede('crearLotes') && tabsPermitidas.length === 1 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
            Tu cuenta todavía no tiene pestañas asignadas. Pide al administrador que te otorgue los permisos de tu trabajo.
          </div>
        )}

        {/* 2. LOTES */}
        {tabActiva === 'lotes' && tabsPermitidas.includes('lotes') && (
          lotesCargando && lotes.length === 0 ? <EsqueletoPantalla /> : <LotesTab
            lotes={lotes}
            config={config}
            onNuevoLote={handleAbrirNuevoLote}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
            onAbrirQr={(lote) => setLoteQr(lote)}
            puedeBuscar={puede('buscarLotes')}
            puedeDocumentos={puede('descargarDocumentosLote')}
          />
        )}

        {/* PEDIDOS: ÓRDENES DE ENTREGA VINCULADAS A LOS LOTES */}
        {tabActiva === 'pedidos' && tabsPermitidas.includes('pedidos') && (
          <PedidosTab lotes={lotes} perfilActual={perfilUsuario} />
        )}

        {/* 3. ANALÍTICA */}
        {tabActiva === 'analitica' && tabsPermitidas.includes('analitica') && (
          lotesCargando && lotes.length === 0 ? <EsqueletoPantalla /> : <AnaliticaTab
            lotes={lotes}
            config={config}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
            puedeExportar={puede('exportarAnalitica')}
          />
        )}
        </>
        )}

        {/* 4. CONFIGURACIÓN DE GRANJA Y ESTANQUES */}
        {tabActiva === 'configuracion' && tabsPermitidas.includes('configuracion') && (
          <ConfiguracionTab
            config={config}
            userEmail={usuario?.email || ''}
            perfilActual={perfilUsuario}
            onConfigActualizada={(nuevaConfig) => setConfig(nuevaConfig)}
            lotes={lotes}
            lotesListos={puedeVerProduccion && !lotesCargando && !errorConexion}
          />
        )}

        {/* 5. GESTIÓN DE PERSONAL Y PERMISOS (NUEVA PESTAÑA DEDICADA) */}
        {tabActiva === 'usuarios' && tabsPermitidas.includes('usuarios') && (
          <UsuariosTab
            userEmail={usuario?.email || ''}
            perfilActual={perfilUsuario}
            gestionHabilitada={funcionActiva === 'admin'}
          />
        )}
        </>
        )}
        </Suspense>
        </LimiteError>
      </motion.main>
      </AnimatePresence>
      </div>

      {/* FOOTER */}
      <footer className="bg-slate-900 text-slate-300 border-t border-slate-800 py-6 text-xs text-center">
        <div className="max-w-7xl mx-auto px-4">
          <p className="font-semibold text-slate-300">
            Cultivos Loré · Granja de Tilapia Roja en Turbaco (Bolívar, Colombia)
          </p>
          <p className="text-slate-500 mt-1">
            Producto: Tilapia roja entera fresca, limpia (escamada y eviscerada), calibre 450 a 500 g • Modalidad Tilapia Pro
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Este registro documenta cómo se produjo y manejó el lote; no reemplaza los controles de inocuidad.
          </p>
        </div>
      </footer>

    </motion.div>

      {/* MODALES: fuera del contenedor animado, por la misma razón que el aviso de función */}
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

      {loteDetalleVivo && (
        <LimiteError>
        <Suspense fallback={null}>
        <LoteDetailModal
          isOpen={Boolean(loteDetalle)}
          onClose={() => setLoteDetalle(null)}
          loteInicial={loteDetalleVivo}
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
        </Suspense>
        </LimiteError>
      )}

      {loteQrVisible && (
        <QrModal
          isOpen={Boolean(loteQr)}
          onClose={() => setLoteQr(null)}
          lote={loteQrVisible}
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
      {/* AVISO DISCRETO DE LA FUNCIÓN: aparece unos segundos abajo a la izquierda. Va fuera del contenedor
          animado: mientras este entra con transform, un fixed dentro quedaría anclado a él y no a la pantalla */}
      {/* No recibe toques (no tapa los botones de esa esquina) y sale como el aviso de Personal */}
      <AnimatePresence>
        {avisoFuncion && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: DISTANCIA.pantalla }}
            animate={{ opacity: 1, y: 0, transition: entrada(DURACION.base) }}
            exit={{ opacity: 0, y: DISTANCIA.pequena, transition: salida() }}
            className="pointer-events-none fixed bottom-4 left-4 z-50 max-w-[calc(100vw-2rem)] sm:max-w-xs flex items-center space-x-2 rounded-lg bg-slate-900 text-white shadow-lg px-3 py-2 text-xs"
          >
            <Shield className="w-4 h-4 text-sky-300 shrink-0" />
            <span>{avisoFuncion}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
