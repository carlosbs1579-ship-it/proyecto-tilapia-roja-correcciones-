/**
 * Tipos de datos para Cultivos Loré - Trazabilidad Tilapia Pro
 */

export const ADMIN_MASTER_EMAIL = 'carlosbs1579@gmail.com';

export type EstadoLote = 'activo' | 'cerrado';

export type TipoEvento =
  | 'Siembra'
  | 'Calidad del agua'
  | 'Alimentación'
  | 'Muestreo de crecimiento (biometría)'
  | 'Mortalidad'
  | 'Probióticos'
  | 'Tratamiento o manejo sanitario'
  | 'Cosecha'
  | 'Proceso'
  | 'Empaque y conservación'
  | 'Despacho/transporte'
  | 'Observación'
  | 'Corrección';

export interface EventoLote {
  id: string; // UUID v4
  indice: number; // 0, 1, 2...
  tipo: TipoEvento;
  fechaEvento: string; // YYYY-MM-DD
  descripcion: string;
  datos: Record<string, any>;
  registradoPor: string; // email del usuario
  registradoEn: string; // ISO string generado por cliente
  hashAnterior: string; // 64 ceros para el índice 0, o hash del evento anterior
  hash: string; // SHA-256 del contenido canónico
}

export interface ResumenLote {
  mortalidadAcumulada: number;
  pecesCosechados: number;
  pecesVivos: number;
  supervivencia: number; // Porcentaje 0 - 100
  pesoPromedioActualG: number;
  biomasaEstimadaKg: number;
  biomasaInicialKg: number;
  biomasaCosechadaKg: number;
  alimentoAcumuladoKg: number;
  FCA: number | null; // Factor de Conversión Alimenticia
  diasDeCultivo: number;
  gananciaDiariaG: number;
  densidadKgM3: number | null;
  ultimoEvento: {
    tipo: string;
    fecha: string;
  } | null;
  alertasAgua: number;
  hashFinal: string;
}

export interface Lote {
  codigo: string; // ID doc, e.g. 20261023-A-E1
  consecutivo: number; // Consecutivo global
  estanque: string; // E1, E2, etc.
  producto: string; // 'Tilapia roja entera fresca, limpia (escamada y eviscerada), calibre 450 a 500 g'
  modalidad: 'Tilapia Pro';
  origen: string; // 'Cultivos Loré, Turbaco, Bolívar'
  fechaSiembra: string; // YYYY-MM-DD
  cantidadSembrada: number;
  pesoInicialPromedioG: number;
  proveedorAlevinos?: string;
  estado: EstadoLote;
  fechaCierre: string | null;
  eventos: EventoLote[];
  resumen: ResumenLote;
  pdfPath?: string;
  pdfUrl?: string;
  versionPdf: number;
  pdfActualizadoEn?: string;
  granjaId?: string; // Granja a la que pertenece el lote (los lotes antiguos pueden no tenerla)
  creadoPor: string;
  creadoPorUid?: string | null; // UID de Firebase Auth de quien creó el lote
  creadoEn: string;
  actualizadoEn: string;
  observacionesIniciales?: string;
}

export interface EstanqueConfig {
  codigo: string;
  nombre: string;
  volumenM3?: number;
}

export interface RangosReferenciaAgua {
  temperaturaMin: number;
  temperaturaMax: number;
  oxigenoMin: number;
  phMin: number;
  phMax: number;
  amonioMax: number;
  nitritosMax: number;
  secchiMin: number;
  secchiMax: number;
}

export interface FichaNutricional {
  porcionG: number;
  energiaKcal: number;
  proteinaG: number;
  grasaTotalG: number;
  carbohidratosG: number;
  colesterolMg: number;
  sodioMg: number;
  fuente: string;
  notas: string;
}

export interface ConfiguracionGeneral {
  estanques: EstanqueConfig[];
  rangosReferencia: RangosReferenciaAgua;
  fichaNutricional: FichaNutricional;
  actualizadoPor?: string;
  actualizadoEn?: string;
}

export interface PermisosUsuario {
  crearLotes: boolean; // Añadir nuevos lotes (siembra)
  registrarEventos: boolean; // Cargar mediciones, alimentación, eventos
  cerrarLotes: boolean; // Cerrar lotes y generar PDF oficial
  gestionarEstanques: boolean; // Crear otras piscinas / estanques
  gestionarConfiguracion: boolean; // Modificar rangos de agua y ficha nutricional
  administrarUsuarios: boolean; // Otorgar permisos y modificar cargos
}

// admin: gestiona usuarios y configuración; operario: trabaja según sus permisos; consulta: solo lectura
export type RolUsuario = 'admin' | 'operario' | 'consulta';

export interface UsuarioPerfil {
  uid: string; // UID real de Firebase Authentication (coincide con el ID del documento)
  email: string;
  displayName?: string;
  rol: RolUsuario;
  granjaId: string; // Granja a la que pertenece el usuario
  cargo: string; // Nombre personalizado de la posición (ej: "Biólogo de Campo", "Jefe de Planta", etc.)
  estado: 'activo' | 'pendiente' | 'inactivo';
  permisos: PermisosUsuario;
  creadoEn: string;
  actualizadoEn: string;
  autorizadoPor?: string; // email del administrador que otorgó los permisos
}
