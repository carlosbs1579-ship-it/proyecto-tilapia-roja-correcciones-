import React from 'react';
import { motion } from 'motion/react';
import { LogoLore } from './LogoLore';
import { DURACION } from '../lib/motion';

/** Pantalla breve con el logo mientras se verifica si ya hay sesión (evita que parpadee el ingreso) */
export const PantallaVerificando: React.FC = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1, transition: { duration: DURACION.base, delay: 0.15 } }}
    className="min-h-dvh bg-slate-900 grid place-items-center"
    role="status"
    aria-label="Verificando la sesión"
  >
    <div className="flex flex-col items-center gap-3 text-white">
      <LogoLore className="w-16 h-12 text-amber-400" />
      <p className="font-serif text-2xl">Cultivos Loré</p>
    </div>
  </motion.div>
);
