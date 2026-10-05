export type SolverKind = 'scalar' | 'semivector-te' | 'semivector-tm' | 'fullvector';

export const SOLVER_KIND_LABELS: Record<SolverKind, string> = {
  scalar: 'Scalar',
  'semivector-te': 'Semi-vector (TE-like)',
  'semivector-tm': 'Semi-vector (TM-like)',
  fullvector: 'Full-vector',
};
