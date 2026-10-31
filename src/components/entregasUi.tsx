import React from 'react';
import { EstadoAtencion, EstadoOrden } from '../types';
import { ETIQUETA_ESTADO_ORDEN } from '../services/pedidosService';
import { ETIQUETA_ATENCION } from '../services/seguimientoService';

// Piezas visuales compartidas por las secciones de "Gestión de entregas"

export const num = (n: number) => (Number(n) || 0).toLocaleString('es-CO');

export const ESTILO_ESTADO: Record<EstadoOrden, string> = {
  borrador: 'bg-slate-100 text-slate-700 border-slate-300',
  asignado: 'bg-sky-100 text-sky-800 border-sky-300',
  en_preparacion: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  en_ruta: 'bg-violet-100 text-violet-800 border-violet-300',
  entrega_parcial: 'bg-amber-100 text-amber-800 border-amber-300',
  entregado: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  requiere_revision: 'bg-orange-100 text-orange-800 border-orange-300',
  cancelado: 'bg-red-50 text-red-700 border-red-200'
};

export const ESTILO_ATENCION: Record<EstadoAtencion, string> = {
  pendiente: 'bg-red-50 text-red-700 border-red-200',
  en_revision: 'bg-amber-50 text-amber-800 border-amber-200',
  atendida: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cerrada: 'bg-slate-100 text-slate-600 border-slate-300'
};

export const ETIQUETA_FUNCION: Record<string, string> = {
  admin: 'administrador',
  operator: 'operador',
  courier: 'repartidor'
};

export const EstadoOrdenBadge: React.FC<{ estado: EstadoOrden }> = ({ estado }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full border font-semibold text-[10px] whitespace-nowrap ${ESTILO_ESTADO[estado]}`}>
    {ETIQUETA_ESTADO_ORDEN[estado]}
  </span>
);

export const EstadoAtencionBadge: React.FC<{ estado: EstadoAtencion }> = ({ estado }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full border font-semibold text-[10px] whitespace-nowrap ${ESTILO_ATENCION[estado]}`}>
    {ETIQUETA_ATENCION[estado]}
  </span>
);
