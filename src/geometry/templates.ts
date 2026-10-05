// Starting structures. Dimensions are illustrative example geometries, not any specific
// foundry process or commercial fibre. Indices come from the sourced material library,
// except Δn values on fibre cores and diffused guides, which are example values the user
// is expected to replace (the UI says so).

import { uid } from './geometry';
import type { Project, SolverSettings } from './types';

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

function base(name: string, wavelength = 1.55): Omit<Project, 'stack' | 'features'> {
  return { version: 1, name, wavelength, customMaterials: [], settings: { ...DEFAULT_SETTINGS } };
}

export const TEMPLATES: Template[] = [
  {
    id: 'sin-strip',
    name: 'SiN strip',
    description: 'Si₃N₄ strip on oxide, oxide-clad',
    build: () => {
      const box = uid('l');
      return {
        ...base('SiN strip'),
        stack: {
          substrate: { material: 'Si' },
          layers: [{ id: box, name: 'BOX', material: 'SiO2', thickness: 4 }],
          cladding: { material: 'SiO2' },
        },
        features: [
          { id: uid('f'), name: 'Core', kind: 'rect', material: 'Si3N4', anchor: box, x: 0, y: 0, width: 1.2, height: 0.8 },
        ],
      };
    },
  },
  {
    id: 'soi-strip',
    name: 'SOI strip',
    description: '500 × 220 nm silicon wire',
    build: () => {
      const box = uid('l');
      return {
        ...base('SOI strip'),
        stack: {
          substrate: { material: 'Si' },
          layers: [{ id: box, name: 'BOX', material: 'SiO2', thickness: 2 }],
          cladding: { material: 'SiO2' },
        },
        features: [
          { id: uid('f'), name: 'Core', kind: 'rect', material: 'Si', anchor: box, x: 0, y: 0, width: 0.5, height: 0.22 },
        ],
      };
    },
  },
  {
    id: 'soi-rib',
    name: 'SOI rib',
    description: 'Partially etched silicon rib on a slab',
    build: () => {
      const box = uid('l');
      const slab = uid('l');
      return {
        ...base('SOI rib'),
        stack: {
          substrate: { material: 'Si' },
          layers: [
            { id: box, name: 'BOX', material: 'SiO2', thickness: 2 },
            { id: slab, name: 'Slab', material: 'Si', thickness: 0.09 },
          ],
          cladding: { material: 'SiO2' },
        },
        features: [
          { id: uid('f'), name: 'Rib', kind: 'rect', material: 'Si', anchor: slab, x: 0, y: 0, width: 0.5, height: 0.13 },
        ],
      };
    },
  },
  {
    id: 'slot',
    name: 'Slot',
    description: 'Two silicon rails with a narrow air slot',
    build: () => {
      const box = uid('l');
      return {
        ...base('Slot waveguide'),
        stack: {
          substrate: { material: 'Si' },
          layers: [{ id: box, name: 'BOX', material: 'SiO2', thickness: 2 }],
          cladding: { material: 'Air' },
        },
        features: [
          { id: uid('f'), name: 'Left rail', kind: 'rect', material: 'Si', anchor: box, x: -0.14, y: 0, width: 0.18, height: 0.22 },
          { id: uid('f'), name: 'Right rail', kind: 'rect', material: 'Si', anchor: box, x: 0.14, y: 0, width: 0.18, height: 0.22 },
        ],
      };
    },
  },
  {
    id: 'fibre',
    name: 'Step-index fibre',
    description: 'Silica core with an example Δn (replace with your fibre’s)',
    build: () => ({
      ...base('Step-index fibre'),
      stack: { substrate: { material: 'SiO2' }, layers: [], cladding: { material: 'SiO2' } },
      features: [
        { id: uid('f'), name: 'Core', kind: 'circle', material: 'SiO2', deltaN: 0.005, anchor: 'substrate', x: 0, y: 0, radius: 4 },
      ],
    }),
  },
  {
    id: 'diffused',
    name: 'Diffused channel',
    description: 'In-diffused stripe in LiNbO₃ (example Δn and depth)',
    build: () => ({
      ...base('Diffused channel'),
      stack: { substrate: { material: 'LiNbO3', opticAxis: 'y' }, layers: [], cladding: { material: 'Air' } },
      features: [
        {
          id: uid('f'),
          name: 'Diffused stripe',
          kind: 'graded',
          anchor: 'substrate',
          x: 0,
          y: 0,
          deltaN: 0.01,
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
      const box = uid('l');
      const film = uid('l');
      const h = 0.3;
      const top = 1.2;
      const bottom = top + (2 * h) / Math.tan((60 * Math.PI) / 180);
      return {
        ...base('LN ridge'),
        stack: {
          substrate: { material: 'Si' },
          layers: [
            { id: box, name: 'BOX', material: 'SiO2', thickness: 2 },
            { id: film, name: 'LN slab', material: 'LiNbO3', opticAxis: 'x', thickness: 0.3 },
          ],
          cladding: { material: 'Air' },
        },
        features: [
          {
            id: uid('f'),
            name: 'Ridge',
            kind: 'trapezoid',
            material: 'LiNbO3',
            opticAxis: 'x',
            anchor: film,
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
