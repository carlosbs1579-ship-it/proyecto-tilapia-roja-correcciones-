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

// ---------- Entregas a clientes (posteriores al sellado del lote) ----------

export type TipoRegistroEntrega =
  | 'Asignación de cliente'
  | 'Reasignación de cliente'
  | 'Entrega completada'
  | 'Anulación de asignación';

/**
 * Acción sobre una entrega. Tiene la misma estructura y el mismo cálculo de hash que un evento de
 * producción; datos.entregaId identifica a qué entrega pertenece.
 */
export interface RegistroEntrega extends Omit<EventoLote, 'tipo'> {
  tipo: TipoRegistroEntrega;
}

/**
 * Documento entregas/{codigoLote}: cadena propia de registros de entrega, anclada al hash del
 * último evento de producción del lote sellado. No modifica el documento del lote.
 */
export interface EntregasLote {
  codigoLote: string;
  granjaId: string;
  hashAnclaje: string; // hash del último evento de producción en el momento del primer registro
  registros: RegistroEntrega[];
  creadoEn: string;
  actualizadoEn: string;
}

// ---------- Pedidos (órdenes de entrega) ----------
// Las órdenes viven en ordenes/{id}, separadas de los lotes: nunca modifican un lote ni su hash.
// La disponibilidad de cada lote se controla en inventarioLotes/{codigoLote}.

// Unidad explícita de cada orden. No se convierte entre peces y kg.
export type UnidadMedida = 'peces' | 'kg';

export type EstadoOrden =
  | 'borrador'
  | 'asignado'
  | 'en_preparacion'
  | 'en_ruta'
  | 'entrega_parcial'
  | 'entregado'
  | 'requiere_revision'
  | 'cancelado';

export type TipoEventoOrden =
  | 'Creación'
  | 'Modificación'
  | 'Asignación y reserva'
  | 'Cambio de repartidor'
  | 'Cambio de estado'
  | 'Cancelación';

/**
 * Cantidad que la orden toma de un lote. Un lote pertenece a una sola piscina, así que la
 * piscina de origen es la del lote (se copia para conservar la procedencia).
 */
export interface ProcedenciaOrden {
  estanque: string;
  cantidad: number;
  unidad: UnidadMedida;
}

export interface EventoOrden {
  indice: number;
  tipo: TipoEventoOrden;
  fecha: string; // ISO
  registradoPor: string; // correo
  registradoPorUid: string;
  descripcion: string;
  datos: Record<string, any>;
}

export interface OrdenEntrega {
  id: string; // también es el ID del documento, ej: PED-20261030-K7Q2M
  granjaId: string;
  clienteId: string;
  clienteNombre: string;
  creadoPor: string;
  creadoPorUid: string;
  repartidorUid: string | null;
  repartidorNombre: string | null;
  creadoEn: string;
  actualizadoEn: string;
  fechaProgramada: string | null; // YYYY-MM-DD
  unidad: UnidadMedida;
  cantidadSolicitada: number;
  procedencias: Record<string, ProcedenciaOrden>; // clave: código del lote de origen
  cantidadAutorizada: number; // suma reservada en los lotes
  cantidadEntregada: number; // se registrará con la confirmación de entrega (fase posterior)
  estado: EstadoOrden;
  observaciones: string;
  historial: EventoOrden[]; // solo se agregan eventos
}

export interface Cliente {
  id: string;
  granjaId: string;
  nombre: string;
  contacto: string;
  creadoPor: string;
  creadoPorUid: string;
  creadoEn: string;
  actualizadoEn: string;
}

/**
 * Reservas y entregas acumuladas de un lote. La unidad queda fijada con la primera reserva.
 */
export interface InventarioLote {
  codigoLote: string;
  granjaId: string;
  unidad: UnidadMedida;
  reservado: number;
  entregado: number;
  ultimaOrden: string; // orden que hizo el último movimiento (lo verifican las reglas)
  movidoEn: unknown; // hora del servidor del último movimiento (Timestamp de Firestore)
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
  gestionarPedidos: boolean; // Crear órdenes de entrega, reservar cantidades y asignar repartidor
}

// admin: gestiona usuarios y configuración; operario: trabaja según sus permisos; consulta: solo lectura
// Se conserva por compatibilidad: desde la lista de roles funcionales se escribe 'admin' u 'operario'.
export type RolUsuario = 'admin' | 'operario' | 'consulta';

// Roles funcionales: determinan los permisos reales. Una cuenta puede tener varios.
// admin: administración (incluye producción); operator: producción según sus permisos; courier: reparto
export type RolFuncional = 'admin' | 'operator' | 'courier';

export const ROLES_FUNCIONALES: RolFuncional[] = ['admin', 'operator', 'courier'];

export interface UsuarioPerfil {
  uid: string; // UID real de Firebase Authentication (coincide con el ID del documento)
  email: string;
  displayName?: string;
  rol: RolUsuario;
  roles: RolFuncional[]; // Roles funcionales asignados por el administrador
  cargos: Partial<Record<RolFuncional, string>>; // Nombre visible de cada función; no otorga permisos
  granjaId: string; // Granja a la que pertenece el usuario
  cargo: string; // Nombre personalizado de la posición (ej: "Biólogo de Campo", "Jefe de Planta", etc.)
  estado: 'activo' | 'pendiente' | 'inactivo';
  permisos: PermisosUsuario;
  creadoEn: string;
  actualizadoEn: string;
  autorizadoPor?: string; // email del administrador que otorgó los permisos
}
