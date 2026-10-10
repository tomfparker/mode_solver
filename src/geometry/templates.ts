// Starting structures. Dimensions are illustrative example geometries, not any specific
// foundry process or commercial fibre. Indices come from the sourced material library,
// except Δn values on fibre cores and diffused guides, which are example values the user
// is expected to replace (the UI says so).

import { uid } from './geometry';
import type { Feature, MaterialUse, Project, SolverSettings } from './types';

export const DEFAULT_SETTINGS: SolverSettings = {
  solverKind: 'auto',
  meshStep: 'auto',
  padding: 'auto',
  boundary: 'auto',
  numModes: 4,
  nGuess: 'auto',
};

export interface Template {
  id: string;
  name: string;
  description: string;
  build: () => Project;
}

function base(name: string, wavelength = 1.55): Omit<Project, 'background' | 'features'> {
  return { version: 2, name, wavelength, customMaterials: [], settings: { ...DEFAULT_SETTINGS } };
}

/** Substrates are full-width rectangles this deep: far beyond any solve window (semi-infinite in effect). */
export const SUBSTRATE_DEPTH = 50;

/** Full-width rectangle (a layer) from y0 to y0 + h. */
function slab(name: string, use: MaterialUse, y0: number, h: number): Feature {
  return { id: uid('f'), kind: 'rect', name, ...use, x: 0, y: y0, width: 10, height: h, fullWidth: true };
}

function substrate(use: MaterialUse, top: number): Feature {
  return slab('Substrate', use, top - SUBSTRATE_DEPTH, SUBSTRATE_DEPTH);
}

export const TEMPLATES: Template[] = [
  {
    id: 'sin-strip',
    name: 'SiN strip',
    description: 'Si₃N₄ strip on oxide, oxide-clad',
    build: () => ({
      ...base('SiN strip'),
      background: { material: 'SiO2' },
      features: [
        substrate({ material: 'Si' }, -4),
        slab('BOX', { material: 'SiO2' }, -4, 4),
        { id: uid('f'), name: 'Core', kind: 'rect', material: 'Si3N4', x: 0, y: 0, width: 1.2, height: 0.8 },
      ],
    }),
  },
  {
    id: 'soi-strip',
    name: 'SOI strip',
    description: '500 × 220 nm silicon wire',
    build: () => ({
      ...base('SOI strip'),
      background: { material: 'SiO2' },
      features: [
        substrate({ material: 'Si' }, -2),
        slab('BOX', { material: 'SiO2' }, -2, 2),
        { id: uid('f'), name: 'Core', kind: 'rect', material: 'Si', x: 0, y: 0, width: 0.5, height: 0.22 },
      ],
    }),
  },
  {
    id: 'soi-rib',
    name: 'SOI rib',
    description: 'Partially etched silicon rib on a slab',
    build: () => ({
      ...base('SOI rib'),
      background: { material: 'SiO2' },
      features: [
        substrate({ material: 'Si' }, -2),
        slab('BOX', { material: 'SiO2' }, -2, 2),
        slab('Slab', { material: 'Si' }, 0, 0.09),
        { id: uid('f'), name: 'Rib', kind: 'rect', material: 'Si', x: 0, y: 0.09, width: 0.5, height: 0.13 },
      ],
    }),
  },
  {
    id: 'slot',
    name: 'Slot',
    description: 'Two silicon rails with a narrow air slot',
    build: () => ({
      ...base('Slot waveguide'),
      background: { material: 'Air' },
      features: [
        substrate({ material: 'Si' }, -2),
        slab('BOX', { material: 'SiO2' }, -2, 2),
        { id: uid('f'), name: 'Left rail', kind: 'rect', material: 'Si', x: -0.14, y: 0, width: 0.18, height: 0.22 },
        { id: uid('f'), name: 'Right rail', kind: 'rect', material: 'Si', x: 0.14, y: 0, width: 0.18, height: 0.22 },
      ],
    }),
  },
  {
    id: 'fibre',
    name: 'Step-index fibre',
    description: 'Silica core with an example Δn (replace with your fibre’s)',
    build: () => ({
      ...base('Step-index fibre'),
      background: { material: 'SiO2' },
      features: [
        { id: uid('f'), name: 'Core', kind: 'circle', material: 'SiO2', deltaN: 0.005, deltaNIsExample: true, x: 0, y: 0, radius: 4 },
      ],
    }),
  },
  {
    id: 'diffused',
    name: 'Diffused channel',
    description: 'In-diffused stripe in LiNbO₃ (example Δn and depth)',
    build: () => ({
      ...base('Diffused channel'),
      background: { material: 'Air' },
      features: [
        substrate({ material: 'LiNbO3', opticAxis: 'y' }, 0),
        {
          id: uid('f'),
          name: 'Diffused stripe',
          kind: 'graded',
          x: 0,
          y: 0,
          deltaN: 0.01,
          deltaNIsExample: true,
          profileX: 'erf-strip',
          stripWidth: 7,
          wx: 2,
          wy: 3,
          profileY: 'half-gaussian',
        },
      ],
    }),
  },
  {
    id: 'ln-ridge',
    name: 'LN ridge (LNOI)',
    description: 'X-cut thin-film LiNbO₃ ridge, 60° sidewalls',
    build: () => {
      const h = 0.3;
      const top = 1.2;
      const bottom = top + (2 * h) / Math.tan((60 * Math.PI) / 180);
      return {
        ...base('LN ridge'),
        background: { material: 'Air' },
        features: [
          substrate({ material: 'Si' }, -2.3),
          slab('BOX', { material: 'SiO2' }, -2.3, 2),
          slab('LN slab', { material: 'LiNbO3', opticAxis: 'x' }, -0.3, 0.3),
          {
            id: uid('f'),
            name: 'Ridge',
            kind: 'trapezoid',
            material: 'LiNbO3',
            opticAxis: 'x',
            x: 0,
            y: 0,
            widthBottom: Math.round(bottom * 1000) / 1000,
            widthTop: top,
            height: h,
          },
        ],
      };
    },
  },
];

export const DEFAULT_TEMPLATE_ID = 'sin-strip';

export function buildTemplate(id: string): Project {
  return (TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]).build();
}
