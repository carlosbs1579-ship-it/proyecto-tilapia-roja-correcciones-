import React, { useState } from 'react';
import { OrdenEntrega } from '../types';
import { corregirEntrega, redondear } from '../services/pedidosService';
import { num } from './entregasUi';

type Ejecutar = (accion: () => Promise<void>, exito: string) => Promise<void>;

/**
 * Corrección de una entrega ya confirmada (operador): fija lo realmente entregado de cada lote,
 * con motivo. El inventario y el estado de la orden se recalculan; queda un evento con el valor
 * anterior y el nuevo, y después se puede emitir un comprobante nuevo con los datos corregidos.
 */
export const CorreccionEntrega: React.FC<{ orden: OrdenEntrega; procesando: boolean; ejecutar: Ejecutar }> = ({
  orden: o,
  procesando,
  ejecutar
}) => {
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, number | ''>>({});
  const [motivo, setMotivo] = useState('');

  if (!['entregado', 'entrega_parcial'].includes(o.estado) || (o.cantidadLiberada || 0) > 0) return null;

  const lotes = Object.entries(o.procedencias);
  const abrir = () => {
    setValores(Object.fromEntries(lotes.map(([c]) => [c, o.entregadoPorLote?.[c] || 0])));
    setMotivo('');
    setAbierto(true);
  };
  const total = redondear(Object.values(valores).reduce<number>((s, v) => s + (Number(v) || 0), 0), o.unidad);
  const faltan = redondear(o.cantidadAutorizada - total, o.unidad);
  const iguales = lotes.every(([c]) => redondear(Number(valores[c]) || 0, o.unidad) === redondear(o.entregadoPorLote?.[c] || 0, o.unidad));

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white text-slate-700 hover:bg-slate-100 font-semibold"
      >
        Corregir cantidades entregadas
      </button>
    );
  }

  return (
    <div className="border border-amber-300 bg-amber-50/60 rounded-lg p-3 space-y-2">
      <p className="font-semibold text-slate-800">Corregir lo realmente entregado</p>
      <p className="text-slate-600">
        Úsalo si una entrega confirmada quedó mal registrada. Lo anterior no se borra: queda en el historial con el motivo. El inventario se ajusta
        por la diferencia y, si falta producto, la orden queda como entrega parcial para reprogramar o liberar el saldo.
      </p>
      {lotes.map(([codigo, p]) => (
        <label key={codigo} className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong className="font-mono">{codigo}</strong> · piscina {p.estanque} · autorizado {num(p.cantidad)} {o.unidad} · registrado{' '}
            {num(o.entregadoPorLote?.[codigo] || 0)}
          </span>
          <input
            type="number"
            min={0}
            max={p.cantidad}
            step={o.unidad === 'peces' ? 1 : 0.01}
            value={valores[codigo] ?? ''}
            onChange={(e) => setValores((prev) => ({ ...prev, [codigo]: e.target.value === '' ? '' : Number(e.target.value) }))}
            className="w-28 px-2 py-1 border border-slate-300 rounded text-right"
          />
        </label>
      ))}
      <p className={faltan > 0 ? 'text-amber-800' : 'text-emerald-800'}>
        Total corregido: <strong>{num(total)} {o.unidad}</strong>
        {faltan > 0 ? ` · faltarán ${num(faltan)} (quedará como entrega parcial)` : ' · entrega completa'}
      </p>
      <input
        type="text"
        maxLength={1000}
        placeholder="Motivo de la corrección (obligatorio, mínimo 10 caracteres)"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="w-full px-2 py-1 border border-slate-300 rounded"
      />
      <p className="text-[10px] text-slate-500">
        Si esta orden tiene un comprobante vigente con los datos anteriores, anúlalo en "Documentación de entrega" y emite uno nuevo después de corregir.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={procesando || motivo.trim().length < 10 || iguales || total <= 0}
          onClick={() =>
            ejecutar(async () => {
              await corregirEntrega(o.id, Object.fromEntries(lotes.map(([c]) => [c, Number(valores[c]) || 0])), motivo);
              setAbierto(false);
            }, `Entrega de ${o.id} corregida. Ya puedes emitir el comprobante con los datos corregidos.`)
          }
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold disabled:opacity-40"
        >
          Guardar corrección
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="px-3 py-1.5 border border-slate-300 rounded-lg">
          Cancelar
        </button>
      </div>
    </div>
  );
};
